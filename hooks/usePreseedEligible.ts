import { useEffect, useState } from 'react';

export function usePreseedEligible(address: string | null): boolean {
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (!address) {
      setEligible(false);
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const res = await fetch(`/api/preseed/claim-status?wallet=${address}`);
        const data = await res.json();
        if (isMounted) {
          setEligible(data.eligible === true);
        }
      } catch (err) {
        console.error('usePreseedEligible error:', err);
        if (isMounted) {
          setEligible(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [address]);

  return eligible;
}
