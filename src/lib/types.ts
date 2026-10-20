export const ROLES = ['owner', 'admin', 'manager', 'sales', 'consultant', 'analyst', 'accounts', 'hr'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Business Development',
  consultant: 'Consultant',
  analyst: 'Analyst',
  accounts: 'Accounts',
  hr: 'HR',
}

export const STAGE_KINDS = ['open', 'active', 'waiting', 'billing', 'closed'] as const
export type StageKind = (typeof STAGE_KINDS)[number]

export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  open: 'Not started',
  active: 'Being worked on',
  waiting: 'Waiting on client',
  billing: 'Billing',
  closed: 'Closed',
}

export const REVISION_TYPES = [
  'Content changes', 'Analysis changes', 'Data correction', 'Formatting only',
  'Additional content', 'Other',
] as const

export const TASK_ROLE_LABELS = { lead: 'Lead', contributor: 'Contributor', reviewer: 'Reviewer' } as const
export const ASSIGNMENT_STATUS_LABELS = { pending: 'Not started', in_progress: 'In progress', completed: 'Done' } as const

export const LEAD_STATUS_LABELS = {
  new: 'New', contacted: 'Contacted', proposal: 'Proposal sent', won: 'Won', lost: 'Lost',
} as const
export type LeadStatus = keyof typeof LEAD_STATUS_LABELS
export const OPEN_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'proposal']
export const LEAD_ACTIVITY_LABELS = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting', status: 'Update' } as const
export const LEAD_SOURCES = ['Referral', 'Website', 'Phone enquiry', 'Social media', 'Event', 'Existing client', 'Other'] as const

export type Company = {
  id: string
  name: string
  short_name: string
  client_code_prefix: string
  currency_code: string
  locale: string
  timezone: string
}

export const PAYMENT_KIND_LABELS = { advance: 'Advance', payment: 'Payment', extra: 'Extra charge' } as const
export const PAYMENT_STATUS_LABELS = { pending: 'Expected', received: 'Received', verified: 'Verified' } as const
export type PaymentKind = keyof typeof PAYMENT_KIND_LABELS
export type PaymentStatus = keyof typeof PAYMENT_STATUS_LABELS

export const FINANCE_ROLES: Role[] = ['owner', 'admin', 'manager', 'accounts']
// Who may create clients and tasks (Business Development only as themselves).
export const TASK_CREATOR_ROLES: Role[] = ['owner', 'admin', 'manager', 'sales']
// Who sees everyone's leave and hours; who configures leave types and holidays.
export const PEOPLE_ROLES: Role[] = ['owner', 'admin', 'manager', 'hr']
export const HR_ADMIN_ROLES: Role[] = ['owner', 'admin', 'hr']
export const LEAVE_STATUS_LABELS = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' } as const
export type LeaveStatus = keyof typeof LEAVE_STATUS_LABELS
export type ApproverLevel = 'manager' | 'admin' | 'owner' | 'auto'
// Mirrors decide_leave(): who may decide a request at each approval level.
export function canDecideLeave(role: Role, level: ApproverLevel) {
  if (role === 'owner') return level !== 'auto'
  if (role === 'admin') return level === 'manager' || level === 'admin'
  if (role === 'manager' || role === 'hr') return level === 'manager'
  return false
}

// Who works leads (Business Development only their own).
export const LEAD_ROLES: Role[] = ['owner', 'admin', 'manager', 'sales']
// Who assigns people, edits any task and sends invoice reminders.
export const TASK_MANAGER_ROLES: Role[] = ['owner', 'admin', 'manager']

export type Member = {
  id: string
  company_id: string
  name: string
  email: string
  role: Role
  avatar_initials: string | null
}

export type Stage = {
  id: string
  name: string
  position: number
  kind: StageKind
  allowed_roles: Role[] | null
  is_active: boolean
}

export type Category = {
  id: string
  name: string
  position: number
  is_active: boolean
}
