import { DeviceValidator, DeviceValidationResult, ValidationContext, ValidatorConfig } from './types';

/**
 * Abstract base class for device validators with common functionality
 */
export abstract class BaseValidator implements DeviceValidator {
  protected config: ValidatorConfig;

  constructor(config: ValidatorConfig = {}) {
    this.config = {
      timeout: 10000,
      retries: 1,
      ...config
    };
  }

  abstract validateCredentials(
    credentials: Record<string, string>, 
    context: ValidationContext
  ): Promise<DeviceValidationResult>;

  abstract getRequiredFields(): string[];
  
  abstract getDeviceType(): string;

  /**
   * Helper method to validate required fields are present
   */
  protected validateRequiredFields(credentials: Record<string, string>): string[] {
    const required = this.getRequiredFields();
    const missing: string[] = [];
    
    for (const field of required) {
      if (!credentials[field] || credentials[field].trim() === '') {
        missing.push(field);
      }
    }
    
    return missing;
  }

  /**
   * Helper method to create error result
   */
  protected createErrorResult(error: string): DeviceValidationResult {
    return {
      success: false,
      error
    };
  }

  /**
   * Helper method to create success result
   */
  protected createSuccessResult(devices?: any[], additionalData?: Record<string, any>): DeviceValidationResult {
    return {
      success: true,
      devices,
      additionalData
    };
  }

  /**
   * Helper method to make HTTP requests with timeout and retry logic
   */
  protected async makeRequest(
    url: string, 
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}