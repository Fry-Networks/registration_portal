#!/usr/bin/env bash
# Wrapper script to start the dashboard with secrets from 1Password
set -euo pipefail

# Try to load OP_SERVICE_ACCOUNT_TOKEN from 1Password if not already set
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "OP_SERVICE_ACCOUNT_TOKEN not set, attempting to read from 1Password..."
  if command -v op >/dev/null 2>&1; then
    # Try to read the token from 1Password (requires user to be signed in to 1Password)
    export OP_SERVICE_ACCOUNT_TOKEN="$(op read 'op://Employee/dashboardToken/credential' 2>/dev/null || true)"
  fi
fi

# Verify we have a token now
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: OP_SERVICE_ACCOUNT_TOKEN is not available." >&2
  echo "Either set it as an environment variable or ensure you're signed in to 1Password CLI." >&2
  exit 1
fi

# 1Password vault and item names
VAULT="Dashboard"
ITEM="Dashboard Secrets"

echo "Loading secrets from 1Password vault: ${VAULT}"

# Function to fetch secret from 1Password and trim whitespace
get_secret() {
  local field_name="$1"
  local value
  value=$(op item get "${ITEM}" --vault "${VAULT}" --fields "${field_name}" --reveal 2>/dev/null || {
    echo "Error: Failed to retrieve ${field_name} from 1Password" >&2
    exit 1
  })
  # Trim leading and trailing whitespace/newlines
  echo "$value" | tr -d '\n\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# Load secrets from 1Password
export NEXTAUTH_SECRET=$(get_secret "NEXTAUTH_SECRET")
export STAKE_MNEMONIC=$(get_secret "STAKE_MNEMONIC")
export STAKE_REKEY=$(get_secret "STAKE_REKEY")
export REWARD_REKEY=$(get_secret "REWARD_REKEY")
export REWARD_MNEMONIC=$(get_secret "REWARD_MNEMONIC")
export MONGO_URI=$(get_secret "MONGO_URI")

# Debug: Check if MONGO_URI is valid
if [[ ! "$MONGO_URI" =~ ^mongodb(\+srv)?:// ]]; then
  echo "Error: MONGO_URI does not start with mongodb:// or mongodb+srv://" >&2
  echo "MONGO_URI value: '$MONGO_URI'" >&2
  echo "Length: ${#MONGO_URI}" >&2
  exit 1
fi

echo "Successfully loaded secrets from 1Password"

# Export public configuration variables
export NODE_ENV='production'
export NEXTAUTH_URL='https://dashboard.frynetworks.com'
export NEXTAUTH_URL_INTERNAL='http://localhost:3007'
export NEXT_PUBLIC_API_HOST='https://airback.frynetworks.com'
export NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED='true'
export NEXT_PUBLIC_TEST_MODE='false'
export WEEKLY_CUTOFF_UTC='2025-09-12T00:00:00.000Z'
export BUG_REPORT_RATE_LIMIT_HOURS='12'
export NEXT_PUBLIC_CREDENTIALS_NEEDED='AEM'

echo "Starting dashboard with npm start..."

# Execute npm start with the loaded environment variables
exec npm start
