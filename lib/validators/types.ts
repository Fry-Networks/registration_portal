/**
 * Common types and interfaces for device validation system
 */

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
}

export interface DeviceValidationResult {
  success: boolean;
  error?: string;
  devices?: DeviceInfo[];
  additionalData?: Record<string, any>;
}

export interface ValidationContext {
  session?: {
    user?: {
      address?: string;
    };
  } | null;
  minerKey?: string;
  currentDeviceId?: string;
}

export interface DeviceValidator {
  /**
   * Validate credentials for this device type
   */
  validateCredentials(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult>;

  /**
   * Discover available devices (optional)
   */
  discoverDevices?(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult>;

  /**
   * Get required credential fields for this device type
   */
  getRequiredFields(): string[];

  /**
   * Get device type identifier
   */
  getDeviceType(): string;
}

export interface ValidatorConfig {
  timeout?: number;
  retries?: number;
  [key: string]: any;
}