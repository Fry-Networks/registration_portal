/**
 * Example usage of the Device Validator System
 * 
 * This file demonstrates how to use the new modular device validation system
 * to validate credentials for different device types.
 */

import { deviceValidatorRegistry } from '../lib/validators';

// Example usage function
export async function testDeviceValidation() {
  console.log('=== Device Validator System Demo ===');
  
  // List all supported device types
  const supportedTypes = deviceValidatorRegistry.getSupportedDeviceTypes();
  console.log('Supported device types:', supportedTypes);
  
  // Example validation context
  const context = {
    session: {
      user: {
        address: 'EXAMPLE_WALLET_ADDRESS'
      }
    },
    minerKey: 'example_miner_key'
  };

  // Test SwitchBot validation
  console.log('\n--- Testing SwitchBot Validator ---');
  const switchbotValidator = deviceValidatorRegistry.getValidator('switchbot');
  if (switchbotValidator) {
    const switchbotCredentials = {
      token: 'a'.repeat(96), // Invalid example token
      secret: 'b'.repeat(32)  // Invalid example secret
    };
    
    try {
      const result = await switchbotValidator.validateCredentials(switchbotCredentials, context);
      console.log('SwitchBot validation result:', result);
    } catch (error) {
      console.error('SwitchBot validation error:', error);
    }
  }

  // Test MAC address validation
  console.log('\n--- Testing MAC Address Validator ---');
  const macValidator = deviceValidatorRegistry.getValidator('mac');
  if (macValidator) {
    const macCredentials = {
      mac_address: 'AA:BB:CC:DD:EE:FF'
    };
    
    try {
      const result = await macValidator.validateCredentials(macCredentials, context);
      console.log('MAC validation result:', result);
    } catch (error) {
      console.error('MAC validation error:', error);
    }
  }

  // Test with invalid MAC
  console.log('\n--- Testing Invalid MAC Address ---');
  if (macValidator) {
    const invalidMacCredentials = {
      mac_address: 'invalid-mac'
    };
    
    try {
      const result = await macValidator.validateCredentials(invalidMacCredentials, context);
      console.log('Invalid MAC validation result:', result);
    } catch (error) {
      console.error('Invalid MAC validation error:', error);
    }
  }
}

// Example of how to add a custom validator
export function addCustomValidator() {
  console.log('\n--- Adding Custom Validator ---');
  
  // You can create a custom validator by extending BaseValidator
  // and then register it with the registry:
  
  /*
  class MyCustomValidator extends BaseValidator {
    getDeviceType(): string {
      return 'mycustom';
    }
    
    getRequiredFields(): string[] {
      return ['custom_field'];
    }
    
    async validateCredentials(credentials: Record<string, string>, context: ValidationContext): Promise<DeviceValidationResult> {
      // Your custom validation logic here
      return this.createSuccessResult();
    }
  }
  
  deviceValidatorRegistry.register(new MyCustomValidator());
  */
}

// Usage example for React components
export function useDeviceValidation(deviceType: string) {
  return {
    validator: deviceValidatorRegistry.getValidator(deviceType),
    isSupported: deviceValidatorRegistry.hasValidator(deviceType),
    allTypes: deviceValidatorRegistry.getSupportedDeviceTypes()
  };
}