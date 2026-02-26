# 1Password Integration Setup Guide (Docker Runtime Secrets)

This guide explains how to run the dashboard with runtime-only 1Password secret injection.
No secrets are used during `next build`; only at `next start` inside the container.

## Prerequisites

- Docker + Docker Compose on the host
- 1Password service account token with access to the **Dashboard** vault
- Ability to create a root-owned secret file on the host at:
  `/etc/opt/dashb/op_service_account_token`

## Step 1: Create Secrets in 1Password

Create an item named **Dash Secrets** in the **Dashboard** vault.

The authoritative list of required fields is the `op://...` references in:
`docker-compose.yml` (and `docker-compose-dev.yml` for dev).

Minimum core fields commonly required:

- `NEXTAUTH_URL`
- `NEXT_AUTH_SECRET`
- `STAKE_MNEMONIC`
- `STAKE_REKEY`
- `REWARD_MNEMONIC`
- `REWARD_REKEY`
- `MONGO_URI`
- `VER_MONGO_URI`
- `DISCORD_BUG_WEBHOOK_URL`
- `DISCORD_USER_BUG_WEBHOOK_URL`
- `DIMO_CLIENT_ID`
- `DIMO_CLIENT_SECRET`
- `DIMO_REDIRECT_URI`
- `DIMO_HASH_SECRET`

## Step 2: Store the Service Account Token on the Host

Docker secrets are file-based. The filename does not matter; the container
reads the token from `/run/secrets/op_service_account_token`.

Create the host file with tight permissions:

```bash
sudo install -o root -g 1001 -m 0440 /dev/stdin /etc/opt/dashb/op_service_account_token <<'EOF'
<paste-your-op-service-account-token-here>
EOF
```

If you already created the file, ensure ownership and permissions match:

```bash
sudo chown root:1001 /etc/opt/dashb/op_service_account_token
sudo chmod 0440 /etc/opt/dashb/op_service_account_token
```

The container runs as UID/GID 1001. Ensure any bind-mounted paths (for example,
`/home/helpdesk/subdomains/dashb/logs`) are writable by UID/GID 1001.

## Step 3: Run with Docker Compose

The compose files already:

- mount the secret file as `op_service_account_token`
- export `OP_SERVICE_ACCOUNT_TOKEN` at runtime from `/run/secrets/...`
- run `op run -- <start command>` so `op://` references resolve at runtime

No secrets are injected at build time.

```bash
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
```

Dev (optional):

```bash
docker compose -f docker-compose-dev.yml up -d
```

## Troubleshooting

**Error: OP_SERVICE_ACCOUNT_TOKEN not available**

- Confirm the secret file exists on the host:
  `/etc/opt/dashb/op_service_account_token`
- Confirm the secret is mounted in the container:
  `docker compose exec fry-dashboard-users ls -l /run/secrets`

**Error: Failed to retrieve [field] from 1Password**

- Ensure the service account has access to the **Dashboard** vault
- Ensure the field names in **Dash Secrets** match the `op://` references
  in `docker-compose.yml` exactly (case-sensitive)

## Security Notes

- Do not put the service account token in `.env`, `docker-compose.yml`, or git
- Avoid exporting `OP_SERVICE_ACCOUNT_TOKEN` in the host environment
- Rotate the token periodically and update the host file
