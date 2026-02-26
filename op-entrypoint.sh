#!/usr/bin/env sh
set -eu

secret_file="/run/secrets/op_service_account_token"
if [ ! -r "${secret_file}" ]; then
  echo "Error: 1Password token secret not readable at ${secret_file}" >&2
  exit 1
fi

OP_SERVICE_ACCOUNT_TOKEN="$(tr -d '\r\n' < "${secret_file}")"
if [ -z "${OP_SERVICE_ACCOUNT_TOKEN}" ]; then
  echo "Error: OP_SERVICE_ACCOUNT_TOKEN is empty." >&2
  exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN
export OP_CONFIG_DIR="${OP_CONFIG_DIR:-/tmp/op}"
mkdir -p "${OP_CONFIG_DIR}"
chmod 700 "${OP_CONFIG_DIR}"

exec op run -- "$@"
