# Hardware Credentials Migration Tool

This tool migrates hardware device credentials from the old `air.hardwares` and `air.nodes` collections to the new unified `creds.hardware` collection.

## Problem Statement

Users who registered hardware devices (BM, IDM, ODM, ISM, OSM, AEM, RDN, SDN, SVN) before the credential system migration have their MAC addresses stored in:
- `air.hardwares` collection (for Decibel, Satellite, Bandwidth miners)
- `air.nodes` collection (for Reward, Storage, Validator nodes)

This causes the error **"Miner Key already exists in database"** when trying to re-register because the AirAPI route checks these old collections.

## What This Tool Does

1. **Scans** both `air.hardwares` and `air.nodes` collections
2. **Checks** if each device is already migrated to `creds.hardware`
3. **Verifies** the device status in `main.devices`
4. **Copies** the document to `creds.hardware` (preserving all original fields)
5. **Updates** `registered_portal_model` in `main.devices` to 'hardware'
6. **Deletes** the old collection entry
7. **Generates** detailed logs and reports

## Prerequisites

- Node.js and TypeScript installed
- MongoDB connection string in environment variables
- Backup of your databases (recommended)

## Installation

The script is already added to `package.json`. No additional installation needed.

## Usage

### Basic Usage (Interactive Mode)

```bash
npm run migrate-hardware-creds
```

This will:
- Prompt you for confirmation on each device
- Create automatic backups before migration
- Show detailed information for each device
- Allow you to skip, quit, or approve each migration

### Auto Mode (No Prompts)

```bash
npm run migrate-hardware-creds -- --auto
```

Use this when you're confident and want to migrate all devices without prompts.

### Dry Run (Preview Only)

```bash
npm run migrate-hardware-creds -- --dry-run
```

See what would be migrated without making any changes.

### Migrate Specific Device

```bash
npm run migrate-hardware-creds -- --miner-key IDM-IE5TKOOIX57KHZUMG1FXTBO6ISO2R6JK
```

Test with a single device first before running the full migration.

### All Options Combined

```bash
npm run migrate-hardware-creds -- --miner-key RDN-Y3NM1HLZTNLJSDFWAO9NLDN7PXHGV79H --dry-run
```

## Command-Line Options

| Option | Description |
|--------|-------------|
| `--auto` | Auto-approve all migrations (no prompts) |
| `--dry-run` | Preview changes without executing |
| `--miner-key <key>` | Migrate specific miner key only |
| `--skip-portal` | Don't update registered_portal_model |
| `--backup-dir <path>` | Custom backup directory (default: ./backups) |
| `--help` | Show help message |

## Affected Device Types

The following miner key prefixes will be migrated:

- **BM** - Bandwidth Miner
- **IDM/ODM** - Indoor/Outdoor Decibel Miner
- **ISM/OSM** - Indoor/Outdoor Satellite Miner
- **AEM** - Fry Edge Miner
- **RDN** - Reward Decentralization Node
- **SDN** - Storage Decentralization Node
- **SVN** - Storage Validator Node

## Example Interactive Session

```
🔌 Connected to MongoDB

📦 Creating backups...
  ✓ Backed up 45 documents from air.hardwares
  ✓ Backed up 105 documents from air.nodes

  Backups saved to: ./backups

📊 Scanning air.hardwares...
  Found 45 documents

📊 Scanning air.nodes...
  Found 105 documents

📋 Total devices to process: 150

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Device: IDM-IE5TKOOIX57KHZUMG1FXTBO6ISO2R6JK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: air.hardwares
Device ID (MAC): 6c-4b-90-ed-fb-a6
Type: Decibel
User ID: 68a7a2025d584e70703b7bda
Timestamp: 2025-08-21T23:07:37.006Z

Main DB Status:
  ✓ is_registered: true
  ○ registered_portal_model: (will set to hardware)

Creds DB Status:
  ✗ Not in creds.hardware

Actions to perform:
  1. Copy document to creds.hardware (preserve all fields)
  2. Set registered_portal_model='hardware' in main.devices
  3. Delete from air.hardwares

Proceed? [Y/n/skip/quit]: y

  ✓ Copied to creds.hardware
  ✓ Set registered_portal_model='hardware'
  ✓ Deleted from air.hardwares

✅ Migration successful
```

## Output & Logs

### Console Output

The tool provides color-coded output:
- 🟢 **Green** - Successful operations
- 🔵 **Blue** - Information
- 🟡 **Yellow** - Warnings (already migrated, orphaned)
- 🔴 **Red** - Errors
- ⚪ **Gray** - Details and timestamps

### Backup Files

Before migration, the tool creates backups in `./backups/`:
- `air-hardwares-YYYY-MM-DDTHH-mm-ss.json`
- `air-nodes-YYYY-MM-DDTHH-mm-ss.json`

### Migration Logs

After migration, a detailed log is saved:
- `migration-log-YYYY-MM-DDTHH-mm-ss.json`

Log contents:
```json
{
  "timestamp": "2025-10-07T00:00:00Z",
  "options": {
    "auto": false,
    "dryRun": false
  },
  "summary": {
    "airHardwaresScanned": 45,
    "airNodesScanned": 105,
    "alreadyMigrated": 23,
    "newlyMigrated": 120,
    "orphaned": 5,
    "errors": 2,
    "skipped": 0
  },
  "details": [
    {
      "miner_key": "IDM-...",
      "action": "migrated",
      "from_collection": "air.hardwares",
      "timestamp": "2025-10-07T00:00:00Z"
    }
  ]
}
```

## Migration Summary Report

At the end, the tool shows a comprehensive summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 MIGRATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Documents Scanned:
  air.hardwares: 45
  air.nodes: 105
  Total: 150

Migration Results:
  Already migrated: 23
  Newly migrated: 120
  Orphaned: 5
  Skipped: 0
  Errors: 2

Verification:
  air.hardwares remaining: 0
  air.nodes remaining: 0
  creds.hardware total: 143

📄 Log saved to: ./backups/migration-log-2025-10-07T00-00-00.json

✅ Migration complete!
```

## Troubleshooting

### "MONGODB_URI environment variable not set"

Make sure your `.env` file contains:
```
MONGODB_URI=mongodb+srv://...
```

Or set it before running:
```bash
MONGODB_URI=mongodb+srv://... npm run migrate-hardware-creds
```

### Device Shows as "Orphaned"

This means the device exists in `air.hardwares` or `air.nodes` but not in `main.devices`. The tool will still migrate it, but you should investigate why it's missing from the main database.

### "Already migrated" Messages

This is normal if you've run the tool before or if your colleague has already migrated some devices. The tool will skip these and just clean up the old collection.

## Safety Features

1. **Automatic Backups** - Creates JSON backups before any changes
2. **Idempotent** - Can be run multiple times safely
3. **Dry Run Mode** - Preview before executing
4. **Interactive Prompts** - Review each device before migration
5. **Detailed Logging** - Track every action taken
6. **Schema Preservation** - Keeps all original fields intact
7. **Atomic Operations** - Each device migration is independent

## Testing Recommendation

1. **First**, test with your three problem keys:
   ```bash
   npm run migrate-hardware-creds -- --miner-key IDM-IE5TKOOIX57KHZUMG1FXTBO6ISO2R6JK --dry-run
   npm run migrate-hardware-creds -- --miner-key RDN-Y3NM1HLZTNLJSDFWAO9NLDN7PXHGV79H --dry-run
   npm run migrate-hardware-creds -- --miner-key BM-BUIER6SJDWRCR24RBT47ORYXKN4CXMD9 --dry-run
   ```

2. **Then**, run actual migration for these three:
   ```bash
   npm run migrate-hardware-creds -- --miner-key IDM-IE5TKOOIX57KHZUMG1FXTBO6ISO2R6JK
   npm run migrate-hardware-creds -- --miner-key RDN-Y3NM1HLZTNLJSDFWAO9NLDN7PXHGV79H
   npm run migrate-hardware-creds -- --miner-key BM-BUIER6SJDWRCR24RBT47ORYXKN4CXMD9
   ```

3. **Finally**, once confident, run full migration:
   ```bash
   npm run migrate-hardware-creds -- --auto
   ```

## Post-Migration Verification

After migration, verify:
1. Check `air.hardwares` is empty: Should have 0 documents
2. Check `air.nodes` is empty: Should have 0 documents
3. Check `creds.hardware` has all devices
4. Verify `registered_portal_model='hardware'` in `main.devices`
5. Test user registration - should no longer see "Miner Key already exists" error

## Support

If you encounter issues:
1. Check the migration log file in `./backups/`
2. Review the backup files to ensure data integrity
3. Contact the development team with the log file

## Related Files

- Migration Script: `scripts/migrate-hardware-credentials.ts`
- Credential Utils: `pages/api/credentials/utils.ts`
- Save Credentials: `pages/api/devices/save-credentials.ts`
- AirAPI Route (error source): `../AirAPI/src/api/routes/submitRegisterHDRoute.ts`
