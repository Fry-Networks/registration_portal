import { useState, useEffect } from 'react';
import { 
  isAnyWalletRequestPending, 
  subscribeToWalletPending 
} from '../wallet/requestCoordinator.client';

/**
 * React hook to track whether any wallet operation is currently pending.
 * Components can use this to disable buttons proactively instead of
 * showing error toasts reactively.
 */
export function useWalletPending(): boolean {
  const [isPending, setIsPending] = useState(() => isAnyWalletRequestPending());

  useEffect(() => {
    // Update state when pending status changes
    const unsubscribe = subscribeToWalletPending(() => {
      setIsPending(isAnyWalletRequestPending());
    });

    // Check initial state
    setIsPending(isAnyWalletRequestPending());

    return unsubscribe;
  }, []);

  return isPending;
}

export default useWalletPending;
