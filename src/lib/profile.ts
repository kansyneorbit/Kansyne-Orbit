// Employee profiles (HR). Who may see them is enforced by RLS; these are the
// shared field lists and the "complete" rule used by the profile page and HR list.

export type EmployeeProfile = {
  member_id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  mobile: string | null
  personal_email: string | null
  date_of_birth: string | null
  gender: string | null
  correspondence_address: string | null
  permanent_address: string | null
  emergency_name: string | null
  emergency_relationship: string | null
  emergency_phone: string | null
  bank_account_name: string | null
  bank_account_type: string | null
  bank_name: string | null
  bank_ifsc: string | null
  bank_account_last4: string | null
  id_proof_path: string | null
  address_proof_path: string | null
  updated_at: string
}

export const PROFILE_COLUMNS =
  'member_id, first_name, middle_name, last_name, mobile, personal_email, date_of_birth, gender, correspondence_address, permanent_address, emergency_name, emergency_relationship, emergency_phone, bank_account_name, bank_account_type, bank_name, bank_ifsc, bank_account_last4, id_proof_path, address_proof_path, updated_at'

export const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const
export const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary'] as const

// Text fields a profile form saves directly (the account number goes through an RPC).
export const PROFILE_TEXT_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'mobile', 'personal_email', 'date_of_birth', 'gender',
  'correspondence_address', 'permanent_address', 'emergency_name', 'emergency_relationship', 'emergency_phone',
  'bank_account_name', 'bank_account_type', 'bank_name', 'bank_ifsc',
] as const

// Required for a profile to count as complete. Saving a partial profile is allowed;
// the HR list shows what is missing. Document uploads are optional.
const REQUIRED: [keyof EmployeeProfile, string][] = [
  ['first_name', 'first name'], ['last_name', 'last name'], ['mobile', 'mobile'], ['date_of_birth', 'date of birth'],
  ['correspondence_address', 'address'],
  ['emergency_name', 'emergency contact'], ['emergency_relationship', 'emergency relationship'], ['emergency_phone', 'emergency phone'],
  ['bank_account_name', 'account holder'], ['bank_account_type', 'account type'], ['bank_account_last4', 'account number'],
  ['bank_name', 'bank name'], ['bank_ifsc', 'IFSC'],
]

export function missingFields(p: EmployeeProfile | null | undefined): string[] {
  return REQUIRED.filter(([k]) => !p || !String(p[k] ?? '').trim()).map(([, label]) => label)
}

export const DOC_KINDS = {
  id: { label: 'ID proof', column: 'id_proof_path' },
  address: { label: 'Address proof', column: 'address_proof_path' },
} as const
export type DocKind = keyof typeof DOC_KINDS

export const HR_DOCS_BUCKET = 'hr-docs'
export const MAX_DOC_BYTES = 4 * 1024 * 1024
export const DOC_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}
