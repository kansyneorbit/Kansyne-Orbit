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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
