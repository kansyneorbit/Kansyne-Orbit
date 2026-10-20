-- =============================================================================
-- HR: employee profiles and their documents.
--
--  * One employee_profiles row per member: personal details, emergency contact,
--    bank details and paths to uploaded ID / address proofs.
--  * Visible and editable by the person themselves and by Owner/Admin/HR only.
--  * The full bank account number lives in employee_bank_numbers, readable by
--    Owner/HR only. Everyone else who can see the profile sees the last four
--    digits (employee_profiles.bank_account_last4). The number is written only
--    through set_bank_account_number().
--  * Files go to the private 'hr-docs' bucket under
--    "<company_id>/<member_id>/<file>"; storage.objects policies apply the same
--    rule as the profile.
-- =============================================================================

CREATE TABLE public.employee_profiles (
  member_id              uuid PRIMARY KEY,
  company_id             uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  first_name             text,
  middle_name            text,
  last_name              text,
  mobile                 text,
  personal_email         text,
  date_of_birth          date,
  gender                 text,
  correspondence_address text,
  permanent_address      text,
  emergency_name         text,
  emergency_relationship text,
  emergency_phone        text,
  bank_account_name      text,
  bank_account_type      text,
  bank_name              text,
  bank_ifsc              text,
  bank_account_last4     text,
  id_proof_path          text,
  address_proof_path     text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  CONSTRAINT employee_profiles_company_member_key UNIQUE (company_id, member_id),
  CONSTRAINT employee_profiles_gender_check CHECK (gender IS NULL OR gender IN ('Female', 'Male', 'Other', 'Prefer not to say')),
  CONSTRAINT employee_profiles_account_type_check CHECK (bank_account_type IS NULL OR bank_account_type IN ('Savings', 'Current', 'Salary')),
  CONSTRAINT employee_profiles_last4_check CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^[A-Z0-9]{1,4}$'),
  CONSTRAINT employee_profiles_dob_check CHECK (date_of_birth IS NULL OR date_of_birth >= '1900-01-01'),
  CONSTRAINT employee_profiles_text_check CHECK (
    length(coalesce(first_name, '') || coalesce(middle_name, '') || coalesce(last_name, '')) <= 300
    AND length(coalesce(correspondence_address, '')) <= 1000 AND length(coalesce(permanent_address, '')) <= 1000
    AND length(coalesce(mobile, '')) <= 30 AND length(coalesce(emergency_phone, '')) <= 30
    AND length(coalesce(personal_email, '')) <= 200 AND length(coalesce(emergency_name, '')) <= 200
    AND length(coalesce(emergency_relationship, '')) <= 60 AND length(coalesce(bank_account_name, '')) <= 200
    AND length(coalesce(bank_name, '')) <= 200 AND length(coalesce(bank_ifsc, '')) <= 20),
  -- uploaded files must sit in this member's own folder
  CONSTRAINT employee_profiles_id_proof_path_check
    CHECK (id_proof_path IS NULL OR id_proof_path LIKE company_id::text || '/' || member_id::text || '/%'),
  CONSTRAINT employee_profiles_address_proof_path_check
    CHECK (address_proof_path IS NULL OR address_proof_path LIKE company_id::text || '/' || member_id::text || '/%'),
  FOREIGN KEY (company_id, member_id)  REFERENCES public.members (company_id, id),
  FOREIGN KEY (company_id, updated_by) REFERENCES public.members (company_id, id)
);
CREATE INDEX employee_profiles_updated_by_idx ON public.employee_profiles (company_id, updated_by);

CREATE TABLE public.employee_bank_numbers (
  member_id      uuid PRIMARY KEY,
  company_id     uuid NOT NULL,
  account_number text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_bank_numbers_format_check CHECK (account_number ~ '^[A-Z0-9]{6,34}$'),
  CONSTRAINT employee_bank_numbers_company_member_key UNIQUE (company_id, member_id),
  FOREIGN KEY (company_id, member_id) REFERENCES public.employee_profiles (company_id, member_id) ON DELETE CASCADE
);

CREATE TRIGGER employee_profiles_keep_company BEFORE UPDATE ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION private.keep_company_id();
CREATE TRIGGER employee_bank_numbers_keep_company BEFORE UPDATE ON public.employee_bank_numbers
  FOR EACH ROW EXECUTE FUNCTION private.keep_company_id();
CREATE TRIGGER employee_bank_numbers_touch BEFORE UPDATE ON public.employee_bank_numbers
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Stamps who changed the profile, and keeps the masked number in step with
-- employee_bank_numbers (only set_bank_account_number() may change it).
CREATE FUNCTION private.guard_employee_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'A profile cannot be moved to another person' USING ERRCODE = '42501';
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND NEW.bank_account_last4 IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.bank_account_last4 END) THEN
    RAISE EXCEPTION 'Change the bank account number through set_bank_account_number()' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(private.my_member_id(NEW.company_id), CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by END);
  RETURN NEW;
END $$;
CREATE TRIGGER employee_profiles_guard BEFORE INSERT OR UPDATE ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_employee_profile();

-- ---------- access helpers ----------
-- The person themselves, or Owner/Admin/HR of the member's company.
CREATE FUNCTION private.can_see_profile(p_company uuid, p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member AND m.company_id = p_company)
     AND coalesce(p_member = private.my_member_id(p_company)
                  OR private.has_role(p_company, ARRAY['owner', 'admin', 'hr']), false)
$$;

-- Storage object names look like "<company_id>/<member_id>/<file>".
CREATE FUNCTION private.can_use_hr_doc(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_parts text[] := string_to_array(p_name, '/');
  v_uuid  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF coalesce(array_length(v_parts, 1), 0) <> 3 OR v_parts[3] = ''
     OR v_parts[1] !~ v_uuid OR v_parts[2] !~ v_uuid THEN
    RETURN false;
  END IF;
  RETURN private.can_see_profile(v_parts[1]::uuid, v_parts[2]::uuid);
END $$;

REVOKE ALL ON FUNCTION private.guard_employee_profile(), private.can_see_profile(uuid, uuid),
  private.can_use_hr_doc(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_see_profile(uuid, uuid), private.can_use_hr_doc(text) TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.employee_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_bank_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_profiles_select ON public.employee_profiles FOR SELECT TO authenticated
  USING (private.can_see_profile(company_id, member_id));
CREATE POLICY employee_profiles_insert ON public.employee_profiles FOR INSERT TO authenticated
  WITH CHECK (private.can_see_profile(company_id, member_id));
CREATE POLICY employee_profiles_update ON public.employee_profiles FOR UPDATE TO authenticated
  USING (private.can_see_profile(company_id, member_id))
  WITH CHECK (private.can_see_profile(company_id, member_id));

-- Full numbers: Owner/HR only. Written only by set_bank_account_number().
CREATE POLICY employee_bank_numbers_select ON public.employee_bank_numbers FOR SELECT TO authenticated
  USING ((SELECT private.has_role(company_id, ARRAY['owner', 'hr'])));

-- ---------- bank account number ----------
-- The person or Owner/Admin/HR may set it; pass NULL or '' to clear it.
CREATE FUNCTION public.set_bank_account_number(p_company uuid, p_member uuid, p_number text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_num text := upper(regexp_replace(coalesce(p_number, ''), '[\s-]', '', 'g'));
BEGIN
  IF NOT private.can_see_profile(p_company, p_member) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_num <> '' AND v_num !~ '^[A-Z0-9]{6,34}$' THEN
    RAISE EXCEPTION 'Enter a bank account number of 6 to 34 letters or digits' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_profiles (company_id, member_id) VALUES (p_company, p_member)
  ON CONFLICT (member_id) DO NOTHING;
  IF v_num = '' THEN
    DELETE FROM public.employee_bank_numbers WHERE member_id = p_member;
    UPDATE public.employee_profiles SET bank_account_last4 = NULL WHERE member_id = p_member;
    RETURN NULL;
  END IF;
  INSERT INTO public.employee_bank_numbers (company_id, member_id, account_number)
  VALUES (p_company, p_member, v_num)
  ON CONFLICT (member_id) DO UPDATE SET account_number = EXCLUDED.account_number;
  UPDATE public.employee_profiles SET bank_account_last4 = right(v_num, 4) WHERE member_id = p_member;
  RETURN right(v_num, 4);
END $$;

-- ---------- reminder ----------
-- Owner/Admin/HR nudge someone to complete their profile.
CREATE FUNCTION public.remind_profile(p_company uuid, p_member uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_role(p_company, ARRAY['owner', 'admin', 'hr']) THEN
    RAISE EXCEPTION 'Only an Owner, Admin or HR can send reminders' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member AND m.company_id = p_company
                   AND m.is_active AND m.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That person has not joined yet' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (company_id, member_id, message)
  VALUES (p_company, p_member, 'HR reminder: please complete your profile and upload your ID and address proof (My profile).');
END $$;

REVOKE ALL ON FUNCTION public.set_bank_account_number(uuid, uuid, text), public.remind_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bank_account_number(uuid, uuid, text), public.remind_profile(uuid, uuid) TO authenticated;

-- ---------- private document storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hr-docs', 'hr-docs', false, 4194304, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY orbit_hr_docs_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-docs' AND private.can_use_hr_doc(name));
CREATE POLICY orbit_hr_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-docs' AND private.can_use_hr_doc(name));
CREATE POLICY orbit_hr_docs_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hr-docs' AND private.can_use_hr_doc(name))
  WITH CHECK (bucket_id = 'hr-docs' AND private.can_use_hr_doc(name));
CREATE POLICY orbit_hr_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hr-docs' AND private.can_use_hr_doc(name));

REVOKE ALL ON public.employee_profiles, public.employee_bank_numbers FROM anon;
