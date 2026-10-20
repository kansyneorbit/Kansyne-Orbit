-- =============================================================================
-- Advisor follow-up, part 2 (NOT yet applied: it drops objects, and Supabase's
-- confirmation for destructive changes can't be shown in this app):
--  * Drop indexes superseded by 20261020000100_fk_indexes.
--  * Split FOR ALL write policies so each action has one permissive policy.
-- =============================================================================

-- superseded by the company-scoped indexes above
DROP INDEX public.task_assignees_member_idx;
DROP INDEX public.time_logs_task_idx;
DROP INDEX public.payments_task_idx;

-- ---------- one permissive policy per action ----------
DROP POLICY workflow_stages_write ON public.workflow_stages;
CREATE POLICY workflow_stages_insert ON public.workflow_stages FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));
CREATE POLICY workflow_stages_update ON public.workflow_stages FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));
CREATE POLICY workflow_stages_delete ON public.workflow_stages FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));

DROP POLICY categories_write ON public.categories;
CREATE POLICY categories_insert ON public.categories FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));
CREATE POLICY categories_update ON public.categories FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));
CREATE POLICY categories_delete ON public.categories FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin'])));

DROP POLICY revisions_write ON public.revisions;
CREATE POLICY revisions_insert ON public.revisions FOR INSERT TO authenticated
  WITH CHECK (private.can_edit_task(company_id, task_id));
CREATE POLICY revisions_update ON public.revisions FOR UPDATE TO authenticated
  USING (private.can_edit_task(company_id, task_id))
  WITH CHECK (private.can_edit_task(company_id, task_id));
CREATE POLICY revisions_delete ON public.revisions FOR DELETE TO authenticated
  USING (private.can_edit_task(company_id, task_id));

-- managers assign; an assignee may update their own row (status only — the
-- keep_assignment trigger blocks moving it)
DROP POLICY task_assignees_write ON public.task_assignees;
DROP POLICY task_assignees_update_own ON public.task_assignees;
CREATE POLICY task_assignees_insert ON public.task_assignees FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));
CREATE POLICY task_assignees_update ON public.task_assignees FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
         OR member_id = (SELECT private.my_member_id(company_id)))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
              OR member_id = (SELECT private.my_member_id(company_id)));
CREATE POLICY task_assignees_delete ON public.task_assignees FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager'])));
