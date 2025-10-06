// Export all validator types and classes
export * from './types';
export * from './BaseValidator';
export * from './SwitchbotValidator';
export * from './ShellyValidator';
export * from './AwairValidator';
export * from './KaiterraValidator';
export * from './AtmotubeValidator';
export * from './macAddressValidator';
export * from './DeviceValidatorRegistry';

// Export the singleton registry instance
export { deviceValidatorRegistry } from './DeviceValidatorRegistry';