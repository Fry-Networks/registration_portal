import { useEffect, useState } from 'react';

const PERA_IDENTIFIERS = ['pera_ios', 'pera_android'];

function detectPeraInAppBrowser(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  const normalized = userAgent.toLowerCase();
  return PERA_IDENTIFIERS.some((token) => normalized.includes(token));
}

export default function PeraInAppBrowserBlocker() {
  const [isBlocking, setIsBlocking] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }
    setIsBlocking(detectPeraInAppBrowser(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (!isBlocking || typeof document === 'undefined') {
      return;
    }
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isBlocking]);

  if (!isBlocking) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-modal="true"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 px-6 text-center text-white"
    >
      <div className="max-w-lg space-y-4 rounded-2xl bg-gray-900/95 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold">Open Fry Dashboard in Safari or Chrome</h2>
        <p className="text-left text-sm text-gray-200">
          We detected the Pera in-app browser, which currently blocks the Fry dashboard from loading correctly.
          Please open this link in Safari or Chrome (share button → &ldquo;Open in&rdquo;) and sign in again.
        </p>
        <p className="text-left text-xs text-gray-400">
          This restriction is temporary while we fix a compatibility issue with the embedded browser shipped in Pera Wallet.
        </p>
      </div>
    </div>
  );
}
