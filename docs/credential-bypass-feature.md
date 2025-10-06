# Credential Configuration Feature

## Overview

This feature allows you to temporarily bypass credential requirements for specific device types during the registration process. This is useful when certain device types don't yet require credential configuration.

## Environment Variable Configuration

Add the following environment variable to your `.env` file:

```bash
NEXT_PUBLIC_CREDENTIALS_NEEDED=AEM,BM
```

- **Variable Name**: `NEXT_PUBLIC_CREDENTIALS_NEEDED`
- **Format**: Comma-separated list of device type prefixes that DO need credentials (case-insensitive)
- **Example Values**: 
  - `HWM` - High End Weather Miner
  - `CN` - Contributor Node
  - `AEM` - AI Edge Miner
  - Any other device type prefix that requires credential configuration

## How It Works

1. **Device Type Detection**: The system extracts the device type from the miner key (the part before the first hyphen)
2. **Environment Check**: If the device type is NOT listed in the environment variable, credentials are skipped
3. **UI Changes**: Instead of the normal credential form, users see a friendly message explaining that credentials aren't needed
4. **Validation**: The `credentialsValidated` state is automatically set to `true`, enabling the "Next" button

## User Experience

When credentials are skipped:
- Users see a green checkmark icon with "No Credentials Required" message
- The device type is displayed for clarity
- Users can proceed directly to the next step (Personal Information)
- The normal credential validation flow is bypassed

## Example Miner Keys

If your environment variable is `NEXT_PUBLIC_CREDENTIALS_NEEDED=AEM,BM`:

- `AEM-Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` → Normal credentials required
- `BM-Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` → Normal credentials required
- `HWM-Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` → Credentials skipped ✓
- `CN-Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` → Credentials skipped ✓

## Implementation Details

- **Location**: `pages/register.tsx`
- **State Management**: Uses `useMemo` and `useEffect` for reactive environment checking
- **Conditional Rendering**: Renders different UI based on `credentialsNotNeeded` flag
- **Button Logic**: Next button is enabled when credentials aren't needed OR when they are validated

## Removing the Feature

To disable this feature entirely:
1. Remove or comment out the `NEXT_PUBLIC_CREDENTIALS_NEEDED` environment variable
2. The system will revert to skipping credentials for all device types (since no devices will be listed as needing them)

## Testing

1. Set the environment variable with device types that need credentials
2. Register a device with a miner key that does NOT match any of the prefixes
3. Verify the credentials step shows the "No Credentials Required" message
4. Confirm you can proceed to the next step without validation
5. Test with a device type that IS in the list to verify normal credential flow works