# Security model (Phase 2)

## Roles and what they hold

Decided on the server from the role stored in the database. Nothing the browser sends can raise it.
Source of truth: `backend/src/rbac/roles.ts`.

| Permission | Employee | Lead | HR/admin | CEO/CTO/COO |
|---|:-:|:-:|:-:|:-:|
| `attendance:self`, `tasks:self` | yes | yes | yes | yes |
| `attendance:team`, `tasks:manage` | | yes | | |
| `attendance:all` | | | yes | yes |
| `tasks:read_all` | | | | yes |
| `users:read` | | | yes | yes |
| `users:manage` (create, change role, reset password/MFA, deactivate) | | | yes | |
| `audit:read` | | | yes | yes |
| `leadership:view`, `leadership:set_targets` | | | | yes |

Executives are read-only except for timelines and targets. HR/admin never see revenue.
A role change or deactivation signs the person out at once.

## Sign-in

1. **Org ID + password.** Same answer for wrong password, unknown ID and disabled account, with equal timing.
2. **New or reset account:** the temporary password only opens a "set your own password" step. MFA cannot be set up until that is done, so whoever created the account cannot enrol their own authenticator on it.
3. **MFA is mandatory.** First time: scan the QR, confirm a code, receive 10 one-time recovery codes (shown once, stored hashed). After that: authenticator code or a recovery code.
4. The session token is replaced at every step, so a token captured early is useless later.

| Control | Setting |
|---|---|
| Password hashing | scrypt N=32768, per-user salt; minimum 12 characters, not containing org ID or email name |
| TOTP | 6 digits, 30 s, ±1 step; a code is accepted once (replay blocked) |
| MFA secret at rest | AES-256-GCM with `APP_ENCRYPTION_KEY` |
| Lockout | 5 failed password/MFA attempts locks the account for 15 min (`MAX_FAILED_ATTEMPTS`, `LOCKOUT_MINUTES`) |
| Rate limit | 20 requests/min/IP on `/auth/*` (`AUTH_RATE_LIMIT_PER_MINUTE`) |
| Session | server-side, only a SHA-256 of the token stored; 30 min idle, 12 h absolute |
| Cookie | `__Host-nuvia_sid`, HttpOnly, Secure, SameSite=Strict |
| CSRF | SameSite plus `Origin` check against `APP_ORIGIN` on every non-GET request |
| Accounts | created by HR/admin only; no public signup; first admin from the CLI, which refuses once any account exists |
| Headers | helmet (CSP `default-src 'self'`), HSTS at the proxy; no external scripts, fonts or CDNs |

## Audit log

Every sign-in step (success and failure), logout, password and MFA change, recovery-code use, every user
create/change/reset/deactivate, every refused request (`access.denied`), and every read of the user list and
the audit log itself. Each entry has who, what, target, from where, outcome. Passwords, codes, tokens and
secrets are never written (a test checks this).

- **Append-only:** a database trigger blocks UPDATE, DELETE and TRUNCATE.
- **Tamper-evident:** each row carries the hash of the previous row. `GET /audit/verify` (or
  `node dist/cli/verify-audit.js`) re-computes the chain. If someone with superuser access disables the
  trigger and edits or removes a row, verification reports the first broken row. The restore test runs it.
- **Fails closed:** if an audit write fails, the action fails with it.

Known limit: the chain proves the middle of the log is intact. It cannot show that the newest rows were
removed, because there is nothing after them to point at them. Backups carry the log off the server, so
compare the latest backup against the live log if that matters.

## Network

- Azure NSG: only UDP 51820 inbound (plus SSH from one fixed address if wanted). No 80, no 443.
- Caddy publishes 443 on the WireGuard address only. The app and database publish nothing.
- The app and database sit on an internal Docker network with no route to the internet.
- A VPN device can reach the Nuvia server and nothing else: no forwarding, no peer-to-peer, split tunnel.
- `infra/verify-exposure.sh public <ip>` from outside is the acceptance check.

## Open decisions and known gaps

1. **HR/admin can reset the password or MFA of any account, including executives.** That is how a locked-out
   CEO gets back in, but it also lets an HR/admin take over an executive account. Every such reset is audited
   with the actor and target. Options: let only executives reset executive accounts, or require two admins.
2. **Lead scoping.** `attendance:team` and `tasks:manage` say what a lead may do; "my team only" needs the team
   model from Phases 3 and 4.
3. **No sign-in screens yet.** The API is complete and tested; the login, MFA and change-password pages come with the frontend.
4. **Dependency advisory:** `npm audit` flags `multer` (inside `@nestjs/platform-express`) for a denial of
   service in file upload handling. Phase 2 has no upload endpoint, so it is not reachable. Phase 4
   (attachments) must update or fix it first.
5. **`APP_ENCRYPTION_KEY` loss** means every user sets MFA up again (HR/admin can reset it). Keep a copy apart from the backups.
6. **Not yet verified on the real VM:** WireGuard, the Azure rules, ufw, the systemd timers and the offsite copy
   (see `docs/deployment.md`). They are written and syntax-checked; the peer scripts were tested against a stub.
