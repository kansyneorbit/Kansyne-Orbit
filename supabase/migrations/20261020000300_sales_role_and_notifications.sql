-- =============================================================================
-- Business Development ("sales") role + notifications
--
--  * New role 'sales': brings in work. Creates clients and tasks; sees only
--    the tasks they created (or are assigned to) and only clients linked to
--    those; on tasks they created they may set the fee and invoice details and
--    read payments, but not record payments or see company-wide money.
--    They do not assign people or move stages (can_edit_task is unchanged).
--  * Notifications: written by SECURITY DEFINER code only —
--      - a trigger tells a member when they are added to a task;
--      - remind_to_invoice() lets Owner/Admin/Manager ask the person who
--        brought in a task to raise the invoice.
-- =============================================================================

-- ---------- role lists ----------
ALTER TABLE public.members DROP CONSTRAINT members_role_check;
ALTER TABLE public.members ADD CONSTRAINT members_role_check CHECK (
  role IN ('owner', 'admin', 'manager', 'sales', 'consultant', 'analyst', 'accounts', 'hr'));

ALTER TABLE public.workflow_stages DROP CONSTRAINT workflow_stages_roles_check;
ALTER TABLE public.workflow_stages ADD CONSTRAINT workflow_stages_roles_check CHECK (
  allowed_roles IS NULL OR allowed_roles <@ ARRAY['owner', 'admin', 'manager', 'sales', 'consultant', 'analyst', 'accounts', 'hr']);

-- ---------- helpers ----------
CREATE FUNCTION private.created_task(p_company uuid, p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.tasks t
                 WHERE t.id = p_task AND t.company_id = p_company
                   AND t.created_by = private.my_member_id(p_company))
$$;

-- Business Development may see the money of tasks they brought in.
CREATE FUNCTION private.is_sales_owner_of(p_company uuid, p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_company, ARRAY['sales']) AND private.created_task(p_company, p_task)
$$;

REVOKE ALL ON FUNCTION private.created_task(uuid, uuid), private.is_sales_owner_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.created_task(uuid, uuid), private.is_sales_owner_of(uuid, uuid) TO authenticated;

-- ---------- clients & tasks ----------
-- Sales sees only clients they created or that belong to tasks they can see.
ALTER POLICY clients_select ON public.clients
  USING ((SELECT private.is_member(company_id))
         AND (NOT (SELECT private.has_role(company_id, ARRAY['sales']))
              OR created_by = (SELECT private.my_member_id(company_id))
              OR EXISTS (SELECT 1 FROM public.tasks t
                         WHERE t.company_id = clients.company_id AND t.client_id = clients.id)));
-- (the EXISTS above runs under tasks' own RLS, so it only finds tasks the caller can see)

ALTER POLICY clients_insert ON public.clients
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager', 'sales'])));
ALTER POLICY clients_update ON public.clients
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
         OR ((SELECT private.has_role(company_id, ARRAY['sales'])) AND created_by = (SELECT private.my_member_id(company_id))))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
         OR ((SELECT private.has_role(company_id, ARRAY['sales'])) AND created_by = (SELECT private.my_member_id(company_id))));

-- Sales creates tasks only as themselves.
ALTER POLICY tasks_insert ON public.tasks
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
              OR ((SELECT private.has_role(company_id, ARRAY['sales']))
                  AND created_by = (SELECT private.my_member_id(company_id))));

-- The creator check must read the row itself: can_see_task() looks the task up
-- in the table, which can't see a row being inserted (INSERT ... RETURNING).
ALTER POLICY tasks_select ON public.tasks
  USING (created_by = (SELECT private.my_member_id(company_id))
         OR private.can_see_task(company_id, id));

-- ---------- money on tasks they brought in ----------
CREATE POLICY task_financials_sales_select ON public.task_financials FOR SELECT TO authenticated
  USING (private.is_sales_owner_of(company_id, task_id));
CREATE POLICY task_financials_sales_insert ON public.task_financials FOR INSERT TO authenticated
  WITH CHECK (private.is_sales_owner_of(company_id, task_id));
CREATE POLICY task_financials_sales_update ON public.task_financials FOR UPDATE TO authenticated
  USING (private.is_sales_owner_of(company_id, task_id))
  WITH CHECK (private.is_sales_owner_of(company_id, task_id));
CREATE POLICY payments_sales_select ON public.payments FOR SELECT TO authenticated
  USING (private.is_sales_owner_of(company_id, task_id));

-- ---------- notifications ----------
CREATE FUNCTION private.notify_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.member_id IS DISTINCT FROM private.my_member_id(NEW.company_id) THEN
    INSERT INTO public.notifications (company_id, member_id, task_id, message)
    SELECT NEW.company_id, NEW.member_id, NEW.task_id, 'You were added to "' || t.title || '"'
    FROM public.tasks t WHERE t.id = NEW.task_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_assignees_notify AFTER INSERT ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION private.notify_assignment();

-- Ask the person who brought in a task to raise the invoice. Returns their name.
CREATE FUNCTION public.remind_to_invoice(p_task uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_title   text;
  v_creator uuid;
  v_name    text;
BEGIN
  SELECT t.company_id, t.title, t.created_by INTO v_company, v_title, v_creator
  FROM public.tasks t WHERE t.id = p_task;
  IF v_company IS NULL OR NOT private.has_role(v_company, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'Only an Owner, Admin or Manager can send this reminder' USING ERRCODE = '42501';
  END IF;
  SELECT m.name INTO v_name FROM public.members m
  WHERE m.id = v_creator AND m.company_id = v_company AND m.is_active;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'The person who brought in this task is no longer active' USING ERRCODE = 'P0002';
  END IF;
  IF v_creator = private.my_member_id(v_company) THEN
    RAISE EXCEPTION 'You brought in this task yourself' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (company_id, member_id, task_id, message)
  VALUES (v_company, v_creator, p_task,
          'Work on "' || v_title || '" is delivered — please raise the invoice.');
  RETURN v_name;
END $$;

REVOKE ALL ON FUNCTION public.remind_to_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remind_to_invoice(uuid) TO authenticated;
