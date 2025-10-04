/**
 * Standardized API Error Responses
 * 
 * Provides consistent error response structure across all API endpoints
 * with clear error codes, messages, and actionable guidance for users.
 */

export interface ApiErrorResponse {
  success: false;
  code: string;
  message: string;
  action?: string;
  details?: string;
  errorId?: string;
  [key: string]: any; // For additional context-specific fields
}

/**
 * Creates a standardized API error response
 * 
 * @param code - Unique error code (e.g., 'SESSION_REQUIRED', 'DEVICE_NOT_FOUND')
 * @param message - User-friendly error message explaining what went wrong
 * @param action - Optional guidance on how to resolve the error
 * @param details - Optional additional context (error IDs, specific values, etc.)
 * @returns Standardized error response object
 */
export function createApiError(
  code: string,
  message: string,
  action?: string,
  details?: Record<string, any>
): ApiErrorResponse {
  return {
    success: false,
    code,
    message,
    action,
    ...details
  };
}

/**
 * Common Error Codes
 * 
 * Standardized error codes used across the application.
 * Grouped by category for easy reference.
 */
export const ErrorCodes = {
  // Authentication & Authorization (401, 403)
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_REQUIRED: 'SESSION_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  WALLET_MISMATCH: 'WALLET_MISMATCH',
  WALLET_VERIFICATION_FAILED: 'WALLET_VERIFICATION_FAILED',
  DEVICE_OWNER_MISMATCH: 'DEVICE_OWNER_MISMATCH',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation Errors (400)
  INVALID_INPUT: 'INVALID_INPUT',
  DEVICE_TYPE_NOT_ELIGIBLE: 'DEVICE_TYPE_NOT_ELIGIBLE',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  ALREADY_STAKED: 'ALREADY_STAKED',
  ZERO_STAKE_AMOUNT: 'ZERO_STAKE_AMOUNT',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  
  // Not Found Errors (404)
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  LICENSE_NOT_FOUND: 'LICENSE_NOT_FOUND',
  NO_REWARDS: 'NO_REWARDS',
  NO_STAKE_FOUND: 'NO_STAKE_FOUND',
  
  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  OPERATION_IN_PROGRESS: 'OPERATION_IN_PROGRESS',
  
  // Server Errors (500)
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SWAP_FAILED: 'SWAP_FAILED',
  CONVERSION_FAILED: 'CONVERSION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UPDATE_FAILED: 'UPDATE_FAILED',
  
  // Legacy/Generic
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
};

/**
 * Predefined common error responses
 * Ready-to-use error objects for frequent scenarios
 * 
 * These are reusable error responses that can be used across multiple endpoints.
 * Each function returns a properly formatted ApiErrorResponse object.
 */
export const CommonErrors = {
  // Authentication errors
  
  /**
   * No session found
   * Scenario: User's NextAuth session is missing or invalid (session === null)
   * Occurs when: User is not logged in or session has expired
   */
  noSession: () => createApiError(
    ErrorCodes.SESSION_REQUIRED,
    'Your session has expired',
    'Please sign in again to continue'
  ),
  
  /**
   * Wallet address mismatch
   * Scenario: The wallet address in the request doesn't match the session wallet
   * Occurs when: session.user.address !== address from request body
   * Security: Prevents users from performing actions on behalf of other wallets
   */
  walletMismatch: () => createApiError(
    ErrorCodes.WALLET_MISMATCH,
    'The wallet address does not match your session',
    'Please ensure you are using the correct wallet'
  ),
  
  /**
   * Device owner mismatch
   * Scenario: User tries to access a device that belongs to another wallet
   * Occurs when: device.address !== session.user.address
   * Security: Prevents unauthorized access to other users' devices
   */
  deviceOwnerMismatch: () => createApiError(
    ErrorCodes.DEVICE_OWNER_MISMATCH,
    'This device belongs to a different wallet',
    'Please sign in with the wallet that owns this device'
  ),
  
  // Not found errors
  
  /**
   * Product configuration not found
   * Scenario: The product type (derived from device key) doesn't exist in products collection
   * Occurs when: products.findOne({ key: miner_key.split('-')[0] }) returns null
   * Usually indicates: Invalid device type or missing product configuration
   */
  productNotFound: () => createApiError(
    ErrorCodes.PRODUCT_NOT_FOUND,
    'This device type is not supported',
    'Please verify your device type or contact support'
  ),
  
  /**
   * Device not found in database
   * Scenario: The device with given miner_key doesn't exist in devices collection
   * Occurs when: devices.findOne({ miner_key }) returns null
   * Usually indicates: Device was never registered or was deleted
   */
  deviceNotFound: () => createApiError(
    ErrorCodes.DEVICE_NOT_REGISTERED,
    'This device is not registered in the system',
    'Please register your device before continuing'
  ),
  
  // Generic errors
  
  /**
   * Generic internal server error
   * Scenario: Unexpected error in try/catch block
   * Occurs when: Any unhandled exception happens during request processing
   * @param errorId - Optional unique identifier for support reference (e.g., `${miner_key}-${Date.now()}`)
   */
  internalError: (errorId?: string) => createApiError(
    ErrorCodes.INTERNAL_ERROR,
    'An unexpected error occurred',
    'Please try again. If the problem persists, contact support.',
    errorId ? { errorId } : undefined
  ),
};
