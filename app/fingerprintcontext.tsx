import React, { createContext, useContext, useMemo, useState } from 'react';

interface FingerprintContextValue {
  ready: boolean;
  setReady: (ready: boolean) => void;
}

const FingerprintContext = createContext<FingerprintContextValue | undefined>(
  undefined
);

export const FingerprintProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [ready, setReady] = useState(false);

  const value = useMemo(() => ({ ready, setReady }), [ready]);

  return (
    <FingerprintContext.Provider value={value}>
      {children}
    </FingerprintContext.Provider>
  );
};

export function useFingerprintReady(): FingerprintContextValue {
  const ctx = useContext(FingerprintContext);
  if (!ctx) {
    throw new Error(
      'useFingerprintReady must be used within a FingerprintProvider'
    );
  }
  return ctx;
}
