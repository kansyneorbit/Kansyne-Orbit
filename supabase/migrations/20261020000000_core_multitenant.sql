-- =============================================================================
-- Kansyne Orbit — core multi-tenant schema
--
--  * One shared database. Every business row carries company_id.
--  * Child rows reference their parent with (company_id, id) composite foreign
--    keys, so a row can never point at another company's data.
--  * Row Level Security on every table; access is decided by the caller's
--    membership (public.members) in that company. Helpers live in the
--    non-exposed `private` schema.
--  * Workflow stages and categories are per-company data, not CHECK lists.
--  * Companies are created only through public.create_company(), which also
--    makes the caller the Owner and seeds default stages and categories.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ---------- companies ----------
CREATE TABLE public.companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  short_name         text NOT NULL,
  owner_title        text NOT NULL DEFAULT 'Owner',
  billing_title      text NOT NULL DEFAULT 'Accounts',
  client_code_prefix text NOT NULL DEFAULT 'CL',
  currency_code      text NOT NULL DEFAULT 'INR',
  locale             text NOT NULL DEFAULT 'en-IN',
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  phone_country_code text NOT NULL DEFAULT '91',
  work_days          int[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  plan               text NOT NULL DEFAULT 'trial',
  created_by         uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_names_check CHECK (
    length(trim(name)) BETWEEN 1 AND 120 AND length(trim(short_name)) BETWEEN 1 AND 40
    AND length(trim(owner_title)) BETWEEN 1 AND 40 AND length(trim(billing_title)) BETWEEN 1 AND 40),
  CONSTRAINT companies_prefix_check   CHECK (client_code_prefix ~ '^[A-Z0-9]{1,8}$'),
  CONSTRAINT companies_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT companies_locale_check   CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT companies_phone_check    CHECK (phone_country_code ~ '^[0-9]{1,4}$'),
  CONSTRAINT companies_work_days_check CHECK (
    cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  CONSTRAINT companies_plan_check CHECK (plan IN ('trial', 'starter', 'pro', 'cancelled'))
);

-- ---------- members (a login's seat in one company) ----------
CREATE TABLE public.members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users (id) ON DELETE SET NULL,  -- NULL until the invite is accepted
  name            text NOT NULL,
  email           text NOT NULL,
  role            text NOT NULL,
  avatar_initials text,
  is_active       boolean NOT NULL DEFAULT true,  -- members are deactivated, never deleted
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_role_check CHECK (
    role IN ('owner', 'admin', 'manager', 'consultant', 'analyst', 'accounts', 'hr')),
  CONSTRAINT members_name_check  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT members_email_check CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT members_company_id_key UNIQUE (company_id, id),
  CONSTRAINT members_company_user_key UNIQUE (company_id, user_id)
);
CREATE UNIQUE INDEX members_company_email_key ON public.members (company_id, lower(email));
CREATE INDEX members_user_id_idx ON public.members (user_id);

-- ---------- workflow stages (per company, ordered) ----------
CREATE TABLE public.workflow_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name          text NOT NULL,
  position      int  NOT NULL,
  -- kind drives behaviour (dashboards, overdue checks) instead of stage names
  kind          text NOT NULL DEFAULT 'active',
  color         text,
  -- roles allowed to move a task INTO this stage; NULL = anyone who can edit the task
  allowed_roles text[],
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_stages_kind_check CHECK (kind IN ('open', 'active', 'waiting', 'billing', 'closed')),
  CONSTRAINT workflow_stages_name_check CHECK (length(trim(name)) BETWEEN 1 AND 60),
  CONSTRAINT workflow_stages_roles_check CHECK (
    allowed_roles IS NULL OR allowed_roles <@ ARRAY['owner', 'admin', 'manager', 'consultant', 'analyst', 'accounts', 'hr']),
  CONSTRAINT workflow_stages_company_id_key UNIQUE (company_id, id),
  CONSTRAINT workflow_stages_company_name_key UNIQUE (company_id, name)
);

-- ---------- categories (per company) ----------
CREATE TABLE public.categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_check CHECK (length(trim(name)) BETWEEN 1 AND 60),
  CONSTRAINT categories_company_id_key UNIQUE (company_id, id),
  CONSTRAINT categories_company_name_key UNIQUE (company_id, name)
);

-- ---------- clients ----------
CREATE TABLE public.clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  code         text NOT NULL,  -- e.g. CL-0001, from companies.client_code_prefix
  name         text NOT NULL,
  email        text,
  phone        text,
  organisation text,
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_name_check CHECK (length(trim(name)) BETWEEN 1 AND 200),
  CONSTRAINT clients_company_id_key UNIQUE (company_id, id),
  CONSTRAINT clients_company_code_key UNIQUE (company_id, code),
  FOREIGN KEY (company_id, created_by) REFERENCES public.members (company_id, id)
);

-- ---------- tasks ----------
CREATE TABLE public.tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  client_id      uuid NOT NULL,
  category_id    uuid NOT NULL,
  stage_id       uuid NOT NULL,
  deadline       date,
  revision_count int  NOT NULL DEFAULT 0,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_title_check CHECK (length(trim(title)) BETWEEN 1 AND 200),
  CONSTRAINT tasks_company_id_key UNIQUE (company_id, id),
  FOREIGN KEY (company_id, client_id)   REFERENCES public.clients (company_id, id),
  FOREIGN KEY (company_id, category_id) REFERENCES public.categories (company_id, id),
  FOREIGN KEY (company_id, stage_id)    REFERENCES public.workflow_stages (company_id, id),
  FOREIGN KEY (company_id, created_by)  REFERENCES public.members (company_id, id)
);
CREATE INDEX tasks_company_stage_idx ON public.tasks (company_id, stage_id);
CREATE INDEX tasks_company_deadline_idx ON public.tasks (company_id, deadline);
CREATE INDEX tasks_client_idx ON public.tasks (company_id, client_id);

-- ---------- task_assignees ----------
CREATE TABLE public.task_assignees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id      uuid NOT NULL,
  member_id    uuid NOT NULL,
  task_role    text NOT NULL DEFAULT 'contributor',
  is_primary   boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT task_assignees_role_check   CHECK (task_role IN ('lead', 'contributor', 'reviewer')),
  CONSTRAINT task_assignees_status_check CHECK (status IN ('pending', 'in_progress', 'completed')),
  CONSTRAINT task_assignees_task_member_key UNIQUE (task_id, member_id),
  FOREIGN KEY (company_id, task_id)   REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, member_id) REFERENCES public.members (company_id, id)
);
CREATE INDEX task_assignees_member_idx ON public.task_assignees (member_id);

-- ---------- stage_history (written by trigger only) ----------
CREATE TABLE public.stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL,
  from_stage_id uuid,
  to_stage_id   uuid NOT NULL,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, task_id)       REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, from_stage_id) REFERENCES public.workflow_stages (company_id, id),
  FOREIGN KEY (company_id, to_stage_id)   REFERENCES public.workflow_stages (company_id, id),
  FOREIGN KEY (company_id, changed_by)    REFERENCES public.members (company_id, id)
);
CREATE INDEX stage_history_task_idx ON public.stage_history (task_id, changed_at);

-- ---------- comments ----------
CREATE TABLE public.comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id          uuid NOT NULL,
  author_id        uuid NOT NULL,
  body             text NOT NULL,
  is_revision_note boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_body_check CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  FOREIGN KEY (company_id, task_id)   REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, author_id) REFERENCES public.members (company_id, id)
);
CREATE INDEX comments_task_idx ON public.comments (task_id, created_at);

-- ---------- revisions ----------
CREATE TABLE public.revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL,
  revision_no   int  NOT NULL,
  requested_by  uuid,
  revision_type text,
  notes         text,
  status        text NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CONSTRAINT revisions_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT revisions_task_no_key UNIQUE (task_id, revision_no),
  FOREIGN KEY (company_id, task_id)      REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, requested_by) REFERENCES public.members (company_id, id)
);

-- ---------- time_logs ----------
CREATE TABLE public.time_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id          uuid NOT NULL,
  member_id        uuid NOT NULL,
  stage_id         uuid,
  hours            numeric(5,2) NOT NULL,
  work_description text,
  work_date        date NOT NULL DEFAULT current_date,
  logged_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_logs_hours_check CHECK (hours > 0 AND hours <= 24),
  FOREIGN KEY (company_id, task_id)   REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, member_id) REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, stage_id)  REFERENCES public.workflow_stages (company_id, id)
);
CREATE INDEX time_logs_task_idx ON public.time_logs (task_id);
CREATE INDEX time_logs_member_date_idx ON public.time_logs (member_id, work_date);

-- ---------- task_financials (one per task) ----------
CREATE TABLE public.task_financials (
  task_id      uuid PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  invoice_no   text,
  invoice_date date,
  notes        text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_financials_total_check CHECK (total_amount >= 0),
  FOREIGN KEY (company_id, task_id) REFERENCES public.tasks (company_id, id) ON DELETE CASCADE
);

-- ---------- payments (advance, instalments, extras) ----------
CREATE TABLE public.payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  task_id     uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'payment',
  amount      numeric(12,2) NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'pending',
  recorded_by uuid,
  received_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- 'extra' adds to the amount owed; 'advance' and 'payment' are money received
  CONSTRAINT payments_kind_check   CHECK (kind IN ('advance', 'payment', 'extra')),
  CONSTRAINT payments_amount_check CHECK (amount > 0),
  CONSTRAINT payments_status_check CHECK (status IN ('pending', 'received', 'verified')),
  FOREIGN KEY (company_id, task_id)     REFERENCES public.tasks (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, recorded_by) REFERENCES public.members (company_id, id)
);
CREATE INDEX payments_task_idx ON public.payments (task_id);

-- ---------- notifications ----------
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  member_id  uuid NOT NULL,
  task_id    uuid,
  message    text NOT NULL,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, member_id) REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, task_id)   REFERENCES public.tasks (company_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_member_idx ON public.notifications (member_id, is_read, created_at DESC);

-- =============================================================================
-- Access helpers (SECURITY DEFINER so policies can read members without
-- recursing through members' own RLS)
-- =============================================================================

CREATE FUNCTION private.my_member_id(p_company uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM public.members m
  WHERE m.company_id = p_company AND m.user_id = auth.uid() AND m.is_active
$$;

CREATE FUNCTION private.my_role(p_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.members m
  WHERE m.company_id = p_company AND m.user_id = auth.uid() AND m.is_active
$$;

CREATE FUNCTION private.is_member(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.my_role(p_company) IS NOT NULL
$$;

CREATE FUNCTION private.has_role(p_company uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(private.my_role(p_company) = ANY (p_roles), false)
$$;

-- Owner, admin, manager and accounts see every task; others see tasks they
-- created or are assigned to.
CREATE FUNCTION private.can_see_task(p_company uuid, p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_company, ARRAY['owner', 'admin', 'manager', 'accounts'])
      OR EXISTS (SELECT 1 FROM public.tasks t
                 WHERE t.id = p_task AND t.company_id = p_company
                   AND t.created_by = private.my_member_id(p_company))
      OR EXISTS (SELECT 1 FROM public.task_assignees a
                 WHERE a.task_id = p_task AND a.company_id = p_company
                   AND a.member_id = private.my_member_id(p_company))
$$;

CREATE FUNCTION private.can_edit_task(p_company uuid, p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_company, ARRAY['owner', 'admin', 'manager'])
      OR EXISTS (SELECT 1 FROM public.task_assignees a
                 WHERE a.task_id = p_task AND a.company_id = p_company
                   AND a.member_id = private.my_member_id(p_company))
$$;

CREATE FUNCTION private.can_see_financials(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_company, ARRAY['owner', 'admin', 'manager', 'accounts'])
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- =============================================================================
-- Triggers
-- =============================================================================

-- company_id is fixed once a row exists
CREATE FUNCTION private.keep_company_id() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['members', 'workflow_stages', 'categories', 'clients', 'tasks',
                           'task_assignees', 'stage_history', 'comments', 'revisions',
                           'time_logs', 'task_financials', 'payments', 'notifications'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.keep_company_id()', t || '_keep_company', t);
  END LOOP;
END $$;

CREATE FUNCTION private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER companies_touch BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER tasks_touch BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER task_financials_touch BEFORE UPDATE ON public.task_financials
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Only an Owner can create, change or demote an Owner; a member cannot change
-- their own role or deactivate themselves. Not SECURITY DEFINER on purpose:
-- current_user is then the caller, so writes made inside our own SECURITY
-- DEFINER RPCs (create_company, accept_invites) and by the service role pass.
CREATE FUNCTION private.guard_member_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF (NEW.role = 'owner' OR (TG_OP = 'UPDATE' AND OLD.role = 'owner'))
     AND NOT private.has_role(NEW.company_id, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only an Owner can manage Owner accounts' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id = auth.uid()
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    RAISE EXCEPTION 'You cannot change your own role or deactivate yourself' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Logins are linked only by accepting an invite' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'New members join by invite' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER members_guard BEFORE INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION private.guard_member_change();

-- An assignment cannot be moved to another task or person (assignees may only
-- update their own status).
CREATE FUNCTION private.keep_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'Remove and re-add the assignee instead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_assignees_keep BEFORE UPDATE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION private.keep_assignment();

-- Stage moves: enforce the stage's allowed_roles and record history.
CREATE FUNCTION private.on_task_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_roles text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  SELECT s.allowed_roles INTO v_roles FROM public.workflow_stages s WHERE s.id = NEW.stage_id;
  IF auth.uid() IS NOT NULL AND v_roles IS NOT NULL
     AND NOT private.has_role(NEW.company_id, v_roles) THEN
    RAISE EXCEPTION 'Your role cannot move tasks to this stage' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.stage_history (company_id, task_id, from_stage_id, to_stage_id, changed_by)
  VALUES (NEW.company_id, NEW.id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END,
          NEW.stage_id, private.my_member_id(NEW.company_id));
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_stage AFTER INSERT OR UPDATE OF stage_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.on_task_stage();

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE public.companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignees  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications   ENABLE ROW LEVEL SECURITY;

-- companies: insert only via create_company(); never deleted from the app
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING ((SELECT private.is_member(id)));
CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(id, ARRAY['owner', 'admin'])));

-- members: deactivate instead of delete
CREATE POLICY members_select ON public.members FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)) OR user_id = (SELECT auth.uid()));
CREATE POLICY members_insert ON public.members FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));
CREATE POLICY members_update ON public.members FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));

-- stages and categories: everyone reads, owner/admin configure
CREATE POLICY workflow_stages_select ON public.workflow_stages FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)));
CREATE POLICY workflow_stages_write ON public.workflow_stages FOR ALL TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));

CREATE POLICY categories_select ON public.categories FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)));
CREATE POLICY categories_write ON public.categories FOR ALL TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));

-- clients
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)));
CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));

-- tasks
CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (private.can_see_task(company_id, id));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (private.can_edit_task(company_id, id))
  WITH CHECK (private.can_edit_task(company_id, id));
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner'])));

-- task_assignees
CREATE POLICY task_assignees_select ON public.task_assignees FOR SELECT TO authenticated
  USING (private.can_see_task(company_id, task_id));
CREATE POLICY task_assignees_write ON public.task_assignees FOR ALL TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));
CREATE POLICY task_assignees_update_own ON public.task_assignees FOR UPDATE TO authenticated
  USING (member_id = (SELECT private.my_member_id(company_id)))
  WITH CHECK (member_id = (SELECT private.my_member_id(company_id)));

-- stage_history: read-only (trigger writes it)
CREATE POLICY stage_history_select ON public.stage_history FOR SELECT TO authenticated
  USING (private.can_see_task(company_id, task_id));

-- comments: anyone who can see the task can comment as themselves
CREATE POLICY comments_select ON public.comments FOR SELECT TO authenticated
  USING (private.can_see_task(company_id, task_id));
CREATE POLICY comments_insert ON public.comments FOR INSERT TO authenticated
  WITH CHECK (author_id = private.my_member_id(company_id)
              AND private.can_see_task(company_id, task_id));

-- revisions
CREATE POLICY revisions_select ON public.revisions FOR SELECT TO authenticated
  USING (private.can_see_task(company_id, task_id));
CREATE POLICY revisions_write ON public.revisions FOR ALL TO authenticated
  USING (private.can_edit_task(company_id, task_id))
  WITH CHECK (private.can_edit_task(company_id, task_id));

-- time_logs: log your own hours on tasks you can see; managers see all
CREATE POLICY time_logs_select ON public.time_logs FOR SELECT TO authenticated
  USING (member_id = private.my_member_id(company_id)
         OR (SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager', 'hr'])));
CREATE POLICY time_logs_insert ON public.time_logs FOR INSERT TO authenticated
  WITH CHECK (member_id = private.my_member_id(company_id)
              AND private.can_see_task(company_id, task_id));
CREATE POLICY time_logs_update_own ON public.time_logs FOR UPDATE TO authenticated
  USING (member_id = private.my_member_id(company_id))
  WITH CHECK (member_id = private.my_member_id(company_id)
              AND private.can_see_task(company_id, task_id));
CREATE POLICY time_logs_delete_own ON public.time_logs FOR DELETE TO authenticated
  USING (member_id = private.my_member_id(company_id));

-- money: owner, admin, manager, accounts
CREATE POLICY task_financials_all ON public.task_financials FOR ALL TO authenticated
  USING ((SELECT private.can_see_financials(company_id)))
  WITH CHECK ((SELECT private.can_see_financials(company_id)));
CREATE POLICY payments_all ON public.payments FOR ALL TO authenticated
  USING ((SELECT private.can_see_financials(company_id)))
  WITH CHECK ((SELECT private.can_see_financials(company_id)));

-- notifications: your own only (created by triggers / server code)
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (member_id = private.my_member_id(company_id));
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (member_id = private.my_member_id(company_id))
  WITH CHECK (member_id = private.my_member_id(company_id));

-- Balance per task: owed = total + extras, paid = advances + payments received.
CREATE VIEW public.task_balances WITH (security_invoker = true) AS
SELECT t.company_id, t.id AS task_id,
       coalesce(f.total_amount, 0)
         + coalesce(sum(p.amount) FILTER (WHERE p.kind = 'extra'), 0) AS amount_owed,
       coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'extra' AND p.status <> 'pending'), 0) AS amount_paid
FROM public.tasks t
JOIN public.task_financials f ON f.task_id = t.id
LEFT JOIN public.payments p ON p.task_id = t.id
GROUP BY t.company_id, t.id, f.total_amount;

-- =============================================================================
-- RPCs
-- =============================================================================

-- Sign-up: create a company, make the caller its Owner, seed defaults.
CREATE FUNCTION public.create_company(p_name text, p_your_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_company uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address first' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.companies c WHERE c.created_by = v_uid) >= 3 THEN
    RAISE EXCEPTION 'Company limit reached for this login' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.companies (name, short_name, created_by)
  VALUES (trim(p_name), left(trim(p_name), 40), v_uid)
  RETURNING id INTO v_company;

  INSERT INTO public.members (company_id, user_id, name, email, role, avatar_initials)
  VALUES (v_company, v_uid, trim(p_your_name), v_email, 'owner',
          upper(left(regexp_replace(trim(p_your_name), '(\S)\S*\s*', '\1', 'g'), 2)));

  INSERT INTO public.workflow_stages (company_id, name, position, kind, allowed_roles) VALUES
    (v_company, 'New',                      1, 'open',    NULL),
    (v_company, 'Assigned',                 2, 'active',  NULL),
    (v_company, 'In Progress',              3, 'active',  NULL),
    (v_company, 'With Client',              4, 'waiting', NULL),
    (v_company, 'Revision',                 5, 'active',  NULL),
    (v_company, 'Client Approved',          6, 'billing', NULL),
    (v_company, 'Invoice Raised',           7, 'billing', ARRAY['owner', 'admin', 'accounts']),
    (v_company, 'Waiting for Payment',      8, 'billing', ARRAY['owner', 'admin', 'accounts']),
    (v_company, 'Payment Received',         9, 'billing', ARRAY['owner', 'admin', 'accounts']),
    (v_company, 'Closed',                  10, 'closed',  ARRAY['owner']);

  INSERT INTO public.categories (company_id, name, position) VALUES
    (v_company, 'Consulting', 1), (v_company, 'Data Analysis', 2),
    (v_company, 'Report Writing', 3), (v_company, 'Review', 4), (v_company, 'Training', 5);

  RETURN v_company;
END $$;

-- After sign-in: link any pending invites that match the confirmed email.
CREATE FUNCTION public.accept_invites() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_count int;
BEGIN
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.members m SET user_id = v_uid
  WHERE m.user_id IS NULL AND m.is_active AND lower(m.email) = lower(v_email)
    AND NOT EXISTS (SELECT 1 FROM public.members x WHERE x.company_id = m.company_id AND x.user_id = v_uid);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Next client code for a company, e.g. CL-0007.
CREATE FUNCTION public.next_client_code(p_company uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prefix text; v_n int;
BEGIN
  IF NOT private.is_member(p_company) THEN
    RAISE EXCEPTION 'Not a member of this company' USING ERRCODE = '42501';
  END IF;
  SELECT c.client_code_prefix INTO v_prefix FROM public.companies c WHERE c.id = p_company;
  SELECT coalesce(max(substring(cl.code FROM '-(\d+)$')::int), 0) + 1 INTO v_n
  FROM public.clients cl WHERE cl.company_id = p_company AND cl.code LIKE v_prefix || '-%';
  RETURN v_prefix || '-' || lpad(v_n::text, 4, '0');
END $$;

REVOKE ALL ON FUNCTION public.create_company(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_invites() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_client_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_client_code(uuid) TO authenticated;

-- Nothing in public is for logged-out visitors.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
