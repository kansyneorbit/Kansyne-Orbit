// Runs all Orbit migrations on PGlite with a stub of Supabase's auth schema,
// then checks tenant isolation and role rules as different logins.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const migration = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const db = new PGlite();

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
  -- stub of Supabase Storage (RLS is already on in the real storage.objects)
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets (id),
    name text NOT NULL, owner uuid DEFAULT auth.uid());
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated;
  GRANT SELECT ON storage.buckets TO anon, authenticated;
  GRANT ALL ON storage.objects TO anon, authenticated;
`);
await db.exec(migration);
console.log('migration applied');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';
await db.exec(`INSERT INTO auth.users VALUES
  ('${A}', 'a@alpha.com', now()), ('${B}', 'b@beta.com', now()),
  ('${C}', 'c@alpha.com', now()), ('${D}', 'd@alpha.com', NULL)`);

async function as(uid, sql, params = []) {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    await db.exec(`SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'}`);
    const r = await db.query(sql, params);
    await db.exec('COMMIT');
    return r.rows;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

let pass = 0, fail = 0;
async function expectOk(name, fn, check) {
  try {
    const r = await fn();
    if (check && !check(r)) throw new Error('unexpected result ' + JSON.stringify(r));
    pass++; console.log('  ok   ', name);
    return r;
  } catch (e) { fail++; console.log('  FAIL ', name, '->', e.message); }
}
async function expectErr(name, fn) {
  try { const r = await fn(); fail++; console.log('  FAIL ', name, '-> no error', JSON.stringify(r)); }
  catch (e) { pass++; console.log('  ok   ', name, '(' + e.message + ')'); }
}

const [{ id: X }] = await as(A, `SELECT public.create_company('Alpha Consulting', 'Adil Khan') AS id`);
const [{ id: Y }] = await as(B, `SELECT public.create_company('Beta Advisory', 'Bea Lee') AS id`);

await expectErr('unconfirmed email cannot create a company',
  async () => as(D, `SELECT public.create_company('Delta', 'Dee')`));
await expectOk('A sees only own company', async () => as(A, 'SELECT id FROM companies'),
  r => r.length === 1 && r[0].id === X);
await expectOk('owner seeded with initials AK', async () => as(A, 'SELECT role, avatar_initials FROM members'),
  r => r.length === 1 && r[0].role === 'owner' && r[0].avatar_initials === 'AK');
await expectOk('10 default stages, 5 categories',
  async () => as(A, 'SELECT (SELECT count(*) FROM workflow_stages)::int s, (SELECT count(*) FROM categories)::int c'),
  r => r[0].s === 10 && r[0].c === 5);
await expectErr('anon sees nothing', async () => as(null, 'SELECT * FROM companies'));

const [{ code }] = await as(A, `SELECT public.next_client_code($1) AS code`, [X]);
await expectOk('client code CL-0001', async () => code, r => r === 'CL-0001');
const [cl] = await as(A, `INSERT INTO clients (company_id, code, name) VALUES ($1, $2, 'Dr Rao') RETURNING id`, [X, code]);
const stage = async (cid, name) => (await db.query(`SELECT id FROM workflow_stages WHERE company_id=$1 AND name=$2`, [cid, name])).rows[0].id;
const cat = async (cid) => (await db.query(`SELECT id FROM categories WHERE company_id=$1 LIMIT 1`, [cid])).rows[0].id;
const aMember = (await db.query(`SELECT id FROM members WHERE user_id=$1`, [A])).rows[0].id;

const [task] = await as(A, `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id, created_by)
  VALUES ($1, 'Market study', $2, $3, $4, $5) RETURNING id`, [X, cl.id, await cat(X), await stage(X, 'New'), aMember]);
await expectOk('task created, history row written',
  async () => as(A, 'SELECT count(*)::int n FROM stage_history WHERE task_id=$1', [task.id]), r => r[0].n === 1);

await expectErr('A cannot create a task in company Y', async () => as(A,
  `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id) VALUES ($1,'x',$2,$3,$4)`,
  [Y, cl.id, await cat(Y), await stage(Y, 'New')]));
await expectErr('task in X cannot use a stage from Y', async () => as(A,
  `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id) VALUES ($1,'x',$2,$3,$4)`,
  [X, cl.id, await cat(X), await stage(Y, 'New')]));
await expectOk('B cannot see X tasks', async () => as(B, 'SELECT * FROM tasks'), r => r.length === 0);
await expectOk('B cannot see X members', async () => as(B, 'SELECT * FROM members WHERE company_id=$1', [X]), r => r.length === 0);
await expectErr('B cannot move A task to company Y', async () => as(A, 'UPDATE tasks SET company_id=$1 WHERE id=$2', [Y, task.id]));

// Invite C as analyst
const [cm] = await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Cara','C@alpha.com','analyst') RETURNING id`, [X]);
await expectErr('owner cannot pre-link a login on invite', async () => as(A,
  `INSERT INTO members (company_id, user_id, name, email, role) VALUES ($1,$2,'Bea','b@beta.com','admin')`, [X, B]));
await expectOk('C accepts invite (case-insensitive email)', async () => as(C, 'SELECT public.accept_invites() n'), r => r[0].n === 1);
await expectOk('C sees no tasks before assignment', async () => as(C, 'SELECT * FROM tasks'), r => r.length === 0);
await as(A, `INSERT INTO task_assignees (company_id, task_id, member_id) VALUES ($1,$2,$3)`, [X, task.id, cm.id]);
await expectOk('C sees assigned task', async () => as(C, 'SELECT id FROM tasks'), r => r.length === 1);
await expectOk('C moves task to In Progress', async () => as(C, 'UPDATE tasks SET stage_id=$1 WHERE id=$2 RETURNING id',
  [await stage(X, 'In Progress'), task.id]), r => r.length === 1);
await expectErr('C cannot close the task (Owner-only stage)', async () => as(C, 'UPDATE tasks SET stage_id=$1 WHERE id=$2',
  [await stage(X, 'Closed'), task.id]));
await expectOk('C updates own assignment status', async () => as(C, `UPDATE task_assignees SET status='in_progress' WHERE member_id=$1 RETURNING id`, [cm.id]),
  r => r.length === 1);
await expectErr('C cannot move assignment to another task', async () => {
  const [t2] = await as(A, `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id) VALUES ($1,'Secret',$2,$3,$4) RETURNING id`,
    [X, cl.id, await cat(X), await stage(X, 'New')]);
  return as(C, 'UPDATE task_assignees SET task_id=$1 WHERE member_id=$2 RETURNING id', [t2.id, cm.id]);
});
await expectOk('C sees only 1 of 2 tasks', async () => as(C, 'SELECT id FROM tasks'), r => r.length === 1);
await expectOk('C cannot change own role (0 rows)', async () => as(C, `UPDATE members SET role='admin' WHERE id=$1 RETURNING id`, [cm.id]),
  r => r.length === 0);
await expectOk('C comments as self', async () => as(C, `INSERT INTO comments (company_id, task_id, author_id, body) VALUES ($1,$2,$3,'Draft sent') RETURNING id`,
  [X, task.id, cm.id]), r => r.length === 1);
await expectErr('C cannot comment as A', async () => as(C, `INSERT INTO comments (company_id, task_id, author_id, body) VALUES ($1,$2,$3,'x')`,
  [X, task.id, aMember]));
await expectOk('C logs hours', async () => as(C, `INSERT INTO time_logs (company_id, task_id, member_id, hours) VALUES ($1,$2,$3,2.5) RETURNING id`,
  [X, task.id, cm.id]), r => r.length === 1);

// Money
await as(A, `INSERT INTO task_financials (company_id, task_id, total_amount) VALUES ($1,$2,10000)`, [X, task.id]);
await as(A, `INSERT INTO payments (company_id, task_id, kind, amount, status) VALUES
  ($1,$2,'advance',4000,'received'), ($1,$2,'extra',1500,'pending'), ($1,$2,'payment',1000,'pending')`, [X, task.id]);
await expectOk('balance: owed 11500, paid 4000', async () => as(A, 'SELECT amount_owed::int o, amount_paid::int p FROM task_balances'),
  r => r.length === 1 && r[0].o === 11500 && r[0].p === 4000);
await expectOk('analyst C sees no financials', async () => as(C, 'SELECT * FROM task_financials'), r => r.length === 0);
await expectOk('analyst C sees no balances', async () => as(C, 'SELECT * FROM task_balances'), r => r.length === 0);

// Admin cannot create an owner
const E = '00000000-0000-0000-0000-00000000000e';
await db.exec(`INSERT INTO auth.users VALUES ('${E}', 'e@alpha.com', now())`);
await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Eve','e@alpha.com','admin')`, [X]);
await as(E, 'SELECT public.accept_invites()');
await expectErr('admin cannot create an owner', async () => as(E,
  `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Zed','z@alpha.com','owner')`, [X]));
await expectErr('admin cannot demote the owner', async () => as(E, `UPDATE members SET role='admin' WHERE id=$1`, [aMember]));
await expectErr('admin cannot change own role', async () => as(E, `UPDATE members SET role='manager' WHERE user_id=$1`, [E]));
await expectOk('admin can deactivate analyst', async () => as(E, `UPDATE members SET is_active=false WHERE id=$1 RETURNING id`, [cm.id]),
  r => r.length === 1);
await expectOk('deactivated C sees nothing', async () => as(C, 'SELECT * FROM tasks'), r => r.length === 0);
await expectErr('admin cannot delete a task', async () => {
  const r = await as(E, 'DELETE FROM tasks WHERE id=$1 RETURNING id', [task.id]);
  if (r.length === 0) throw new Error('blocked by RLS');
  return r;
});

// ---------- Business Development (sales) ----------
const S = '00000000-0000-0000-0000-00000000000f';
await db.exec(`INSERT INTO auth.users VALUES ('${S}', 's@alpha.com', now())`);
await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Sam Sales','s@alpha.com','sales')`, [X]);
await as(S, 'SELECT public.accept_invites()');
const sMember = (await db.query(`SELECT id FROM members WHERE user_id=$1`, [S])).rows[0].id;

const [{ code: sCode }] = await as(S, `SELECT public.next_client_code($1) AS code`, [X]);
const [sClient] = await expectOk('sales creates a client', async () => as(S,
  `INSERT INTO clients (company_id, code, name, created_by) VALUES ($1,$2,'Dr Sen',$3) RETURNING id`, [X, sCode, sMember]),
  r => r.length === 1) ?? [];
const [sTask] = await expectOk('sales creates a task as themselves', async () => as(S,
  `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id, created_by) VALUES ($1,'Sen thesis',$2,$3,$4,$5) RETURNING id`,
  [X, sClient.id, await cat(X), await stage(X, 'New'), sMember]), r => r.length === 1) ?? [];
await expectErr('sales cannot create a task as someone else', async () => as(S,
  `INSERT INTO tasks (company_id, title, client_id, category_id, stage_id, created_by) VALUES ($1,'x',$2,$3,$4,$5)`,
  [X, sClient.id, await cat(X), await stage(X, 'New'), aMember]));
await expectOk('sales sees only the task they brought in', async () => as(S, 'SELECT id FROM tasks'),
  r => r.length === 1 && r[0].id === sTask.id);
await expectOk('sales sees only their own client', async () => as(S, 'SELECT id FROM clients'),
  r => r.length === 1 && r[0].id === sClient.id);
await expectOk('sales cannot rename another client (0 rows)', async () => as(S, `UPDATE clients SET name='x' WHERE id=$1 RETURNING id`, [cl.id]),
  r => r.length === 0);

await expectOk('sales sets the fee on their task', async () => as(S,
  `INSERT INTO task_financials (company_id, task_id, total_amount, invoice_no) VALUES ($1,$2,20000,'INV-1') RETURNING task_id`, [X, sTask.id]),
  r => r.length === 1);
await expectErr('sales cannot set the fee on a task they did not bring in', async () => as(S,
  `INSERT INTO task_financials (company_id, task_id, total_amount) VALUES ($1,
     (SELECT id FROM tasks WHERE title='Secret'), 1)`, [X]));
await expectOk('sales cannot see money of other tasks', async () => as(S, 'SELECT task_id FROM task_financials'),
  r => r.length === 1 && r[0].task_id === sTask.id);
await expectErr('sales cannot record a payment', async () => as(S,
  `INSERT INTO payments (company_id, task_id, kind, amount, status) VALUES ($1,$2,'payment',500,'received')`, [X, sTask.id]));
await as(A, `INSERT INTO payments (company_id, task_id, kind, amount, status) VALUES ($1,$2,'advance',5000,'received')`, [X, sTask.id]);
await expectOk('sales sees payments on their task', async () => as(S, 'SELECT amount::int a FROM payments'),
  r => r.length === 1 && r[0].a === 5000);
await expectOk('sales cannot move stages (0 rows)', async () => as(S, 'UPDATE tasks SET stage_id=$1 WHERE id=$2 RETURNING id',
  [await stage(X, 'In Progress'), sTask.id]), r => r.length === 0);
await expectErr('sales cannot assign people', async () => as(S,
  `INSERT INTO task_assignees (company_id, task_id, member_id) VALUES ($1,$2,$3)`, [X, sTask.id, sMember]));

// ---------- notifications ----------
const eMember = (await db.query(`SELECT id FROM members WHERE user_id=$1`, [E])).rows[0].id;
await as(A, `INSERT INTO task_assignees (company_id, task_id, member_id, task_role) VALUES ($1,$2,$3,'lead')`, [X, sTask.id, eMember]);
await expectOk('assignee is notified', async () => as(E, 'SELECT message FROM notifications'),
  r => r.some((n) => n.message === 'You were added to "Sen thesis"'));
await expectOk('admin was told about the hand-over of a sales task', async () => as(E, 'SELECT message FROM notifications'),
  r => r.some((n) => n.message.includes('hand it to a Manager')));
await expectOk('admin E sees the task after the hand-over', async () => as(E, 'SELECT id FROM tasks WHERE id=$1', [sTask.id]), r => r.length === 1);
await expectOk('owner reminds sales to invoice', async () => as(A, 'SELECT public.remind_to_invoice($1) AS who', [sTask.id]),
  r => r[0].who === 'Sam Sales');
await expectOk('sales gets the reminder', async () => as(S, 'SELECT message FROM notifications'),
  r => r.length === 1 && r[0].message.includes('raise the invoice'));
await expectErr('sales cannot send reminders', async () => as(S, 'SELECT public.remind_to_invoice($1)', [sTask.id]));
await expectErr('another company cannot send reminders', async () => as(B, 'SELECT public.remind_to_invoice($1)', [sTask.id]));
await expectErr('nobody can write notifications directly', async () => as(A,
  `INSERT INTO notifications (company_id, member_id, message) VALUES ($1,$2,'spam')`, [X, sMember]));
await expectOk('sales marks the reminder read', async () => as(S, 'UPDATE notifications SET is_read=true RETURNING id'), r => r.length === 1);

// ---------- leads ----------
const G = '00000000-0000-0000-0000-000000000011';
await db.exec(`INSERT INTO auth.users VALUES ('${G}', 'g@alpha.com', now())`);
await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Gia','g@alpha.com','consultant')`, [X]);
await as(G, 'SELECT public.accept_invites()');

const [sLead] = await expectOk('sales creates a lead they own, numbered LD-0001', async () => as(S,
  `INSERT INTO leads (company_id, contact_name, phone, created_by, owner_id) VALUES ($1,'Dr Iyer','98765',$2,$2) RETURNING id, lead_no`,
  [X, sMember]), r => r[0].lead_no === 'LD-0001') ?? [];
await expectErr('sales cannot give a lead to someone else', async () => as(S,
  `INSERT INTO leads (company_id, contact_name, created_by, owner_id) VALUES ($1,'x',$2,$3)`, [X, sMember, aMember]));
await expectErr('nobody creates a lead as someone else', async () => as(A,
  `INSERT INTO leads (company_id, contact_name, created_by) VALUES ($1,'x',$2)`, [X, sMember]));
const [aLead] = await as(A, `INSERT INTO leads (company_id, contact_name, created_by, owner_id) VALUES ($1,'Prof Das',$2,$2) RETURNING id, lead_no`, [X, aMember]);
await expectOk('second lead is LD-0002 even though sales cannot see the first', async () => aLead.lead_no, r => r === 'LD-0002');
await expectOk('owner sees all leads', async () => as(A, 'SELECT id FROM leads'), r => r.length === 2);
await expectOk('sales sees only their own lead', async () => as(S, 'SELECT id FROM leads'), r => r.length === 1 && r[0].id === sLead.id);
await expectOk('consultant sees no leads', async () => as(G, 'SELECT id FROM leads'), r => r.length === 0);
await expectErr('consultant cannot create leads', async () => {
  const g = (await db.query(`SELECT id FROM members WHERE user_id=$1`, [G])).rows[0].id;
  return as(G, `INSERT INTO leads (company_id, contact_name, created_by) VALUES ($1,'x',$2)`, [X, g]);
});
await expectOk('other company sees no leads', async () => as(B, 'SELECT id FROM leads'), r => r.length === 0);
await expectOk('sales logs a call', async () => as(S,
  `INSERT INTO lead_activities (company_id, lead_id, member_id, kind, body) VALUES ($1,$2,$3,'call','Spoke, wants a quote') RETURNING id`,
  [X, sLead.id, sMember]), r => r.length === 1);
await expectErr('sales cannot log on a lead they cannot see', async () => as(S,
  `INSERT INTO lead_activities (company_id, lead_id, member_id, body) VALUES ($1,$2,$3,'x')`, [X, aLead.id, sMember]));
await expectOk('sales cannot update a lead they cannot see (0 rows)', async () => as(S,
  `UPDATE leads SET status='contacted' WHERE id=$1 RETURNING id`, [aLead.id]), r => r.length === 0);

const notesBefore = (await db.query(`SELECT count(*)::int n FROM notifications WHERE member_id=$1`, [aMember])).rows[0].n;
const [conv] = await expectOk('sales wins a lead: client + task + fee in one go', async () => as(S,
  `SELECT public.convert_lead($1, 'Iyer analysis', $2, NULL, 15000) AS task`, [sLead.id, await cat(X)]),
  r => !!r[0].task) ?? [];
await expectOk('converted lead is won and linked', async () => as(S, 'SELECT status, task_id, client_id FROM leads WHERE id=$1', [sLead.id]),
  r => r[0].status === 'won' && r[0].task_id === conv.task && !!r[0].client_id);
await expectOk('sales sees the new task and its fee', async () => as(S,
  'SELECT t.id, f.total_amount::int fee FROM tasks t JOIN task_financials f ON f.task_id = t.id WHERE t.id=$1', [conv.task]),
  r => r.length === 1 && r[0].fee === 15000);
await expectOk('owner is told to hand the new task to a Manager', async () =>
  (await db.query(`SELECT count(*)::int n FROM notifications WHERE member_id=$1 AND message LIKE '%hand it to a Manager%'`, [aMember])).rows[0].n,
  n => n === notesBefore + 1 || n > notesBefore);
await expectErr('a won lead cannot be converted twice', async () => as(S,
  `SELECT public.convert_lead($1, 'again', $2)`, [sLead.id, await cat(X)]));
await expectErr('consultant cannot convert a lead', async () => as(G,
  `SELECT public.convert_lead($1, 'x', $2)`, [aLead.id, await cat(X)]));

// ---------- HR: leave ----------
const gMember = (await db.query(`SELECT id FROM members WHERE user_id=$1`, [G])).rows[0].id;
const casual = async (cid) => (await db.query(`SELECT id FROM leave_types WHERE company_id=$1 AND name='Casual'`, [cid])).rows[0].id;
await expectOk('every company gets 4 default leave types', async () => as(B, 'SELECT name FROM leave_types ORDER BY position'),
  r => r.map((x) => x.name).join() === 'Casual,Sick,Earned,Loss of Pay');
await expectOk('owner adds a holiday', async () => as(A,
  `INSERT INTO holidays (company_id, holiday_date, name) VALUES ($1,'2027-03-03','Holi') RETURNING id`, [X]), r => r.length === 1);
await expectErr('consultant cannot add holidays', async () => as(G,
  `INSERT INTO holidays (company_id, holiday_date, name) VALUES ($1,'2027-03-04','x')`, [X]));
await expectOk('consultant cannot change leave types (0 rows)', async () => as(G,
  `UPDATE leave_types SET yearly_allowance=99 WHERE company_id=$1 RETURNING id`, [X]), r => r.length === 0);
await expectErr('nobody writes leave requests directly', async () => as(G,
  `INSERT INTO leave_requests (company_id, member_id, leave_type_id, start_date, end_date, days, approver_level)
   VALUES ($1,$2,$3,'2027-01-04','2027-01-04',1,'auto')`, [X, gMember, await casual(X)]));

const [{ id: gLeave }] = await as(G, `SELECT public.apply_leave($1,$2,'2027-03-01','2027-03-07') AS id`, [X, await casual(X)]);
await expectOk('Mon–Sun with a holiday counts 4 working days; no Manager, so an Admin approves', async () =>
  as(G, 'SELECT days::numeric d, approver_level, status FROM leave_requests WHERE id=$1', [gLeave]),
  r => Number(r[0].d) === 4 && r[0].approver_level === 'admin' && r[0].status === 'pending');
await expectErr('overlapping leave is refused', async () => as(G, `SELECT public.apply_leave($1,$2,'2027-03-05','2027-03-05')`, [X, await casual(X)]));
await expectErr('you cannot approve your own leave', async () => as(G, 'SELECT public.decide_leave($1, true)', [gLeave]));
await expectErr('Business Development cannot approve leave', async () => as(S, 'SELECT public.decide_leave($1, true)', [gLeave]));
await expectOk('admin approves', async () => as(E, `SELECT public.decide_leave($1, true, 'Enjoy')`, [gLeave]), () => true);
await expectOk('requester is told', async () => as(G, 'SELECT message FROM notifications'),
  r => r.some((n) => n.message.includes('was approved: Enjoy')));
await expectOk('balance: Casual 12 - 4 = 8', async () => as(G, 'SELECT * FROM public.leave_balance($1,$2,2027)', [X, gMember]),
  r => { const c = r.find((x) => x.name === 'Casual'); return Number(c.used) === 4 && Number(c.remaining) === 8; });
await expectErr('others cannot read my balance', async () => as(S, 'SELECT * FROM public.leave_balance($1,$2,2027)', [X, gMember]));
await expectErr('another company cannot read balances', async () => as(B, 'SELECT * FROM public.leave_balance($1,$2,2027)', [X, gMember]));
await expectOk('sales sees only their own requests', async () => as(S, 'SELECT id FROM leave_requests'), r => r.length === 0);
await expectOk('other company sees no requests', async () => as(B, 'SELECT id FROM leave_requests'), r => r.length === 0);

const [{ id: gPending }] = await as(G, `SELECT public.apply_leave($1,$2,'2027-04-05','2027-04-05',true,'Errand') AS id`, [X, await casual(X)]);
await expectOk('half day = 0.5', async () => as(G, 'SELECT days FROM leave_requests WHERE id=$1', [gPending]), r => Number(r[0].days) === 0.5);
await expectOk('requester cancels pending leave', async () => as(G, 'SELECT public.cancel_leave($1)', [gPending]), () => true);
await expectErr('someone else cannot cancel it', async () => as(E, 'SELECT public.cancel_leave($1)', [gLeave]));

const [{ id: aLeave }] = await as(A, `SELECT public.apply_leave($1,$2,'2027-05-03','2027-05-04') AS id`, [X, await casual(X)]);
await expectOk("owner's leave is approved automatically", async () => as(A, 'SELECT status FROM leave_requests WHERE id=$1', [aLeave]),
  r => r[0].status === 'approved');
const [{ id: eLeave }] = await as(E, `SELECT public.apply_leave($1,$2,'2027-06-07','2027-06-07') AS id`, [X, await casual(X)]);
await expectOk("an admin's leave goes to the Owner", async () => as(E, 'SELECT approver_level FROM leave_requests WHERE id=$1', [eLeave]),
  r => r[0].approver_level === 'owner');
await expectErr('admin cannot approve their own (owner-level) leave', async () => as(E, 'SELECT public.decide_leave($1, true)', [eLeave]));
await expectOk('owner rejects with a note', async () => as(A, `SELECT public.decide_leave($1, false, 'Release week')`, [eLeave]), () => true);
await expectErr('a decided request cannot be decided again', async () => as(A, 'SELECT public.decide_leave($1, true)', [eLeave]));

// ---------- HR: employee profiles ----------
const H = '00000000-0000-0000-0000-000000000012';
await db.exec(`INSERT INTO auth.users VALUES ('${H}', 'h@alpha.com', now())`);
await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Hari HR','h@alpha.com','hr')`, [X]);
await as(H, 'SELECT public.accept_invites()');
const M = '00000000-0000-0000-0000-000000000013';
await db.exec(`INSERT INTO auth.users VALUES ('${M}', 'm@alpha.com', now())`);
await as(A, `INSERT INTO members (company_id, name, email, role) VALUES ($1,'Mo Manager','m@alpha.com','manager')`, [X]);
await as(M, 'SELECT public.accept_invites()');

await expectOk('consultant saves their own profile (updated_by stamped)', async () => as(G,
  `INSERT INTO employee_profiles (company_id, member_id, first_name, last_name, mobile, updated_by) VALUES ($1,$2,'Gia','Rao','98000',$3) RETURNING updated_by`,
  [X, gMember, aMember]), r => r[0].updated_by === gMember);
await expectErr('consultant cannot write the masked number directly', async () => as(G,
  `UPDATE employee_profiles SET bank_account_last4='1234' WHERE member_id=$1`, [gMember]));
await expectErr('consultant cannot create a profile for someone else', async () => as(G,
  `INSERT INTO employee_profiles (company_id, member_id, first_name) VALUES ($1,$2,'x')`, [X, sMember]));
await as(S, `INSERT INTO employee_profiles (company_id, member_id, first_name) VALUES ($1,$2,'Sam')`, [X, sMember]);
await expectOk('consultant cannot edit another profile (0 rows)', async () => as(G,
  `UPDATE employee_profiles SET first_name='x' WHERE member_id=$1 RETURNING member_id`, [sMember]), r => r.length === 0);
await expectOk('consultant sees only their own profile', async () => as(G, 'SELECT member_id FROM employee_profiles'),
  r => r.length === 1 && r[0].member_id === gMember);
await expectOk('manager sees no profiles', async () => as(M, 'SELECT member_id FROM employee_profiles'), r => r.length === 0);
for (const [who, uid] of [['owner', A], ['admin', E], ['HR', H]]) {
  await expectOk(`${who} sees every profile`, async () => as(uid, 'SELECT member_id FROM employee_profiles'), r => r.length === 2);
}
await expectOk('other company sees no profiles', async () => as(B, 'SELECT member_id FROM employee_profiles'), r => r.length === 0);
await expectErr('profile cannot move to another company', async () => as(A, `UPDATE employee_profiles SET company_id=$1 WHERE member_id=$2`, [Y, gMember]));
await expectErr('profile files must sit in the member folder', async () => as(G,
  `UPDATE employee_profiles SET id_proof_path=$1 WHERE member_id=$2`, [`${X}/${sMember}/id.pdf`, gMember]));
await expectOk('HR edits a profile', async () => as(H, `UPDATE employee_profiles SET emergency_name='Ravi' WHERE member_id=$1 RETURNING member_id`, [gMember]),
  r => r.length === 1);

await expectOk('consultant sets their bank number, gets last 4', async () => as(G,
  `SELECT public.set_bank_account_number($1,$2,'1234 5678 9012') AS l`, [X, gMember]), r => r[0].l === '9012');
await expectOk('consultant sees only the masked number', async () => as(G,
  'SELECT p.bank_account_last4 l, (SELECT count(*)::int FROM employee_bank_numbers) n FROM employee_profiles p WHERE member_id=$1', [gMember]),
  r => r[0].l === '9012' && r[0].n === 0);
await expectOk('admin sees only the masked number', async () => as(E, 'SELECT account_number FROM employee_bank_numbers'), r => r.length === 0);
await expectOk('owner sees the full number', async () => as(A, 'SELECT account_number FROM employee_bank_numbers WHERE member_id=$1', [gMember]),
  r => r[0]?.account_number === '123456789012');
await expectOk('HR sees the full number', async () => as(H, 'SELECT account_number FROM employee_bank_numbers'), r => r.length === 1);
await expectOk('other company sees no numbers', async () => as(B, 'SELECT account_number FROM employee_bank_numbers'), r => r.length === 0);
await expectErr('consultant cannot set someone else’s number', async () => as(G,
  `SELECT public.set_bank_account_number($1,$2,'99999999')`, [X, sMember]));
await expectErr('another company cannot set a number', async () => as(B,
  `SELECT public.set_bank_account_number($1,$2,'99999999')`, [X, gMember]));
await expectErr('bad account number is refused', async () => as(G, `SELECT public.set_bank_account_number($1,$2,'12')`, [X, gMember]));
await expectErr('nobody writes numbers directly', async () => as(H,
  `INSERT INTO employee_bank_numbers (company_id, member_id, account_number) VALUES ($1,$2,'11112222')`, [X, sMember]));
await expectOk('admin sets a number for someone without a profile yet', async () => as(E,
  `SELECT public.set_bank_account_number($1,$2,'55556666') AS l`, [X, eMember]), r => r[0].l === '6666');
await expectOk('clearing the number clears last 4', async () => {
  await as(E, `SELECT public.set_bank_account_number($1,$2,'')`, [X, eMember]);
  return as(H, 'SELECT bank_account_last4 l, (SELECT count(*)::int FROM employee_bank_numbers WHERE member_id=$1) n FROM employee_profiles WHERE member_id=$1', [eMember]);
}, r => r[0].l === null && r[0].n === 0);

await expectOk('consultant uploads to their own folder', async () => as(G,
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('hr-docs', $1) RETURNING id`, [`${X}/${gMember}/id-1.pdf`]), r => r.length === 1);
await expectErr('consultant cannot upload into someone else’s folder', async () => as(G,
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('hr-docs', $1)`, [`${X}/${sMember}/id.pdf`]));
await expectErr('nobody uploads outside a member folder', async () => as(A,
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('hr-docs', $1)`, [`${X}/loose.pdf`]));
await expectErr('another company cannot upload into this company’s folders', async () => as(B,
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('hr-docs', $1)`, [`${X}/${gMember}/x.pdf`]));
await expectErr('a member folder under the wrong company is refused', async () => as(A,
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('hr-docs', $1)`, [`${Y}/${gMember}/x.pdf`]));
await expectOk('HR reads the file', async () => as(H, `SELECT name FROM storage.objects WHERE bucket_id='hr-docs'`), r => r.length === 1);
for (const [who, uid] of [['manager', M], ['sales', S], ['other company', B]]) {
  await expectOk(`${who} cannot read the file`, async () => as(uid, `SELECT name FROM storage.objects WHERE bucket_id='hr-docs'`), r => r.length === 0);
}
await expectOk('manager cannot delete it (0 rows)', async () => as(M, `DELETE FROM storage.objects WHERE bucket_id='hr-docs' RETURNING id`), r => r.length === 0);
await expectOk('consultant saves the path on their profile', async () => as(G,
  `UPDATE employee_profiles SET id_proof_path=$1 WHERE member_id=$2 RETURNING member_id`, [`${X}/${gMember}/id-1.pdf`, gMember]), r => r.length === 1);

await expectOk('HR reminds someone to complete their profile', async () => {
  await as(H, 'SELECT public.remind_profile($1,$2)', [X, sMember]);
  return as(S, `SELECT message FROM notifications WHERE message LIKE 'HR reminder%'`);
}, r => r.length === 1);
await expectErr('consultant cannot send profile reminders', async () => as(G, 'SELECT public.remind_profile($1,$2)', [X, sMember]));
await expectErr('another company cannot send profile reminders', async () => as(B, 'SELECT public.remind_profile($1,$2)', [X, sMember]));

// ---------- billing ----------
await expectOk('new companies start a trial', async () => as(A, `SELECT billing_status, trial_ends_at > now() AS future FROM companies WHERE id=$1`, [X]),
  r => r[0].billing_status === 'trialing' && r[0].future === true);
await expectOk('members can read the price list', async () => as(G, 'SELECT id FROM plans ORDER BY position'), r => r.map((p) => p.id).join() === 'starter,pro');
await expectErr('anon cannot read the price list', async () => as(null, 'SELECT id FROM plans'));
await expectErr('owner cannot mark their company as paid', async () => as(A, `UPDATE companies SET billing_status='active', plan='pro' WHERE id=$1`, [X]));
await expectErr('owner cannot extend their own trial', async () => as(A, `UPDATE companies SET trial_ends_at = now() + interval '1 year' WHERE id=$1`, [X]));
await expectOk('owner can still rename the company', async () => as(A, `UPDATE companies SET short_name='Alpha' WHERE id=$1 RETURNING id`, [X]), r => r.length === 1);
await expectOk('owner sets the billing email', async () => as(A, `UPDATE companies SET billing_email='accounts@alpha.com' WHERE id=$1 RETURNING id`, [X]), r => r.length === 1);
await expectErr('admin cannot change the billing email', async () => as(E, `UPDATE companies SET billing_email='x@alpha.com' WHERE id=$1`, [X]));
await expectErr('customers cannot list all companies', async () => as(A, 'SELECT * FROM public.admin_list_companies()'));
await expectErr('customers cannot activate billing', async () => as(A, `SELECT public.admin_set_billing($1,'pro','active')`, [X]));
await expectErr('customers cannot change prices', async () => as(A, `SELECT public.admin_set_plan_price('pro', 1)`));
await expectOk('customers are not platform admins', async () => as(A, 'SELECT public.am_platform_admin() a'), r => r[0].a === false);

const P = '00000000-0000-0000-0000-000000000099';
await db.exec(`INSERT INTO auth.users VALUES ('${P}', 'ops@orbit.test', now()); INSERT INTO private.platform_admins (user_id) VALUES ('${P}')`);
await expectOk('platform admin lists every company', async () => as(P, 'SELECT name, active_users FROM public.admin_list_companies()'),
  r => r.length === 2 && r.some((c) => c.name === 'Alpha Consulting'));
await expectOk('platform admin activates a company', async () => as(P,
  `SELECT public.admin_set_billing($1,'pro','active', now() + interval '1 month', 6)`, [X]), () => true);
await expectOk('the company sees it is on Pro', async () => as(A, 'SELECT plan, billing_status, seats_paid FROM companies WHERE id=$1', [X]),
  r => r[0].plan === 'pro' && r[0].billing_status === 'active' && r[0].seats_paid === 6);
await expectOk('platform admin changes a price', async () => as(P, `SELECT public.admin_set_plan_price('starter', 449, 10)`), () => true);
await expectOk('new price is visible', async () => as(A, `SELECT price_per_user::int p FROM plans WHERE id='starter'`), r => r[0].p === 449);
await expectOk('platform admin still cannot read company data directly', async () => as(P, 'SELECT id FROM tasks'), r => r.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
