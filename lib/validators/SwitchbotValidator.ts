import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext, DeviceInfo } from './types';
import { SwitchbotClient, sanitizeDeviceId } from '../switchbot';
import type { SwitchbotDeviceRecord } from '../switchbot';

/**
 * Validator for SwitchBot devices
 */
export class SwitchbotValidator extends BaseValidator {
  getDeviceType(): string {
    return 'switchbot';
  }

  getRequiredFields(): string[] {
    return ['token', 'secret'];
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

    const { token, secret } = credentials;

    // Validate token/secret format
    if (token.length !== 96 || !/^[A-Za-z0-9]+$/.test(token)) {
      return this.createErrorResult('Invalid token format (must be 96 alphanumeric characters)');
    }

    if (secret.length !== 32 || !/^[A-Za-z0-9]+$/.test(secret)) {
      return this.createErrorResult('Invalid secret format (must be 32 alphanumeric characters)');
    }

    try {
      const client = new SwitchbotClient(token, secret, this.config.timeout);
      const response = await client.listDevices();

      if (!response || !response.body || !Array.isArray(response.body.deviceList)) {
        return this.createErrorResult('Invalid response from SwitchBot API');
      }

      // Extract and normalize devices
      const devices: DeviceInfo[] = response.body.deviceList
        .map((record: SwitchbotDeviceRecord) => this.extractDeviceSummary(record))
        .filter((device): device is DeviceInfo => device !== undefined);

      return this.createSuccessResult(devices);

    } catch (error: any) {
      return this.createErrorResult(
        error?.message || 'Failed to validate SwitchBot credentials'
      );
    }
  }

  async discoverDevices(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult> {
    // For SwitchBot, discovery is the same as validation
    return this.validateCredentials(credentials, context);
  }

  /**
   * Extract device information from SwitchBot API response
   */
  private extractDeviceSummary(record: SwitchbotDeviceRecord): DeviceInfo | undefined {
    if (!record || typeof record !== 'object') {
      return undefined;
    }

    const rawId = this.normalizeString(record.deviceId);
    if (!rawId) {
      return undefined;
    }

    const deviceId = sanitizeDeviceId(rawId);
    return {
      deviceId,
      deviceName: this.normalizeString(record.deviceName) ?? deviceId,
      deviceType: this.normalizeString(record.deviceType) ?? undefined
    };
  }

  /**
   * Normalize unknown values to strings
   */
  private normalizeString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }

    return undefined;
  }
}