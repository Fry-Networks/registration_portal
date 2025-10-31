import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface FingerprintContextValue {
  ready: boolean;
  setReady: (ready: boolean) => void;
  refresh: () => Promise<boolean>;
  registerRefresh: (fn: () => Promise<boolean>) => void;
}

const FingerprintContext = createContext<FingerprintContextValue | undefined>(
  undefined
);

export const FingerprintProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [ready, setReady] = useState(false);
  const [refreshFn, setRefreshFn] = useState<() => Promise<boolean>>(
    () => async () => false
  );

  const registerRefresh = useCallback((fn: () => Promise<boolean>) => {
    setRefreshFn(() => fn);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      setReady,
      refresh: refreshFn,
      registerRefresh
    }),
    [ready, refreshFn, registerRefresh]
  );

  return (
    <FingerprintContext.Provider value={value}>
      {children}
    </FingerprintContext.Provider>
  );
};

export function useFingerprintReady(): Pick<FingerprintContextValue, 'ready' | 'setReady' | 'refresh'> {
  const ctx = useContext(FingerprintContext);
  if (!ctx) {
    throw new Error(
      'useFingerprintReady must be used within a FingerprintProvider'
    );
  }
  const { ready, setReady, refresh } = ctx;
  return { ready, setReady, refresh };
}

export function useRegisterFingerprintRefresh(): (fn: () => Promise<boolean>) => void {
  const ctx = useContext(FingerprintContext);
  if (!ctx) {
    throw new Error(
      'useRegisterFingerprintRefresh must be used within a FingerprintProvider'
    );
  }
  return ctx.registerRefresh;
}
