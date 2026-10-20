export const ROLES = ['owner', 'admin', 'manager', 'consultant', 'analyst', 'accounts', 'hr'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
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

export type Company = {
  id: string
  name: string
  short_name: string
  client_code_prefix: string
}

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
