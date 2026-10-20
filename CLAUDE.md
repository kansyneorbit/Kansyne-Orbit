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
- Roles (`members.role`): owner, admin, manager, consultant, analyst, accounts, hr.
- Workflow stages and categories are per-company rows. Behaviour keys off
  `workflow_stages.kind` (open/active/waiting/billing/closed), never stage names.
  `allowed_roles` limits who may move a task into a stage.

## Status (2026-10-20)
- Applied to Supabase: `20261020000000_core_multitenant`, `20261020000100_fk_indexes`.
- NOT applied: `20261020000200_policy_split_and_index_cleanup` — it drops objects, and
  the Supabase MCP auto-declines destructive migrations in this app (its confirmation
  prompt can't be shown). The user can run it in the Supabase SQL editor, or approve it
  where the prompt is supported. Perf-only; access rules are unchanged by it.
- Known advisor warnings that are intentional: `create_company`, `accept_invites`,
  `next_client_code` are SECURITY DEFINER RPCs callable by signed-in users (they check
  the caller themselves).
- Frontend: first slice built (sign-up/sign-in, company setup, task board, new task,
  task detail with stage moves, workflow settings). Not yet: team/invites, comments,
  hours, financials, billing. No GitHub remote or Vercel project yet.

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
