import { BaseValidator } from './BaseValidator';
import { DeviceValidationResult, ValidationContext, DeviceInfo } from './types';
import { listActiveDevicesByType } from '../../pages/api/credentials/ecowitt/ecowitt_discover';
import { getEcowittDeviceType } from '../credentials-utils';

/**
 * Validator for Ecowitt devices using the autonomous discovery system
 */
export class EcowittValidator extends BaseValidator {
  getDeviceType(): string {
    return 'ecowitt';
  }

  getRequiredFields(): string[] {
    return ['app_key', 'api_key'];
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

    const { app_key, api_key } = credentials;

    // Validate field formats - basic checks
    if (!app_key || app_key.trim().length === 0) {
      return this.createErrorResult('Invalid app_key format');
    }

    if (!api_key || api_key.trim().length === 0) {
      return this.createErrorResult('Invalid api_key format');
    }

    // Extract miner type from context and map to Ecowitt device type
    if (!context.minerKey) {
      return this.createErrorResult('Missing miner key in validation context');
    }

    const ecowittDeviceType = getEcowittDeviceType(context.minerKey);
    if (!ecowittDeviceType) {
      return this.createErrorResult(
        `Miner type '${context.minerKey.split('-')[0]}' is not supported for Ecowitt device discovery`
      );
    }

    try {
      // Call the TypeScript discovery function
      const deviceSummaries = await listActiveDevicesByType(
        app_key, 
        api_key, 
        ecowittDeviceType,
        this.config.maxAgeSeconds || 3600
      );

      // Transform DeviceSummary[] to DeviceInfo[] format
      const devices: DeviceInfo[] = deviceSummaries.map(summary => ({
        deviceId: summary.mac,
        deviceName: summary.name || summary.mac,
        deviceType: ecowittDeviceType
      }));

      return this.createSuccessResult(devices, {
        discoveredDeviceType: ecowittDeviceType,
        totalDevicesFound: devices.length
      });

    } catch (error: any) {
      // Handle network errors, API errors, etc.
      const errorMessage = error?.message || 'Failed to validate Ecowitt credentials';
      
      // Provide more helpful error messages for common issues
      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        return this.createErrorResult('Ecowitt API request timed out. Please check your network connection.');
      }
      
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        return this.createErrorResult('Invalid Ecowitt credentials. Please check your app_key and api_key.');
      }
      
      if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        return this.createErrorResult('Ecowitt API access forbidden. Please verify your account permissions.');
      }

      return this.createErrorResult(errorMessage);
    }
  }

  async discoverDevices(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult> {
    // For Ecowitt, discovery is the same as validation
    return this.validateCredentials(credentials, context);
  }
}
