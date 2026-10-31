# Nuvia

In-house work platform: tasks, attendance and a leadership view. Self-hosted, reachable only over the company VPN.

| Path | What |
|---|---|
| `backend/` | NestJS API: org-ID sign-in with MFA, roles and permissions, audit log (Phase 2) |
| `docker-compose.yml` | API + Postgres + TLS proxy; only the proxy publishes a port, on the VPN address |
| `infra/` | WireGuard, Azure network rules, backups, restore test, exposure check |
| `docs/deployment.md` | How to set it up on the Azure VM and run it |
| `docs/security.md` | What is enforced, where, and what is still open |

Status: Phase 2 (secure base). The API and the scripts are built and tested. Applying them on the Azure VM is not done yet; see `docs/deployment.md`.

## Develop

```sh
docker run -d --name nuvia-test-pg -e POSTGRES_USER=nuvia -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
cd backend && npm ci
npm test            # unit tests, no database needed
npm run test:e2e    # drives the real app against the Postgres above
```
