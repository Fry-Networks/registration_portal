import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext } from './types';

/**
 * Validator for Kaiterra devices
 */
export class KaiterraValidator extends BaseValidator {
  getDeviceType(): string {
    return 'kaiterra';
  }

  getRequiredFields(): string[] {
    return ['token', 'device_id'];
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

    const { token, device_id } = credentials;

    // Validate token format (32-128 alphanumeric characters)
    if (token.length < 32 || token.length > 128 || !/^[A-Za-z0-9]+$/.test(token)) {
      return this.createErrorResult('Invalid token format (must be 32-128 alphanumeric characters)');
    }

    // Validate device ID format (3-64 characters, alphanumeric with : _ -)
    if (device_id.length < 3 || device_id.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(device_id)) {
      return this.createErrorResult('Invalid device ID format (must be 3-64 characters, alphanumeric with : _ -)');
    }

    try {
      // Test the credentials by making a request to Kaiterra API
      const response = await this.makeRequest(`https://api.kaiterra.com/v1/lasereggs/${device_id}`, {
        method: 'GET',
        headers: {
          'X-API-Key': token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.createErrorResult(
          errorData?.message || `Kaiterra API validation failed with status ${response.status}`
        );
      }

      return this.createSuccessResult([{
        deviceId: device_id,
        deviceName: `Kaiterra Device ${device_id}`,
        deviceType: 'kaiterra'
      }]);

    } catch (error: any) {
      return this.createErrorResult(
        error?.message || 'Failed to validate Kaiterra credentials'
      );
    }
  }
}