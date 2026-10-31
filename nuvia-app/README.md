# Nuvia

Internal team platform. This repository currently holds **Phase 3: Attendance** and **Phase 4: Tasks** on top of a stand-in sign-in. Phase 2 (secure base) replaces the stand-ins listed below.

```
packages/shared   request signing + wire protocol used by both the API and the agent
apps/api          NestJS + PostgreSQL: tasks and projects, office check-in, device auth, idle logic, review
apps/agent        Electron tray app (desktop agent) for remote staff
apps/web          Next.js UI: tasks (board, list, detail), projects, attendance, activity log, review screen
```

## Run it locally

```
npm install
npm run db:up            # Postgres in Docker (dev only)
npm run migrate
npm run seed             # demo users, see below
npm run dev:api          # http://127.0.0.1:4000
npm run dev:web          # http://localhost:3000
npm run dev:agent        # needs a desktop session; installs the Electron binary on first `npm install`
```

Seeded users (password `nuvia-dev-password`): `EXEC-1` executive, `HR-1` HR/admin, `LEAD-1` team lead, `EMP-1` office, `EMP-2` and `EMP-3` remote (`EMP-3` has no manager, so alerts go to HR).

Tests: `npm test` (needs Postgres; set `TEST_DATABASE_URL`, the database name must contain `test` because it is dropped and recreated).

## How attendance works

**Office mode.** Check in and out in the web app. Dates use `TIMEZONE`. If `OFFICE_NETWORK_CIDRS` is set, check-in only works from those addresses (check-out works from anywhere). The address comes from the request, and `X-Forwarded-For` is only believed when `TRUST_PROXY` says a proxy you control sets it. The web app forwards the header it receives, so the reverse proxy in front of it must overwrite it. VPN addresses are not office addresses unless you list them.

**Remote mode.** Each person registers a computer once (`POST /devices`, done by the agent's sign-in window). The agent gets a per-device secret, kept in the OS keychain; the server keeps it encrypted (AES-256-GCM, `DEVICE_SECRET_KEY`). Then:

1. *Start work* in the tray opens a session. The agent samples cursor position (5 per second) and the OS idle timer, and sends a **signed heartbeat every 60 s**.
2. Each request carries `HMAC-SHA256(secret, method \n path \n timestamp \n body)`. The server rejects bad signatures, timestamps more than 2 minutes off, and any request number (`seq`) that isn't higher than the last one, so captured requests can't be replayed. Failures are a bare 401.
3. **The server decides, not the agent.** If there is no input for `IDLE_MINUTES`, the server creates an idle prompt. The agent shows an always-on-top window. A click answers it. If nothing happens within `PROMPT_GRACE_SECONDS`, the stretch becomes **absent**, a flag is raised and the manager is notified. Real input afterwards ends the absent period (the period stays on record).
4. If heartbeats stop for `AGENT_OFFLINE_SECONDS`, the gap is recorded as **offline** and flagged (killing the agent isn't a way to hide). The session closes after `OFFLINE_AUTOCLOSE_MINUTES`.
5. **Random presence checks.** About every `CHALLENGE_MEAN_MINUTES` (never within `CHALLENGE_MIN_GAP_MINUTES` of the last), an active person must type a 4-digit code shown on screen. Three wrong answers or no answer raises a flag. It doesn't mark them absent.
6. **Scripted-movement checks** run on the server over quantised steps: tiny back-and-forth jiggle, repeating loops, constant-speed motion, and the same recorded path replayed minute after minute. Hours of mouse-only activity is a low-severity note. All of these only raise flags.

**Review.** Leads see flags for their direct reports, HR/admin and executives see everyone. Leads and HR decide (*excused*, *dismissed*, *confirmed*, with a required note). Executives are read-only. The employee can add an explanation to an open flag, which notifies the manager. Viewing a flag or someone's activity and every decision is written to `audit_log`.

**Employee view.** The Attendance page shows a live "Tracking active" indicator (refreshes every 15 s), totals, a timeline and the flags raised about them, plus their registered computers.

## How tasks work

**Projects scope everything.** A person sees the projects they are a member of, and only those. HR/admin and executives see every project.

| Role | In a project they can see |
|---|---|
| Employee (member) | See all tasks, comment, attach files, and change the status of tasks **assigned to them**. Nothing else. |
| Team lead | The same, plus: **if they are a lead member**, create and assign tasks, edit any task, manage members, archive. A lead in one project has no access to another lead's project. |
| HR/admin | Everything, in every project. |
| Executive | Read-only everywhere. Cannot create, edit, comment or attach. |

A project's `lead` membership only counts while the person's role is still team lead or HR/admin, and it is re-checked on every request. Hidden projects, tasks and files answer 404, not 403, so their existence isn't revealed. Rules live in one place: `apps/api/src/tasks/access.service.ts`.

- **Tasks:** key-based numbers per project (`WEB-12`), status (To do, In progress, In review, Done), priority, assignee (must be an active project member), due date, one level of sub-tasks. Every change is written to the task's history; creation, updates, uploads, downloads and deletions are also in `audit_log`.
- **Board and list:** the board has a column per status. A card moves by drag or by its status menu. The list view filters by project, assignee, status, priority, due date and text (`WEB-12` or words), and sorts client-side.
- **Comments:** plain text, rendered escaped. No edit or delete in v1 (the record is the point).
- **Files:** stored on this server's disk under `UPLOAD_DIR` (default `./data/uploads`), named by a random key, never by the uploaded name. Limit `MAX_UPLOAD_MB` (default 10), 20 files per task. Upload is the raw request body (`application/octet-stream`, name and type in the query string), streamed to disk with the size enforced as bytes arrive. There is no multipart parser, so the `multer` advisory (see below) is not reachable. Downloads are always `Content-Disposition: attachment` with `nosniff` and a sandbox CSP, so an uploaded HTML or SVG file can't run in the portal. Deleting a file removes the bytes and keeps a record. There is **no virus scanning**.
- **Notifications (in the portal bell):** assigned, taken off you, status changed (to the reporter and assignee), due date changed, new comment (to assignee and reporter), plus one **due soon** and one **overdue** reminder per task (`DUE_SOON_DAYS`, checked every 5 minutes). The person who made a change is never notified about it, and nobody who has lost access to the project is. Reminders re-arm when the due date or assignee changes. Email is not wired up.
- **Put `UPLOAD_DIR` on the encrypted, backed-up volume.** Files are not covered by the Postgres backup.

**The `multer` advisory.** `@nestjs/platform-express` pins `multer@2.4.0` exactly, and `npm audit` flags it (DoS through an async `fileFilter`). Nothing here imports multer or uses `FileInterceptor`, so it can't be triggered. Forcing a newer version with an npm override removes the package from `node_modules` (Nest's exact pin conflicts), which makes Nest fail to load, so it was not done. Upgrade `@nestjs/platform-express` when a release pins `multer >= 2.5.0`.

## What is and isn't recorded

Recorded: when input happened (seconds of activity per minute), how many non-mouse input events, quantised cursor steps *during analysis only*, prompt outcomes. The server keeps per-heartbeat counts and derived features, not the steps. Heartbeat rows are deleted after `HEARTBEAT_RETENTION_DAYS`.
Never recorded: screenshots, key identity or text, window titles, file contents, absolute cursor positions.

## Limits

- No software stops a hardware jiggler, or a well-randomised script. These checks make casual cheating visible and send it to a person.
- Anyone who extracts their device secret can forge heartbeats. Keychain storage and revocation raise the bar; they don't remove the risk.
- Keyboard activity is inferred (the OS idle timer reset without the cursor moving), so no global key hook is needed. The focused application is **not** tracked.
- Reading, calls and meetings look idle. That is why "absent" is a flag with an employee explanation, not a penalty.

## Stand-ins to replace in Phase 2

- `users` table and org-ID + password sign-in (`apps/api/src/auth`): no MFA, no lockout or rate limiting, no admin-managed accounts, seeded users only. There is no UI yet for HR to change someone's work mode or manager.
- `audit_log`: minimal, only attendance actions.
- Bind and exposure: the API listens on `HOST` (default 127.0.0.1). Production should bind to the WireGuard address only.
- Agent endpoints are served by the API directly and are blocked in the web app's proxy. In production, make them reachable over the VPN only.
