# 1Password Integration Setup Guide

This guide explains how to configure your dashboard to read secrets from 1Password instead of a `.env` file.

## Prerequisites

- 1Password account with CLI access
- Service account token created in 1Password
- 1Password CLI (`op`) installed on your VPS

## Step 1: Install 1Password CLI on VPS

```bash
# On your VPS
curl -sSO https://downloads.1password.com/linux/tar/stable/x86_64/1password-cli-latest-linux-amd64.tar.gz
tar -xf 1password-cli-latest-linux-amd64.tar.gz
sudo mv op /usr/local/bin/
rm 1password-cli-latest-linux-amd64.tar.gz

# Verify installation
op --version
```

## Step 2: Create Secrets in 1Password Vault

You need to create an item in your **Dashboard** vault with the following fields:

### Using 1Password Web Interface:

1. Go to your 1Password web app
2. Navigate to the **Dashboard** vault
3. Create a new **Password** item named: `Dashboard Secrets`
4. Add the following custom fields (all as **password** type for security):

| Field Name        | Type     | Description                               |
| ----------------- | -------- | ----------------------------------------- |
| `NEXTAUTH_SECRET` | password | NextAuth.js secret for session encryption |
| `STAKE_MNEMONIC`  | password | Staking wallet mnemonic                   |
| `STAKE_REKEY`     | password | Staking rekey credential                  |
| `REWARD_REKEY`    | password | Reward rekey credential                   |
| `REWARD_MNEMONIC` | password | Reward wallet mnemonic                    |
| `MONGO_URI`       | password | MongoDB connection string                 |

5. Save the item

### Using 1Password CLI:

Alternatively, you can create the item via CLI:

```bash
# Set your service account token temporarily
export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token-here"

# Create the item (interactive - you'll be prompted for each value)
op item create \
  --vault "Dashboard" \
  --title "Dashboard Secrets" \
  --category Password \
  NEXTAUTH_SECRET[password]="your-nextauth-secret" \
  STAKE_MNEMONIC[password]="your-stake-mnemonic" \
  STAKE_REKEY[password]="your-stake-rekey" \
  REWARD_REKEY[password]="your-reward-rekey" \
  REWARD_MNEMONIC[password]="your-reward-mnemonic" \
  MONGO_URI[password]="your-mongo-uri"
```

## Step 3: Configure Service Account Token on VPS

The dashboard wrapper script supports two methods for accessing the service account token:

### Option A: Store Token in 1Password (Recommended)

The wrapper script can automatically read the service account token from 1Password. This is more secure as the token is never stored in plain text on the server.

**Requirements:**

1. Store your service account token in 1Password at: `op://Employee/dbRewardsToken/token`
2. Sign in to 1Password CLI on your VPS before starting PM2

```bash
# On your VPS, sign in to 1Password (one-time setup)
eval $(op signin)

# The wrapper script will automatically read the token from 1Password
# No need to set OP_SERVICE_ACCOUNT_TOKEN manually
pm2 restart dashboard --update-env
pm2 save
```

**Note:** You'll need to run `eval $(op signin)` after each server reboot, or set up the 1Password service account for automated access.

### Option B: Set Token as Environment Variable

If you prefer not to use the 1Password token storage, you can set it directly:

```bash
# On your VPS
export OP_SERVICE_ACCOUNT_TOKEN="$(op read 'op://Employee/dashboardToken/credential')"
./build-with-1password.sh
# Start PM2 with the environment variable
pm2 restart dashboard --update-env

# Save the PM2 configuration
pm2 save
```

### Option C: System-Wide Environment

For persistent configuration across reboots:

```bash
# Add to /etc/environment (requires reboot)
echo 'OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"' | sudo tee -a /etc/environment

# Or use PM2 startup with the token
sudo env OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token" pm2 startup
```

## Step 4: Deploy Updated Files to VPS

Deploy the updated configuration files from your local machine:

```bash
# From your local machine
cd /home/debian

# Deploy dashboard changes
rsync -avz dashboard/ecosystem.config.js user@your-vps:/var/www/dashboard/
rsync -avz dashboard/start-with-1password.sh user@your-vps:/var/www/dashboard/

# Deploy maintenance site fix
rsync -avz maintenance-site/nginx/maintenance.conf user@your-vps:/var/www/maintenance-site/nginx/
```

## Step 5: Set Execute Permission on Wrapper Script

```bash
# On your VPS
chmod +x /var/www/dashboard/start-with-1password.sh
```

## Step 6: Restart Dashboard with New Configuration

```bash
# On your VPS
cd /var/www/dashboard

# Set the service account token (if not already in environment)
export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token-here"

# Restart the dashboard with PM2
pm2 restart dashboard --update-env

# Check logs to verify secrets loaded successfully
pm2 logs dashboard --lines 50
```

You should see output like:

```
Loading secrets from 1Password vault: Dashboard
Successfully loaded secrets from 1Password
Starting dashboard with npm start...
```

## Step 7: Building the Dashboard

When you need to build the dashboard (e.g., after code changes), use the build wrapper script:

```bash
# Set the service account token
export OP_SERVICE_ACCOUNT_TOKEN="$(op read 'op://Employee/dashboardToken/credential')"

# Run the build script
./build-with-1password.sh
```

The script will:

1. Load all secrets from 1Password
2. Validate the MONGO_URI format
3. Run `npm run build` with all environment variables available

**Note:** Regular `npm run build` will fail because it doesn't have access to the secrets. Always use `build-with-1password.sh` instead.

## Step 8: Remove .env File (Optional but Recommended)

Once you've confirmed everything works:

```bash
# On your VPS
cd /var/www/dashboard

# Backup the .env file first
mv .env .env.backup.$(date +%Y%m%d)

# Or delete it entirely (after testing!)
# rm .env
```

## Troubleshooting

### Error: "OP_SERVICE_ACCOUNT_TOKEN environment variable is not set"

**Solution:** Ensure the token is exported before starting PM2:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
pm2 restart dashboard --update-env
```

### Error: "Failed to retrieve [field] from 1Password"

**Possible causes:**

1. Field name doesn't match exactly in 1Password (case-sensitive)
2. Service account doesn't have access to the Dashboard vault
3. Item name is incorrect (should be "Dashboard Secrets")

**Solution:** Verify the item exists and field names match:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
op item get "Dashboard Secrets" --vault "Dashboard" --format json
```

### Dashboard fails to start

**Check PM2 logs:**

```bash
pm2 logs dashboard --err --lines 100
```

**Check if script is executable:**

```bash
ls -la /var/www/dashboard/start-with-1password.sh
```

Should show: `-rwxr-xr-x` (executable)

## Security Best Practices

1. **Never commit** the service account token to git
2. **Rotate** the service account token periodically
3. **Limit** service account access to only the Dashboard vault
4. **Monitor** 1Password activity logs for unauthorized access
5. **Delete** the old `.env` file after confirming everything works
6. **Backup** secrets in a secure location (1Password is your backup, but consider a recovery kit)

## Testing the Setup

1. Test secret retrieval manually:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
op item get "Dashboard Secrets" --vault "Dashboard" --fields "MONGO_URI"
```

2. Test the wrapper script:

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
cd /var/www/dashboard
./start-with-1password.sh
```

3. Monitor PM2 logs during restart:

```bash
pm2 logs dashboard --lines 100
```

## Maintenance Toggle After Changes

After deploying the nginx fix, test the maintenance toggle:

```bash
# Enable maintenance mode
sudo /var/www/maintenance-site/scripts/maintenance on --pm2

# Verify at https://dashboard.frynetworks.com
# Should show maintenance page

# Disable maintenance mode
sudo /var/www/maintenance-site/scripts/maintenance off --pm2

# Verify dashboard is back online
```

## Notes

- The wrapper script (`start-with-1password.sh`) loads secrets at startup time only
- If you update secrets in 1Password, you must restart PM2: `pm2 restart dashboard`
- The `OP_SERVICE_ACCOUNT_TOKEN` must be available in the environment when PM2 starts the dashboard
- Field names in 1Password are case-sensitive and must match exactly
