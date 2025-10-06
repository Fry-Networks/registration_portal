import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext } from './types';

/**
 * Validator for Shelly devices
 */
export class ShellyValidator extends BaseValidator {
  getDeviceType(): string {
    return 'shelly';
  }

  getRequiredFields(): string[] {
    return ['auth_key', 'serverUrl'];
  }

  async validateCredentials(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult> {
    // Check required fields
    const missing = this.validateRequiredFields(credentials);
    if (missing.length > 0) {
      return this.createErrorResult(`Missing required fields: ${missing.join(', ')}`);
    }

    const { auth_key, serverUrl } = credentials;

    // Validate auth key format (92 alphanumeric characters)
    if (auth_key.length !== 92 || !/^[A-Za-z0-9]+$/.test(auth_key)) {
      return this.createErrorResult('Invalid auth key format (must be 92 alphanumeric characters)');
    }

    // Validate server URL format
    const shellyServerUrlRegex = /^https:\/\/shelly-[a-zA-Z0-9-]+\.shelly\.cloud$/;
    if (!shellyServerUrlRegex.test(serverUrl)) {
      return this.createErrorResult('Invalid server URL format (must be like https://shelly-***.shelly.cloud)');
    }

    try {
      // For Shelly, we mainly validate format since testing the actual API 
      // would require specific device endpoints. In a real implementation,
      // you could test with a generic endpoint or device list endpoint.
      return this.createSuccessResult([{
        deviceId: credentials['deviceId'] || 'shelly-device',
        deviceName: `Shelly Device (${serverUrl})`,
        deviceType: 'shelly'
      }]);

    } catch (error: any) {
      return this.createErrorResult(
        error?.message || 'Failed to validate Shelly credentials'
      );
    }
  }
}