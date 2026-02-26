import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext } from './types';

/**
 * Validator for Awair devices
 */
export class AwairValidator extends BaseValidator {
  getDeviceType(): string {
    return 'awair';
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

    // Validate token format (32-128 characters, alphanumeric with _ and -)
    if (token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return this.createErrorResult('Invalid token format (must be 32-128 characters, alphanumeric with _ and -)');
    }

    // Validate device ID format (numeric, 3-12 digits)
    if (!/^\d{3,12}$/.test(device_id)) {
      return this.createErrorResult('Invalid device ID format (must be 3-12 digits)');
    }

    try {
      // Test the credentials by making a request to Awair API
      const response = await this.makeRequest(`https://developer-apis.awair.is/v1/users/self/devices/${device_id}/air-data/latest`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.createErrorResult(
          errorData?.message || `Awair API validation failed with status ${response.status}`
        );
      }

      return this.createSuccessResult([{
        deviceId: device_id,
        deviceName: `Awair Device ${device_id}`,
        deviceType: 'awair'
      }]);

    } catch (error: any) {
      return this.createErrorResult(
        error?.message || 'Failed to validate Awair credentials'
      );
    }
  }
}