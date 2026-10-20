# Kansyne Orbit — project notes

Multi-tenant SaaS workflow ERP for consulting firms, rebuilt from the Kansyne ERP
(`C:\Users\Adil\Documents\kansyne-app`, reference only — never edit it from here).

## Accounts (separate from Kansyne's)
- Supabase: kansyneorbit@gmail.com, project `ifockdecghiljjywltiz`, reached through the
  project MCP server `supabase-orbit` in `.mcp.json` (scoped to that project only).
- Vercel: kansyneorbit@gmail.com, through the project MCP server `vercel-orbit`.
- Do not use the claude.ai Supabase/Vercel connectors here — they are signed in to
  Kansyne's accounts. Before any write, confirm the server reports the Orbit account.

## Tenancy and security
- One shared database. Every business table has `company_id`; children reference
  parents with `(company_id, id)` composite foreign keys so rows can't cross companies.
- RLS on every table, via helpers in the non-exposed `private` schema:
  `my_member_id`, `my_role`, `is_member`, `has_role`, `can_see_task`, `can_edit_task`,
  `can_see_financials`. New tables must enable RLS and use these (never `USING (true)`).
- `company_id` is immutable (trigger). Companies are created only by
  `create_company()`; invited members are linked by `accept_invites()`.
- Roles (`members.role`): owner, admin, manager, sales (shown as "Business Development"),
  consultant, analyst, accounts, hr. Sales creates clients/tasks as themselves, sees only
  tasks they created or are assigned to (and those clients), sets fee/invoice and reads
  payments on tasks they created; they do not assign or move stages.
- Notifications are written only by SECURITY DEFINER code: the assignment trigger and
  `remind_to_invoice()` (Owner/Admin/Manager -> task creator).
- Workflow stages and categories are per-company rows. Behaviour keys off
  `workflow_stages.kind` (open/active/waiting/billing/closed), never stage names.
  `allowed_roles` limits who may move a task into a stage.

## Status (2026-10-20)
- Applied to Supabase: `20261020000000_core_multitenant`, `20261020000100_fk_indexes`,
  `20261020000300_sales_role_and_notifications`, `20261020000400_leads`,
  `20261020000500_hr_leave`.
- NOT applied: `20261020000200_policy_split_and_index_cleanup` — it drops objects, and
  the Supabase MCP auto-declines destructive migrations in this app (its confirmation
  prompt can't be shown). The user can run it in the Supabase SQL editor, or approve it
  where the prompt is supported. Perf-only; access rules are unchanged by it.
- Known advisor warnings that are intentional: `create_company`, `accept_invites`,
  `next_client_code` are SECURITY DEFINER RPCs callable by signed-in users (they check
  the caller themselves).
- Frontend: built — sign-up/sign-in, company setup, task board, new task,
  task detail with stage moves, workflow settings, Team (invite by link, roles,
  deactivate), task work (assign people, comments, revisions, log hours), finance
  (Money card per task; /finance reports by period), Business Development role,
  notifications, Clients (list, search, client page), Leads (pipeline, activity log,
  convert_lead() -> client + task), HR (leave types/allowances/holidays, apply_leave/
  decide_leave/cancel_leave RPCs, hours report). Not yet:
  dashboard, billing, employee profiles. Finance reports aggregate in JS
  over all of a company's money rows; move to SQL views if companies get large.
- GitHub: `kansyneorbit/Kansyne-Orbit` (this repo's git identity and credential
  username are set to kansyneorbit; the PC's global git login is Kansyne's).
- Vercel: project `kansyne-orbit` (`prj_oG7xRnid4l7lWjAAVR1ATXhfyciD`) in team
  `orbit-kansyne` (`team_7lDdhGJkuPgSESsfFr153vzU`), Hobby plan. Every push to `main`
  deploys production; other branches get preview URLs. Env vars hold the Supabase URL
  and publishable key for all environments.

## App (Next.js 16 + TypeScript + Tailwind 4)
- `npm run dev` (port 3000), `npm run build`, `npm run typecheck`.
- Next 16 renamed middleware to `src/proxy.ts`: it refreshes the Supabase session and
  sends signed-out visitors to `/login`. It is a convenience, not security.
- All data access is server-side with the signed-in user's Supabase client
  (`src/lib/supabase/server.ts`), so RLS applies to every query. Never use a
  service-role key in the app.
- Routes: `/app` links invites and picks a company; everything for one company lives
  under `/c/[companyId]/…`, and its layout calls `requireMember()` (`src/lib/session.ts`).
- Forms are Server Actions in `actions.ts` next to their page. On failure they call
  `fail(path, message)`, which redirects back with `?error=` shown in a `<Banner>`.
- Shared UI is in `src/components/ui.tsx`; colours are theme tokens in
  `src/app/globals.css` (light + dark).
- Env: `.env.local` (git-ignored) holds the Supabase URL and publishable key; see
  `.env.example`.

## Database rules
- Every schema change is a new file `supabase/migrations/YYYYMMDDHHMMSS_description.sql`.
- Run `npm run test:db` after any change: it applies all migrations to PGlite with a
  stub of Supabase's auth schema and checks isolation and role rules. Add a test for
  every new policy.
