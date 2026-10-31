# Deployment runbook: Azure VM, VPN only

Everything below is in this repo. **Verified locally:** the Docker stack (build, migrate, HTTPS through Caddy,
full sign-in, create-admin CLI), backups, restore test (including that it fails on a corrupt or tampered backup),
the exposure check. **Not yet run on the VM:** WireGuard setup, the Azure rules, ufw, systemd timers, offsite upload.
Treat the first run of those as a test and read each script before running it.

The VM is shared with other things, so nothing here deletes or blocks existing rules automatically.

## 1. First-time setup

**a. Azure network rules** (from an admin machine with `az login`)

```sh
ADMIN_SSH_CIDR=203.0.113.7/32 infra/azure/nsg.sh apply <resource-group> <nsg-name>
infra/azure/nsg.sh check <resource-group> <nsg-name>   # lists other rules open to the internet; remove what Nuvia does not need
```

**b. On the VM** (Ubuntu): install Docker, clone this repo to `/opt/nuvia`, then

```sh
sudo infra/wireguard/setup-server.sh            # add CONFIGURE_UFW=yes only after reading what it prints
./scripts/gen-secrets.sh                        # creates .env with random secrets
# edit .env: NUVIA_HOSTNAME, APP_ORIGIN (https://<hostname>), VPN_BIND_ADDR=10.8.0.1
docker compose up -d --build
docker compose exec app node dist/cli/create-admin.js --org-id NV-0001 --name "..." --email ...
```

The admin gets a temporary password, then must choose their own and set up an authenticator on first sign-in.
Save `APP_ENCRYPTION_KEY` from `.env` in a safe place that is not the backup location.

**c. Staff devices**

```sh
sudo WG_ENDPOINT=<vm-public-ip-or-dns> infra/wireguard/add-peer.sh asha-laptop 10.8.0.12   # writes peers/asha-laptop.conf
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./nuvia-root.crt        # once; install on each device
```

Give the person the `.conf` (it holds their private key), have them import it, add the hosts line the file
mentions, and trust `nuvia-root.crt`. Delete the `.conf` from the server afterwards. Lost device:
`sudo infra/wireguard/remove-peer.sh asha-laptop`, and deactivate the user if they have left.

**d. Prove nothing is exposed**

```sh
infra/verify-exposure.sh public <vm-public-ip>      # from a network outside the VPN: must PASS
infra/verify-exposure.sh vpn nuvia.internal nuvia-root.crt   # from a device on the VPN: must PASS
```

Tick "Set up VPN-only access" in the tracker only when both pass.

**e. Disks and Azure Backup** (check current Azure documentation for exact flags)

Turn on disk encryption (encryption at host, or Azure Disk Encryption) and Azure Backup for the VM.

## 2. Backups

The server encrypts backups to a **public** key, so it cannot read them. Keep the private key offline.

```sh
infra/backup/generate-key.sh ./keys           # on an admin machine, not the server
# copy keys/backup-public.asc to /opt/nuvia/infra/backup/ ; store backup-private.asc offline, then delete it here
cp infra/backup/backup.env.example infra/backup/backup.env     # fill in the offsite account and container
az login --identity                           # on the VM, so the offsite upload can sign in
sudo cp infra/backup/nuvia-backup.* /etc/systemd/system/ && sudo systemctl enable --now nuvia-backup.timer
infra/backup/backup.sh                        # run once by hand and read the output
```

`nuvia-backup.service` reads `infra/backup/backup.env`. The offsite copy (storage account in another region) is
what survives losing the VM: without it `backup.sh` prints a warning and the backup is local only.

**Restore test** (a backup you have not restored is a hope, not a backup). On a machine that has the private key:

```sh
infra/backup/restore-test.sh        # newest backup into a scratch database; checks users, migrations, audit chain; drops it
```

Run it after the first backup and then monthly. The result goes to `restore-test.log`. Tick "Backup restore
test" (Phase 7) only after a run against a backup of the real server data.

**Restoring for real:** restore into a new database name (`infra/backup/restore.sh <file> nuvia_restored`), run
`node dist/cli/verify-audit.js` against it, stop the stack, then in a maintenance window rename the databases
(`ALTER DATABASE nuvia RENAME TO nuvia_old; ALTER DATABASE nuvia_restored RENAME TO nuvia;`) and start again.
`restore.sh` refuses to overwrite the live database on purpose.

## 3. Day to day

| Task | How |
|---|---|
| Add an employee | HR/admin: `POST /admin/users` (screen comes with the frontend); give them the temporary password in person |
| Lost phone, no recovery codes | `POST /admin/users/:id/reset-mfa`; they set up again at next sign-in |
| Forgot password | `POST /admin/users/:id/reset-password` |
| Someone left | deactivate the user (`PATCH /admin/users/:id {"active":false}`) and `remove-peer.sh` their devices |
| Check the log | `GET /audit?actor=NV-0042&action=auth` and `GET /audit/verify` |
| Upgrade | `git pull && docker compose up -d --build` (migrations run on start) |
