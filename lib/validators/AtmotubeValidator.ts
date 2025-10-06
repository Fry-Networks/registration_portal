import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext } from './types';

/**
 * Validator for Atmotube devices
 */
export class AtmotubeValidator extends BaseValidator {
  getDeviceType(): string {
    return 'atmotube';
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

    // Validate token format (16-128 characters, alphanumeric with _ -)
    if (token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      return this.createErrorResult('Invalid token format (must be 16-128 characters, alphanumeric with _ -)');
    }

    // Validate device ID format (3-64 characters, alphanumeric with : _ -)
    if (device_id.length < 3 || device_id.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(device_id)) {
      return this.createErrorResult('Invalid device ID format (must be 3-64 characters, alphanumeric with : _ -)');
    }

    try {
      // For now, just validate the format since Atmotube API might not be easily testable
      // In a real implementation, you would make an API call here
      return this.createSuccessResult([{
        deviceId: device_id,
        deviceName: `Atmotube Device ${device_id}`,
        deviceType: 'atmotube'
      }]);

    } catch (error: any) {
      return this.createErrorResult(
        error?.message || 'Failed to validate Atmotube credentials'
      );
    }
  }
}