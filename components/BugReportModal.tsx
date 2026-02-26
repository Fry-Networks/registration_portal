import { useEffect, useMemo, useState } from 'react';
import Modal from 'react-modal';
import { ExclamationIcon, PhotographIcon, UploadIcon, XIcon } from '@heroicons/react/outline';
import Image from 'next/image';
import { useTheme } from 'next-themes';

const CHARACTER_LIMIT = 750;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4 MB

export type BugReportPayload = {
  message: string;
  screenshot?: {
    dataUrl: string;
    mimeType: string;
    name: string;
    size: number;
  };
};

interface BugReportModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
  onSubmit: (payload: BugReportPayload) => Promise<void> | void;
  onRequestClose: () => void;
}

function readFileAsDataUrl(file: File): Promise<{ dataUrl: string; mimeType: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unsupported result type'));
        return;
      }
      resolve({
        dataUrl: result,
        mimeType: file.type || 'image/png',
        name: file.name || 'screenshot.png',
        size: file.size
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read screenshot'));
    reader.readAsDataURL(file);
  });
}

export default function BugReportModal({
  isOpen,
  isSubmitting,
  errorMessage,
  successMessage,
  onSubmit,
  onRequestClose
}: BugReportModalProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<BugReportPayload['screenshot']>();

  useEffect(() => {
    if (!isOpen) {
      setMessage('');
      setLocalError(null);
      setScreenshot(undefined);
    }
  }, [isOpen]);

  const remainingCharacters = useMemo(() => CHARACTER_LIMIT - message.length, [message.length]);
  const overLimit = remainingCharacters < 0;

  const handleScreenshotSelection = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setLocalError('Only image files can be attached.');
      return;
    }

    if (file.size > MAX_SCREENSHOT_BYTES) {
      setLocalError('Screenshot must be 4 MB or smaller.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setScreenshot(dataUrl);
      setLocalError(null);
    } catch (error) {
      console.error('Failed to read screenshot', error);
      setLocalError('Could not load your screenshot. Please try again.');
    }
  };

  const handlePaste: React.ClipboardEventHandler<HTMLTextAreaElement> = async (event) => {
    if (!event.clipboardData) {
      return;
    }

    const items = Array.from(event.clipboardData.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      await handleScreenshotSelection(file);
    }
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const { files } = event.target;
    await handleScreenshotSelection(files?.[0] ?? null);
    event.target.value = '';
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!message.trim()) {
      setLocalError('Please describe the bug you encountered.');
      return;
    }

    if (overLimit) {
      setLocalError(`Bug report must be ${CHARACTER_LIMIT} characters or fewer.`);
      return;
    }

    setLocalError(null);
    await onSubmit({
      message: message.trim(),
      screenshot
    });
  };

  const modalStyles = useMemo(
    () =>
      ({
        content: {
          top: '50%',
          left: '50%',
          right: 'auto',
          bottom: 'auto',
          transform: 'translate(-50%, -50%)',
          backgroundColor: isDark ? '#0d0d10' : '#ffffff',
          borderRadius: '24px',
          border: isDark ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(239, 68, 68, 0.2)',
          padding: '1.75rem',
          maxWidth: '32rem',
          width: '92vw',
          height: '85vh',
          maxHeight: '700px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: isDark ? '#f5f5f5' : '#0f172a',
          boxShadow: isDark ? '0 20px 40px rgba(0, 0, 0, 0.45)' : '0 12px 30px rgba(15, 23, 42, 0.15)'
        },
        overlay: {
          backgroundColor: isDark ? 'rgba(5, 5, 8, 0.78)' : 'rgba(15, 23, 42, 0.35)',
          backdropFilter: 'blur(4px)',
          zIndex: 200
        }
      }) as const,
    [isDark]
  );

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onRequestClose}
      style={modalStyles}
      contentLabel="Report a bug"
      shouldCloseOnOverlayClick={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2 scrollbar-thin scrollbar-thumb-red-600/40 scrollbar-track-transparent">
        <div className="flex flex-col gap-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>Report a Bug</h2>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Tell us what happened so we can investigate.
            </p>
          </div>
          <button
            type="button"
            onClick={onRequestClose}
            aria-label="Close bug report modal"
            className={`rounded-full border border-transparent p-1 ${isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'} hover:border-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500`}
            disabled={isSubmitting}
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={`rounded-md border px-3 py-2 text-xs ${isDark ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-800'}`}>
          Please do not include personal details. Use a tool like Snipping Tool to blur or hide names, email
          addresses, or private info before attaching screenshots.
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${isDark ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          You can submit up to 2 bug reports every 120 minutes. If you hit the limit, try again after the cooldown.
        </div>

        <div>
          <label htmlFor="bug-report-message" className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
            What went wrong?
          </label>
          <textarea
            id="bug-report-message"
            name="bug-report-message"
            rows={6}
            value={message}
            onChange={event => setMessage(event.target.value)}
            onPaste={handlePaste}
            maxLength={CHARACTER_LIMIT + 200}
            className={`mt-2 w-full resize-none rounded-lg border px-3 py-2 text-sm shadow-inner outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 ${isDark ? 'border-red-500/30 bg-black/40 text-white' : 'border-red-200 bg-white text-slate-900'}`}
            placeholder="Share the steps to reproduce, what you expected, and what you observed."
          />
          <div className={`mt-1 flex items-center justify-between text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
            <span>Character limit: {CHARACTER_LIMIT}</span>
            <span className={overLimit ? 'text-red-400 font-semibold' : ''}>
              {remainingCharacters} characters remaining
            </span>
          </div>
          {overLimit && (
            <p className={`mt-1 text-xs font-medium ${isDark ? 'text-red-300' : 'text-red-600'}`}>
              You have exceeded the limit by {Math.abs(remainingCharacters)} characters. Please shorten your report.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
            Screenshot (optional)
          </label>
          <div className={`rounded-lg border border-dashed p-4 text-sm ${isDark ? 'border-red-500/40 bg-black/40 text-gray-300' : 'border-red-200 bg-red-50 text-slate-800'}`}>
            <p className="flex items-center gap-2">
              <PhotographIcon className={`h-5 w-5 ${isDark ? 'text-red-300' : 'text-red-500'}`} />
              Paste a screenshot here or upload an image file.
            </p>
            <label className={`mt-3 inline-flex cursor-pointer items-center gap-2 text-sm font-medium ${isDark ? 'text-red-300 hover:text-red-200' : 'text-red-600 hover:text-red-700'}`}>
              <UploadIcon className="h-4 w-4" />
              <span>Choose image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
            {screenshot && (
              <div className="mt-4 space-y-3">
                <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${isDark ? 'border-red-500/30 bg-black/50 text-gray-200' : 'border-red-200 bg-red-50 text-slate-800'}`}>
                  <div className="space-y-1 truncate">
                    <p className="truncate font-medium">{screenshot.name}</p>
                    <p className={`${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
                      {(screenshot.size / 1024).toFixed(0)} KB · {screenshot.mimeType}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScreenshot(undefined)}
                    className={`rounded-md border border-transparent px-2 py-1 ${isDark ? 'text-gray-400 hover:text-red-200 hover:border-red-400' : 'text-slate-600 hover:text-red-600 hover:border-red-400'}`}
                  >
                    Remove
                  </button>
                </div>
                <div className={`relative h-60 overflow-hidden rounded-md border ${isDark ? 'border-red-500/20 bg-black/60' : 'border-red-200 bg-white'}`}>
                  <Image
                    src={screenshot.dataUrl}
                    alt="Screenshot preview"
                    fill
                    sizes="(max-width: 640px) 100vw, 512px"
                    className="object-contain"
                    unoptimized
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {(localError || errorMessage) && (
          <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${isDark ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-300 bg-red-50 text-red-800'}`}>
            <ExclamationIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{localError || errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className={`rounded-md border px-3 py-2 text-sm ${isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {successMessage}
          </div>
        )}
        </div>
        </div>

        <div className={`flex-shrink-0 mt-3 flex flex-col gap-3 border-t pt-3 ${isDark ? 'border-red-500/20 bg-[#0d0d10]' : 'border-red-200 bg-white'}`}>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onRequestClose}
              className={`rounded-lg border border-transparent px-4 py-2 text-sm font-medium ${isDark ? 'text-gray-300 hover:text-white hover:border-red-400' : 'text-slate-700 hover:text-slate-900 hover:border-red-400'}`}
              disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg border border-red-500 bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:border-red-500/40 disabled:bg-red-500/40"
            disabled={isSubmitting || overLimit}
          >
            {isSubmitting ? 'Submitting…' : 'Submit bug report'}
          </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
