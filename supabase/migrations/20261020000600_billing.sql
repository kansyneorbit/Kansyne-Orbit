-- =============================================================================
-- Subscriptions (payment provider to be connected later).
--
--  * plans: Orbit's price list, per active user per month. Readable by any
--    signed-in user; changed only by platform admins.
--  * companies get billing fields. Customers can never change plan, status,
--    seats or provider ids themselves (guard trigger); only platform admins
--    (via admin_set_billing) or server code with the service role can.
--  * private.platform_admins: the Orbit operators. Seeded with the
--    kansyneorbit@gmail.com login if it exists.
-- =============================================================================

CREATE TABLE public.plans (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  price_per_user        numeric(10,2) NOT NULL,
  currency_code         text NOT NULL DEFAULT 'INR',
  max_users             int,                 -- NULL = unlimited
  description           text,
  position              int NOT NULL DEFAULT 0,
  is_active             boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_price_check CHECK (price_per_user >= 0),
  CONSTRAINT plans_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT plans_max_users_check CHECK (max_users IS NULL OR max_users > 0)
);
INSERT INTO public.plans (id, name, price_per_user, max_users, description, position) VALUES
  ('starter', 'Starter', 399, 10,   'For small teams: tasks, clients, finance, leave and leads.', 1),
  ('pro',     'Pro',     699, NULL, 'Everything in Starter, unlimited users and priority support.', 2);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_select ON public.plans FOR SELECT TO authenticated USING (true);
-- (no write policies: platform admins use admin_set_plan_price)

ALTER TABLE public.companies
  ADD COLUMN trial_ends_at            timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  ADD COLUMN billing_status           text NOT NULL DEFAULT 'trialing',
  ADD COLUMN seats_paid               int,
  ADD COLUMN current_period_end       timestamptz,
  ADD COLUMN billing_email            text,
  ADD COLUMN billing_provider         text,
  ADD COLUMN provider_customer_id     text,
  ADD COLUMN provider_subscription_id text,
  ADD CONSTRAINT companies_billing_status_check CHECK (billing_status IN ('trialing', 'active', 'past_due', 'cancelled')),
  ADD CONSTRAINT companies_billing_email_check CHECK (billing_email IS NULL OR billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ---------- platform admins ----------
CREATE TABLE private.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.platform_admins (user_id)
SELECT u.id FROM auth.users u WHERE lower(u.email) = 'kansyneorbit@gmail.com'
ON CONFLICT DO NOTHING;

CREATE FUNCTION private.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.platform_admins a WHERE a.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO authenticated;

-- Signed-in users can't touch billing fields (Owners may set billing_email).
-- Same pattern as guard_member_change: SECURITY DEFINER RPCs and the service
-- role run as other database roles and pass.
CREATE FUNCTION private.guard_billing() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.billing_status IS DISTINCT FROM OLD.billing_status
     OR NEW.seats_paid IS DISTINCT FROM OLD.seats_paid
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.billing_provider IS DISTINCT FROM OLD.billing_provider
     OR NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
     OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id THEN
    RAISE EXCEPTION 'Billing details can only be changed through Orbit billing' USING ERRCODE = '42501';
  END IF;
  IF NEW.billing_email IS DISTINCT FROM OLD.billing_email AND NOT private.has_role(NEW.id, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only an Owner can change the billing email' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER companies_guard_billing BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION private.guard_billing();

-- ---------- platform admin RPCs ----------
CREATE FUNCTION public.admin_list_companies()
RETURNS TABLE (id uuid, name text, created_at timestamptz, owner_email text, active_users bigint,
               plan text, billing_status text, trial_ends_at timestamptz, current_period_end timestamptz,
               seats_paid int, billing_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.created_at,
         (SELECT u.email::text FROM auth.users u WHERE u.id = c.created_by),
         (SELECT count(*) FROM public.members m WHERE m.company_id = c.id AND m.is_active AND m.user_id IS NOT NULL),
         c.plan, c.billing_status, c.trial_ends_at, c.current_period_end, c.seats_paid, c.billing_email
  FROM public.companies c
  ORDER BY c.created_at DESC;
END $$;

CREATE FUNCTION public.admin_set_billing(p_company uuid, p_plan text, p_status text,
                                         p_period_end timestamptz DEFAULT NULL, p_seats int DEFAULT NULL,
                                         p_trial_ends timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.companies
  SET plan = p_plan, billing_status = p_status,
      current_period_end = p_period_end, seats_paid = p_seats,
      trial_ends_at = coalesce(p_trial_ends, trial_ends_at)
  WHERE id = p_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE FUNCTION public.admin_set_plan_price(p_plan text, p_price numeric, p_max_users int DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.plans SET price_per_user = p_price, max_users = p_max_users, updated_at = now() WHERE id = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE FUNCTION public.am_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_platform_admin()
$$;

REVOKE ALL ON FUNCTION public.admin_list_companies(), public.admin_set_billing(uuid, text, text, timestamptz, int, timestamptz),
  public.admin_set_plan_price(text, numeric, int), public.am_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_companies(), public.admin_set_billing(uuid, text, text, timestamptz, int, timestamptz),
  public.admin_set_plan_price(text, numeric, int), public.am_platform_admin() TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
