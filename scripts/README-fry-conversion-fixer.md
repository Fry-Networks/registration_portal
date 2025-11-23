# Fry Conversion Fixer CLI Tool

A comprehensive CLI tool to diagnose and fix issues in the Fry Networks conversion system, including claim discrepancies and burn transaction reconciliation.

## Installation & Setup

The CLI tool is already installed and configured. It uses the existing 1Password integration to securely access the MongoDB database.

## Usage

Run commands using npm:
```bash
npm run fix-fry-conversion <command> [options]
```

## Commands

### 🔍 `inspect` - Analyze a Wallet
Examine a wallet's conversion record and detect potential issues.

```bash
npm run fix-fry-conversion inspect <wallet-address>
```

**Example:**
```bash
npm run fix-fry-conversion inspect XSSHAYQOPIQB2XVPDUFDTEXYYZV43KXRXQSKOY2P2QZLVLRSEREYSEAZ4E
```

**Output:**
- Complete conversion record (JSON)
- Detailed analysis of claim history
- Discrepancy detection
- Debug information

---

### 🔧 `fix-claims` - Fix Claim Discrepancies
Correct mismatched claim counters based on actual claim history.

```bash
npm run fix-fry-conversion fix-claims <wallet-address> [--dry-run]
```

**Examples:**
```bash
# Dry run (preview changes without applying)
npm run fix-fry-conversion fix-claims WALLET_ADDRESS --dry-run

# Apply the fix
npm run fix-fry-conversion fix-claims WALLET_ADDRESS
```

**What it fixes:**
- ✅ Corrects `claimedMonths` to match actual history
- ✅ Updates `claimableMonths` to available months
- ✅ Recalculates `claimableAmount` properly
- ✅ Clears processing locks if stuck

---

### 🔥 `reconcile-burn` - Fix Burn Transaction Issues
Reconcile burn transactions that weren't properly recorded in the database.

```bash
npm run fix-fry-conversion reconcile-burn <wallet-address> [--txid <transaction-id>]
```

**Examples:**
```bash
# Auto-detect burn transaction
npm run fix-fry-conversion reconcile-burn WALLET_ADDRESS

# Use specific transaction ID
npm run fix-fry-conversion reconcile-burn WALLET_ADDRESS --txid 5JHKPFRN3SEHXNIZ3OLBBDXFPRQVQXUMONO2JFKQGHX4HL2CCP2Q
```

**What it does:**
- 🔍 Searches blockchain for valid burn transactions
- ✅ Updates database to reflect completed burns
- 🔓 Enables conversion process for eligible wallets

---

### 📊 `audit` - System-Wide Analysis
Scan the entire conversion system for potential discrepancies.

```bash
npm run fix-fry-conversion audit
```

**Output:**
- Total conversion records
- Pending vs valid conversions
- List of wallets with claim discrepancies
- Summary statistics

---

## Global Options

### `--dry-run`
Preview changes without applying them to the database.
```bash
npm run fix-fry-conversion fix-claims WALLET --dry-run
```

### `--debug`
Enable detailed debug logging for troubleshooting.
```bash
npm run fix-fry-conversion inspect WALLET --debug
```

## Common Issues & Solutions

### Issue 1: "User shows 0 claimable months despite having pending conversions"
**Symptoms:**
- User completed burn transaction
- Shows eligibility but can't claim
- `claimedMonths` higher than actual claims

**Solution:**
```bash
npm run fix-fry-conversion fix-claims WALLET_ADDRESS
```

### Issue 2: "User burned FRY 1.0 but system didn't register conversion"
**Symptoms:**
- Valid burn transaction on blockchain
- Database still shows "valid" status
- Conversion process stuck

**Solution:**
```bash
npm run fix-fry-conversion reconcile-burn WALLET_ADDRESS
```

### Issue 3: "System shows user claimed more months than history indicates"
**Symptoms:**
- Claim history shows X claims
- `claimedMonths` shows Y claims (Y > X)
- Discrepancy blocking further claims

**Solution:**
```bash
# First inspect to confirm the issue
npm run fix-fry-conversion inspect WALLET_ADDRESS

# Then fix it
npm run fix-fry-conversion fix-claims WALLET_ADDRESS
```

## Example Workflow

1. **User reports claiming issue**
2. **Inspect the wallet:**
   ```bash
   npm run fix-fry-conversion inspect WALLET_ADDRESS
   ```

3. **If discrepancy found, test fix:**
   ```bash
   npm run fix-fry-conversion fix-claims WALLET_ADDRESS --dry-run
   ```

4. **Apply the fix:**
   ```bash
   npm run fix-fry-conversion fix-claims WALLET_ADDRESS
   ```

5. **Verify the fix:**
   ```bash
   npm run fix-fry-conversion inspect WALLET_ADDRESS
   ```

## Security Features

- ✅ **1Password Integration**: Secure credential management
- ✅ **Dry Run Mode**: Test changes before applying
- ✅ **Comprehensive Logging**: Full audit trail
- ✅ **Database Validation**: Checks before modifications
- ✅ **Error Handling**: Graceful failure with detailed errors

## Root Cause Analysis

The primary issue was a **field behavior inconsistency** in the conversion endpoints:

- **Burn/Transfer endpoint**: Only sets `claimedMonths = 1`
- **Claim endpoint**: Increments `claimedMonths++` each claim
- **Problem**: No mechanism to sync these fields correctly

This CLI tool provides a surgical fix by:
1. Analyzing actual claim history (`history[]` array)
2. Recalculating correct field values
3. Updating database with accurate information

## Support

For issues with this tool:
1. Check logs for detailed error messages
2. Use `--debug` flag for additional information
3. Verify 1Password access token is configured
4. Ensure MongoDB connectivity

## Change Log

- **v1.0.0** - Initial release with claim fixes and burn reconciliation
- **Features**: inspect, fix-claims, reconcile-burn, audit commands
- **Security**: 1Password integration, dry-run mode
