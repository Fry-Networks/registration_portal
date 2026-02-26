import { useEffect, useState } from 'react';

const EVENT_NAME = 'fry:browser-locker-detected';

export default function BrowserLockerWarning() {
  const [lockerDetected, setLockerDetected] = useState(false);

  useEffect(() => {
    // Detect the flag immediately since the history shim sets it upfront.
    if (typeof window !== 'undefined') {
      const flagged = Boolean(
        (window as typeof window & { __FRY_BROWSER_LOCKER_DETECTED?: boolean }).__FRY_BROWSER_LOCKER_DETECTED
      );
      setLockerDetected(flagged);
    }

    // React to future detection events.
    const handler = () => setLockerDetected(true);
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  if (!lockerDetected) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1500] mx-auto max-w-3xl rounded-t-2xl border border-amber-400/50 bg-[#2b1b00] p-4 text-amber-50 shadow-2xl"
      role="alert"
      aria-live="assertive"
    >
      <div className="text-base font-semibold">Browser extension blocked navigation</div>
      <p className="mt-2 text-sm text-amber-100">
        A security extension (usually Trend Micro/Browser Guard) disabled browser history for this tab, which prevents
        Fry from signing you in. Temporarily disable the extension&rsquo;s &ldquo;Browser Locker&rdquo; feature or
        whitelist <strong>dashboard.frynetworks.com</strong>, then reload this page.
      </p>
    </div>
  );
}
