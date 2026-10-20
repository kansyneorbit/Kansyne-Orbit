-- =============================================================================
-- Leads: the pipeline before work is won.
--
--  * leads: enquiry -> contacted -> proposal -> won (converted into a client
--    and task by convert_lead) or lost. Numbered LD-0001 per company.
--  * lead_activities: calls, emails, meetings and notes on a lead.
--  * Access: Owner/Admin/Manager see and work every lead; Business
--    Development sees and works leads they own or created. Nobody else.
--  * When Business Development creates a task (directly or by winning a lead),
--    Owners and Admins are notified to hand it to a Manager.
-- =============================================================================

CREATE TABLE public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  lead_no         text NOT NULL,                 -- set by trigger, e.g. LD-0007
  contact_name    text NOT NULL,
  organisation    text,
  phone           text,
  email           text,
  source          text,
  category_id     uuid,
  requirement     text,
  estimated_value numeric(12,2),
  status          text NOT NULL DEFAULT 'new',
  owner_id        uuid,                          -- the member responsible
  next_follow_up  date,
  lost_reason     text,
  client_id       uuid,
  task_id         uuid,
  won_at          timestamptz,
  closed_at       timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check CHECK (status IN ('new', 'contacted', 'proposal', 'won', 'lost')),
  CONSTRAINT leads_name_check   CHECK (length(trim(contact_name)) BETWEEN 1 AND 200),
  CONSTRAINT leads_value_check  CHECK (estimated_value IS NULL OR estimated_value >= 0),
  CONSTRAINT leads_company_id_key UNIQUE (company_id, id),
  CONSTRAINT leads_company_no_key UNIQUE (company_id, lead_no),
  FOREIGN KEY (company_id, category_id) REFERENCES public.categories (company_id, id),
  FOREIGN KEY (company_id, owner_id)    REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, created_by)  REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, client_id)   REFERENCES public.clients (company_id, id),
  FOREIGN KEY (company_id, task_id)     REFERENCES public.tasks (company_id, id) ON DELETE SET NULL (task_id)
);
CREATE INDEX leads_company_status_idx ON public.leads (company_id, status);
CREATE INDEX leads_company_owner_idx ON public.leads (company_id, owner_id);
CREATE INDEX leads_company_follow_up_idx ON public.leads (company_id, next_follow_up);
CREATE INDEX leads_category_idx ON public.leads (company_id, category_id);
CREATE INDEX leads_created_by_idx ON public.leads (company_id, created_by);
CREATE INDEX leads_client_idx ON public.leads (company_id, client_id);
CREATE INDEX leads_task_idx ON public.leads (company_id, task_id);

CREATE TABLE public.lead_activities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  lead_id    uuid NOT NULL,
  member_id  uuid NOT NULL,
  kind       text NOT NULL DEFAULT 'note',
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activities_kind_check CHECK (kind IN ('note', 'call', 'email', 'meeting', 'status')),
  CONSTRAINT lead_activities_body_check CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  FOREIGN KEY (company_id, lead_id)   REFERENCES public.leads (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, member_id) REFERENCES public.members (company_id, id)
);
CREATE INDEX lead_activities_lead_idx ON public.lead_activities (company_id, lead_id, created_at);
CREATE INDEX lead_activities_member_idx ON public.lead_activities (company_id, member_id);

CREATE TRIGGER leads_keep_company BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.keep_company_id();
CREATE TRIGGER lead_activities_keep_company BEFORE UPDATE ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION private.keep_company_id();
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Numbering must see every lead in the company, not just the caller's.
CREATE FUNCTION private.number_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT 'LD-' || lpad((coalesce(max(substring(l.lead_no FROM '-(\d+)$')::int), 0) + 1)::text, 4, '0')
  INTO NEW.lead_no
  FROM public.leads l WHERE l.company_id = NEW.company_id;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_number BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.number_lead();

-- ---------- access ----------
CREATE FUNCTION private.can_work_lead(p_company uuid, p_owner uuid, p_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_company, ARRAY['owner', 'admin', 'manager'])
      OR (private.has_role(p_company, ARRAY['sales'])
          AND private.my_member_id(p_company) IN (p_owner, p_creator))
$$;

CREATE FUNCTION private.can_see_lead(p_company uuid, p_lead uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.leads l
                 WHERE l.id = p_lead AND l.company_id = p_company
                   AND private.can_work_lead(p_company, l.owner_id, l.created_by))
$$;

REVOKE ALL ON FUNCTION private.can_work_lead(uuid, uuid, uuid), private.can_see_lead(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_work_lead(uuid, uuid, uuid), private.can_see_lead(uuid, uuid) TO authenticated;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
  USING (private.can_work_lead(company_id, owner_id, created_by));
-- Create as yourself; Business Development may only own their own leads.
CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT private.my_member_id(company_id))
              AND ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager']))
                   OR ((SELECT private.has_role(company_id, ARRAY['sales']))
                       AND owner_id = (SELECT private.my_member_id(company_id)))));
CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated
  USING (private.can_work_lead(company_id, owner_id, created_by))
  WITH CHECK (private.can_work_lead(company_id, owner_id, created_by));
-- no delete: mark a lead lost instead

CREATE POLICY lead_activities_select ON public.lead_activities FOR SELECT TO authenticated
  USING (private.can_see_lead(company_id, lead_id));
CREATE POLICY lead_activities_insert ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT private.my_member_id(company_id))
              AND private.can_see_lead(company_id, lead_id));

-- ---------- won: lead -> client + task in one transaction ----------
-- SECURITY INVOKER: every insert below is checked by the caller's own RLS.
CREATE FUNCTION public.convert_lead(
  p_lead uuid, p_title text, p_category uuid, p_deadline date DEFAULT NULL,
  p_fee numeric DEFAULT NULL, p_client uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_lead   public.leads;
  v_me     uuid;
  v_client uuid := p_client;
  v_stage  uuid;
  v_task   uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.status IN ('won', 'lost') THEN
    RAISE EXCEPTION 'This lead is already closed' USING ERRCODE = '22023';
  END IF;
  v_me := private.my_member_id(v_lead.company_id);

  IF v_client IS NULL THEN
    INSERT INTO public.clients (company_id, code, name, email, phone, organisation, created_by)
    VALUES (v_lead.company_id, public.next_client_code(v_lead.company_id), v_lead.contact_name,
            v_lead.email, v_lead.phone, v_lead.organisation, v_me)
    RETURNING id INTO v_client;
  END IF;

  SELECT s.id INTO v_stage FROM public.workflow_stages s
  WHERE s.company_id = v_lead.company_id AND s.is_active ORDER BY s.position LIMIT 1;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'Your workflow has no active stages' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tasks (company_id, title, description, client_id, category_id, stage_id, deadline, created_by)
  VALUES (v_lead.company_id, trim(p_title), v_lead.requirement, v_client,
          coalesce(p_category, v_lead.category_id), v_stage, p_deadline, v_me)
  RETURNING id INTO v_task;

  IF coalesce(p_fee, 0) > 0 THEN
    INSERT INTO public.task_financials (company_id, task_id, total_amount)
    VALUES (v_lead.company_id, v_task, p_fee);
  END IF;

  UPDATE public.leads
  SET status = 'won', client_id = v_client, task_id = v_task, won_at = now(), closed_at = now(), next_follow_up = NULL
  WHERE id = p_lead;

  INSERT INTO public.lead_activities (company_id, lead_id, member_id, kind, body)
  VALUES (v_lead.company_id, p_lead, v_me, 'status', 'Won — converted into a task');

  RETURN v_task;
END $$;

REVOKE ALL ON FUNCTION public.convert_lead(uuid, text, uuid, date, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lead(uuid, text, uuid, date, numeric, uuid) TO authenticated;

-- ---------- hand-over: tell Owners/Admins when Business Development brings in a task ----------
CREATE FUNCTION private.notify_new_sales_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_creator public.members;
BEGIN
  SELECT * INTO v_creator FROM public.members m WHERE m.id = NEW.created_by AND m.company_id = NEW.company_id;
  IF v_creator.role = 'sales' THEN
    INSERT INTO public.notifications (company_id, member_id, task_id, message)
    SELECT NEW.company_id, m.id, NEW.id,
           v_creator.name || ' brought in "' || NEW.title || '" — hand it to a Manager.'
    FROM public.members m
    WHERE m.company_id = NEW.company_id AND m.is_active AND m.user_id IS NOT NULL
      AND m.role IN ('owner', 'admin');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_notify_sales AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.notify_new_sales_task();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
