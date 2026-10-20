-- =============================================================================
-- HR: leave types, allowances, holidays, leave requests and approvals.
--
--  * leave_types are per company (seeded: Casual 12, Sick 12, Earned 15,
--    Loss of Pay unpaid/unlimited). leave_allocations override a type's
--    yearly allowance for one person and year.
--  * Leave days count the company's work_days, minus its holidays.
--  * Requests are created, decided and cancelled only through RPCs:
--      staff -> Manager (or Admin if there is no active Manager),
--      Manager -> Admin, Admin -> Owner, Owner -> approved automatically.
--    HR may decide manager-level requests too. Nobody decides their own.
--  * Owner/Admin/HR configure types, allowances and holidays.
-- =============================================================================

CREATE TABLE public.leave_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name             text NOT NULL,
  is_paid          boolean NOT NULL DEFAULT true,
  tracks_balance   boolean NOT NULL DEFAULT true,   -- false = no yearly limit (e.g. Loss of Pay)
  yearly_allowance numeric(5,1) NOT NULL DEFAULT 0,
  position         int NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_types_name_check CHECK (length(trim(name)) BETWEEN 1 AND 60),
  CONSTRAINT leave_types_allowance_check CHECK (yearly_allowance >= 0 AND yearly_allowance <= 366),
  CONSTRAINT leave_types_company_id_key UNIQUE (company_id, id),
  CONSTRAINT leave_types_company_name_key UNIQUE (company_id, name)
);

CREATE TABLE public.leave_allocations (
  company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  member_id     uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  year          int  NOT NULL,
  days          numeric(5,1) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, leave_type_id, year),
  CONSTRAINT leave_allocations_year_check CHECK (year BETWEEN 2020 AND 2100),
  CONSTRAINT leave_allocations_days_check CHECK (days >= 0 AND days <= 366),
  FOREIGN KEY (company_id, member_id)     REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, leave_type_id) REFERENCES public.leave_types (company_id, id) ON DELETE CASCADE
);
CREATE INDEX leave_allocations_company_idx ON public.leave_allocations (company_id, member_id);
CREATE INDEX leave_allocations_type_idx ON public.leave_allocations (company_id, leave_type_id);

CREATE TABLE public.holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holidays_name_check CHECK (length(trim(name)) BETWEEN 1 AND 100),
  CONSTRAINT holidays_company_date_key UNIQUE (company_id, holiday_date)
);

CREATE TABLE public.leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  member_id       uuid NOT NULL,
  leave_type_id   uuid NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  half_day        boolean NOT NULL DEFAULT false,
  days            numeric(5,1) NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending',
  approver_level  text NOT NULL,
  exceeds_balance boolean NOT NULL DEFAULT false,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT leave_requests_level_check  CHECK (approver_level IN ('manager', 'admin', 'owner', 'auto')),
  CONSTRAINT leave_requests_dates_check  CHECK (end_date >= start_date AND (NOT half_day OR end_date = start_date)),
  CONSTRAINT leave_requests_days_check   CHECK (days > 0),
  FOREIGN KEY (company_id, member_id)     REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, leave_type_id) REFERENCES public.leave_types (company_id, id),
  FOREIGN KEY (company_id, decided_by)    REFERENCES public.members (company_id, id)
);
CREATE INDEX leave_requests_member_idx ON public.leave_requests (company_id, member_id, start_date);
CREATE INDEX leave_requests_status_idx ON public.leave_requests (company_id, status, approver_level);
CREATE INDEX leave_requests_type_idx ON public.leave_requests (company_id, leave_type_id);
CREATE INDEX leave_requests_decided_by_idx ON public.leave_requests (company_id, decided_by);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_types', 'leave_allocations', 'holidays', 'leave_requests'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.keep_company_id()', t || '_keep_company', t);
  END LOOP;
END $$;
CREATE TRIGGER leave_allocations_touch BEFORE UPDATE ON public.leave_allocations
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.leave_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests    ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_types_select ON public.leave_types FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)));
CREATE POLICY leave_types_insert ON public.leave_types FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));
CREATE POLICY leave_types_update ON public.leave_types FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));

CREATE POLICY holidays_select ON public.holidays FOR SELECT TO authenticated
  USING ((SELECT private.is_member(company_id)));
CREATE POLICY holidays_insert ON public.holidays FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));
CREATE POLICY holidays_update ON public.holidays FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));
CREATE POLICY holidays_delete ON public.holidays FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));

CREATE POLICY leave_allocations_select ON public.leave_allocations FOR SELECT TO authenticated
  USING (member_id = (SELECT private.my_member_id(company_id))
         OR (SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager', 'hr'])));
CREATE POLICY leave_allocations_insert ON public.leave_allocations FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));
CREATE POLICY leave_allocations_update ON public.leave_allocations FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])))
  WITH CHECK ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));
CREATE POLICY leave_allocations_delete ON public.leave_allocations FOR DELETE TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'hr'])));

-- Requests are written only by the RPCs below.
CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT TO authenticated
  USING (member_id = (SELECT private.my_member_id(company_id))
         OR (SELECT private.has_role(company_id, ARRAY['owner', 'admin', 'manager', 'hr'])));

-- ---------- defaults for every company (existing and new) ----------
CREATE FUNCTION private.seed_leave_types(p_company uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.leave_types (company_id, name, is_paid, tracks_balance, yearly_allowance, position) VALUES
    (p_company, 'Casual',      true,  true,  12, 1),
    (p_company, 'Sick',        true,  true,  12, 2),
    (p_company, 'Earned',      true,  true,  15, 3),
    (p_company, 'Loss of Pay', false, false, 0,  4)
  ON CONFLICT (company_id, name) DO NOTHING
$$;

SELECT private.seed_leave_types(c.id) FROM public.companies c;

CREATE FUNCTION private.seed_new_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.seed_leave_types(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER companies_seed AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION private.seed_new_company();

-- ---------- helpers ----------
CREATE FUNCTION private.working_days(p_company uuid, p_start date, p_end date, p_half boolean) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_half THEN 0.5 ELSE count(*)::numeric END
  FROM generate_series(p_start, p_end, interval '1 day') d
  JOIN public.companies c ON c.id = p_company
  WHERE extract(isodow FROM d)::int = ANY (c.work_days)
    AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.company_id = p_company AND h.holiday_date = d::date)
$$;

CREATE FUNCTION private.notify_members(p_company uuid, p_roles text[], p_skip uuid, p_message text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (company_id, member_id, message)
  SELECT p_company, m.id, p_message FROM public.members m
  WHERE m.company_id = p_company AND m.is_active AND m.user_id IS NOT NULL
    AND m.role = ANY (p_roles) AND m.id IS DISTINCT FROM p_skip
$$;

REVOKE ALL ON FUNCTION private.seed_leave_types(uuid), private.working_days(uuid, date, date, boolean),
  private.notify_members(uuid, text[], uuid, text) FROM PUBLIC, authenticated;

-- ---------- balances ----------
-- Visible to the person themselves, and to Owner/Admin/Manager/HR.
CREATE FUNCTION public.leave_balance(p_company uuid, p_member uuid, p_year int)
RETURNS TABLE (leave_type_id uuid, name text, is_paid boolean, tracks_balance boolean,
               allowance numeric, used numeric, pending numeric, remaining numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- coalesce: a non-member's my_member_id() is NULL, and NOT (NULL OR false) would pass.
  IF NOT coalesce(p_member = private.my_member_id(p_company)
                  OR private.has_role(p_company, ARRAY['owner', 'admin', 'manager', 'hr']), false)
     OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member AND m.company_id = p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.is_paid, t.tracks_balance,
         coalesce(a.days, t.yearly_allowance),
         coalesce(sum(r.days) FILTER (WHERE r.status = 'approved'), 0),
         coalesce(sum(r.days) FILTER (WHERE r.status = 'pending'), 0),
         coalesce(a.days, t.yearly_allowance) - coalesce(sum(r.days) FILTER (WHERE r.status = 'approved'), 0)
  FROM public.leave_types t
  LEFT JOIN public.leave_allocations a
    ON a.leave_type_id = t.id AND a.member_id = p_member AND a.year = p_year
  LEFT JOIN public.leave_requests r
    ON r.leave_type_id = t.id AND r.member_id = p_member AND extract(year FROM r.start_date)::int = p_year
  WHERE t.company_id = p_company AND t.is_active
  GROUP BY t.id, t.name, t.is_paid, t.tracks_balance, t.position, a.days, t.yearly_allowance
  ORDER BY t.position, t.name;
END $$;

-- ---------- apply ----------
CREATE FUNCTION public.apply_leave(p_company uuid, p_type uuid, p_start date, p_end date,
                                   p_half boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_me     uuid := private.my_member_id(p_company);
  v_role   text := private.my_role(p_company);
  v_name   text;
  v_type   public.leave_types;
  v_days   numeric;
  v_level  text;
  v_status text := 'pending';
  v_left   numeric;
  v_id     uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not a member of this company' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_type FROM public.leave_types WHERE id = p_type AND company_id = p_company AND is_active;
  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'Choose a leave type' USING ERRCODE = '22023';
  END IF;
  IF p_end < p_start OR (p_half AND p_end <> p_start) THEN
    RAISE EXCEPTION 'Check the dates (a half day is a single day)' USING ERRCODE = '22023';
  END IF;
  IF extract(year FROM p_start) <> extract(year FROM p_end) THEN
    RAISE EXCEPTION 'Leave across two years must be split into two requests' USING ERRCODE = '22023';
  END IF;
  IF p_end - p_start > 90 THEN
    RAISE EXCEPTION 'A single request can cover at most 90 days' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leave_requests r
             WHERE r.member_id = v_me AND r.status IN ('pending', 'approved')
               AND r.start_date <= p_end AND r.end_date >= p_start) THEN
    RAISE EXCEPTION 'You already have leave on some of these days' USING ERRCODE = '23P01';
  END IF;
  v_days := private.working_days(p_company, p_start, p_end, p_half);
  IF v_days <= 0 THEN
    RAISE EXCEPTION 'Those dates are all holidays or non-working days' USING ERRCODE = '22023';
  END IF;

  v_level := CASE v_role
    WHEN 'owner' THEN 'auto'
    WHEN 'admin' THEN 'owner'
    WHEN 'manager' THEN 'admin'
    ELSE 'manager' END;
  IF v_level = 'manager' AND NOT EXISTS (
       SELECT 1 FROM public.members m WHERE m.company_id = p_company AND m.role IN ('manager', 'hr')
         AND m.is_active AND m.user_id IS NOT NULL AND m.id <> v_me) THEN
    v_level := 'admin';
  END IF;
  IF v_level = 'auto' THEN v_status := 'approved'; END IF;

  SELECT b.remaining - b.pending INTO v_left
  FROM public.leave_balance(p_company, v_me, extract(year FROM p_start)::int) b WHERE b.leave_type_id = p_type;

  INSERT INTO public.leave_requests (company_id, member_id, leave_type_id, start_date, end_date, half_day, days,
                                     reason, status, approver_level, exceeds_balance, decided_by, decided_at)
  VALUES (p_company, v_me, p_type, p_start, p_end, p_half, v_days, nullif(trim(p_reason), ''), v_status, v_level,
          v_type.tracks_balance AND v_days > coalesce(v_left, 0),
          CASE WHEN v_level = 'auto' THEN v_me END, CASE WHEN v_level = 'auto' THEN now() END)
  RETURNING id INTO v_id;

  IF v_level <> 'auto' THEN
    SELECT name INTO v_name FROM public.members WHERE id = v_me;
    PERFORM private.notify_members(p_company,
      CASE v_level WHEN 'manager' THEN ARRAY['manager', 'hr'] WHEN 'admin' THEN ARRAY['admin', 'owner'] ELSE ARRAY['owner'] END,
      v_me,
      v_name || ' asked for ' || v_days || ' day(s) of ' || v_type.name || ' leave from ' || to_char(p_start, 'DD Mon') || '.');
  END IF;
  RETURN v_id;
END $$;

-- ---------- decide ----------
CREATE FUNCTION public.decide_leave(p_request uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_req  public.leave_requests;
  v_me   uuid;
  v_role text;
  v_type text;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  v_me := private.my_member_id(v_req.company_id);
  v_role := private.my_role(v_req.company_id);
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided' USING ERRCODE = '22023';
  END IF;
  IF v_me IS NULL OR v_me = v_req.member_id OR NOT (
       v_role = 'owner'
    OR (v_role = 'admin' AND v_req.approver_level IN ('manager', 'admin'))
    OR (v_role IN ('manager', 'hr') AND v_req.approver_level = 'manager')) THEN
    RAISE EXCEPTION 'You can’t decide this request' USING ERRCODE = '42501';
  END IF;

  UPDATE public.leave_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decided_by = v_me, decided_at = now(), decision_note = nullif(trim(p_note), '')
  WHERE id = p_request;

  SELECT t.name INTO v_type FROM public.leave_types t WHERE t.id = v_req.leave_type_id;
  INSERT INTO public.notifications (company_id, member_id, message)
  VALUES (v_req.company_id, v_req.member_id,
          'Your ' || v_type || ' leave from ' || to_char(v_req.start_date, 'DD Mon') || ' was '
          || CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
          || coalesce(': ' || nullif(trim(p_note), ''), '.'));
END $$;

-- ---------- cancel your own (pending, or approved and not yet started) ----------
CREATE FUNCTION public.cancel_leave(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req public.leave_requests;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request;
  IF v_req.id IS NULL OR v_req.member_id IS DISTINCT FROM private.my_member_id(v_req.company_id) THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_req.status = 'pending' OR (v_req.status = 'approved' AND v_req.start_date > current_date)) THEN
    RAISE EXCEPTION 'Only pending or upcoming leave can be cancelled' USING ERRCODE = '22023';
  END IF;
  UPDATE public.leave_requests SET status = 'cancelled' WHERE id = p_request;
END $$;

REVOKE ALL ON FUNCTION public.leave_balance(uuid, uuid, int),
  public.apply_leave(uuid, uuid, date, date, boolean, text),
  public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_balance(uuid, uuid, int),
  public.apply_leave(uuid, uuid, date, date, boolean, text),
  public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid) TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
