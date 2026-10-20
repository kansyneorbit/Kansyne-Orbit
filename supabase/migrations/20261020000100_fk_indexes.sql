-- Advisor follow-up to core_multitenant: index every foreign key
-- (company-scoped ones as (company_id, column)).
CREATE INDEX companies_created_by_idx          ON public.companies (created_by);
CREATE INDEX clients_created_by_idx            ON public.clients (company_id, created_by);
CREATE INDEX tasks_category_idx                ON public.tasks (company_id, category_id);
CREATE INDEX tasks_created_by_idx              ON public.tasks (company_id, created_by);
CREATE INDEX task_assignees_company_task_idx   ON public.task_assignees (company_id, task_id);
CREATE INDEX task_assignees_company_member_idx ON public.task_assignees (company_id, member_id);
CREATE INDEX stage_history_company_task_idx    ON public.stage_history (company_id, task_id);
CREATE INDEX stage_history_from_stage_idx      ON public.stage_history (company_id, from_stage_id);
CREATE INDEX stage_history_to_stage_idx        ON public.stage_history (company_id, to_stage_id);
CREATE INDEX stage_history_changed_by_idx      ON public.stage_history (company_id, changed_by);
CREATE INDEX comments_company_task_idx         ON public.comments (company_id, task_id);
CREATE INDEX comments_author_idx               ON public.comments (company_id, author_id);
CREATE INDEX revisions_company_task_idx        ON public.revisions (company_id, task_id);
CREATE INDEX revisions_requested_by_idx        ON public.revisions (company_id, requested_by);
CREATE INDEX time_logs_company_task_idx        ON public.time_logs (company_id, task_id);
CREATE INDEX time_logs_company_member_idx      ON public.time_logs (company_id, member_id);
CREATE INDEX time_logs_stage_idx               ON public.time_logs (company_id, stage_id);
CREATE INDEX task_financials_company_task_idx  ON public.task_financials (company_id, task_id);
CREATE INDEX payments_company_task_idx         ON public.payments (company_id, task_id);
CREATE INDEX payments_recorded_by_idx          ON public.payments (company_id, recorded_by);
CREATE INDEX notifications_company_member_idx  ON public.notifications (company_id, member_id);
CREATE INDEX notifications_company_task_idx    ON public.notifications (company_id, task_id);
