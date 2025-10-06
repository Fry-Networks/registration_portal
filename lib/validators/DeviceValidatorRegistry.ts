import { DeviceValidator } from './types';
import { SwitchbotValidator } from './SwitchbotValidator';
import { ShellyValidator } from './ShellyValidator';
import { AwairValidator } from './AwairValidator';
import { KaiterraValidator } from './KaiterraValidator';
import { AtmotubeValidator } from './AtmotubeValidator';
import { MacAddressValidator } from './macAddressValidator';

/**
 * Registry for device validators
 */
export class DeviceValidatorRegistry {
  private static instance: DeviceValidatorRegistry;
  private validators = new Map<string, DeviceValidator>();

  private constructor() {
    this.initializeValidators();
  }

  public static getInstance(): DeviceValidatorRegistry {
    if (!DeviceValidatorRegistry.instance) {
      DeviceValidatorRegistry.instance = new DeviceValidatorRegistry();
    }
    return DeviceValidatorRegistry.instance;
  }

  private initializeValidators() {
    // Register all available validators
    this.register(new SwitchbotValidator());
    this.register(new ShellyValidator());
    this.register(new AwairValidator());
    this.register(new KaiterraValidator());
    this.register(new AtmotubeValidator());
    
    // Register MAC-based validators for simpler devices
    this.register(new MacAddressValidator('mac'));
    this.register(new MacAddressValidator('node-mac'));
    this.register(new MacAddressValidator('pebble'));
    this.register(new MacAddressValidator('hardware'));
    this.register(new MacAddressValidator('node'));
    this.register(new MacAddressValidator('aem'));
  }

  public register(validator: DeviceValidator) {
    const deviceType = validator.getDeviceType().toLowerCase();
    this.validators.set(deviceType, validator);
  }

  public getValidator(deviceType: string): DeviceValidator | null {
    return this.validators.get(deviceType.toLowerCase()) || null;
  }

  public getAllValidators(): DeviceValidator[] {
    return Array.from(this.validators.values());
  }

  public getSupportedDeviceTypes(): string[] {
    return Array.from(this.validators.keys());
  }

  public hasValidator(deviceType: string): boolean {
    return this.validators.has(deviceType.toLowerCase());
  }
}

// Export singleton instance
export const deviceValidatorRegistry = DeviceValidatorRegistry.getInstance();