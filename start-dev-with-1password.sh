#!/usr/bin/env bash
# Dev bootstrapper that pulls secrets from 1Password and starts Next.js in dev mode.
set -euo pipefail

# Ensure the service account token is available for the 1Password CLI.
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: OP_SERVICE_ACCOUNT_TOKEN is not available. Run:" >&2
  echo "  export OP_SERVICE_ACCOUNT_TOKEN=\"\$(op read 'op://TestersDashboard/Dash Secrets/OP_SERVICE_ACCOUNT_TOKEN')\"" >&2
  echo "after signing in with: eval \$(op signin)" >&2
  exit 1
fi

vault="TestersDashboard"
item="Dash Secrets"

read_secret() {
  local field_path="op://${vault}/${item}/$1"
  local value
  if ! value=$(op read "${field_path}" 2>/dev/null); then
    echo "Error: Failed to read ${field_path}" >&2
    exit 1
  fi
  # Trim trailing newline characters if present.
  value=$(echo -n "${value}" | tr -d '\r')
  if [ -z "${value}" ]; then
    echo "Error: Field ${field_path} is empty." >&2
    exit 1
  fi
  echo -n "${value}"
}

export NEXTAUTH_URL="$(read_secret NEXTAUTH_URL)"
export NEXTAUTH_SECRET="$(read_secret NEXT_AUTH_SECRET)"
export STAKE_MNEMONIC="$(read_secret STAKE_MNEMONIC)"
export STAKE_REKEY="$(read_secret STAKE_REKEY)"
export REWARD_MNEMONIC="$(read_secret REWARD_MNEMONIC)"
export REWARD_REKEY="$(read_secret REWARD_REKEY)"
export MONGO_URI="$(read_secret MONGO_URI)"
export VER_MONGO_URI="$(read_secret VER_MONGO_URI)"
export DISCORD_BUG_WEBHOOK_URL="$(read_secret DISCORD_BUG_WEBHOOK_URL)"

if [[ ! "${MONGO_URI}" =~ ^mongodb(\+srv)?:// ]]; then
  echo "Error: MONGO_URI from 1Password does not start with mongodb:// or mongodb+srv://" >&2
  exit 1
fi

# Use dev-mode defaults if not already provided by Compose.
export NODE_ENV="${NODE_ENV:-development}"
export NEXT_PUBLIC_TEST_MODE="${NEXT_PUBLIC_TEST_MODE:-true}"
export NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED="${NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED:-true}"
export DISABLE_DEVICE_FINGERPRINT="${DISABLE_DEVICE_FINGERPRINT:-true}"

echo "Loaded secrets from 1Password vault '${vault}' item '${item}'."
echo "Starting Next.js dev server..."

exec npm run dev -- --hostname 0.0.0.0 --port "${PORT:-3007}"
