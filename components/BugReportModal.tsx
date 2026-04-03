import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Modal from 'react-modal';
import { ExclamationIcon, UploadIcon, XIcon, InformationCircleIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CONSOLE_LOG_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_HAR_BYTES = 1024 * 1024 * 1024; // 1GB

const CATEGORIES = ['UI', 'Rewards', 'Devices', 'Auth', 'Performance', 'Other'] as const;

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
}

interface FileState {
  file: File | null;
  uploadedFilename: string | null;
  uploading: boolean;
  progress: number;
  error: string | null;
}

// Info tooltip component
function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <span 
      className="relative inline-block ml-1"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <InformationCircleIcon className={`h-4 w-4 cursor-help ${isDark ? 'text-gray-400' : 'text-slate-500'}`} />
      {show && (
        <div className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs rounded-lg shadow-lg whitespace-nowrap ${
          isDark ? 'bg-gray-800 text-gray-200 border border-gray-700' : 'bg-white text-slate-800 border border-slate-200'
        }`}>
          {text}
          <div className={`absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent ${
            isDark ? 'border-t-gray-800' : 'border-t-white'
          }`} />
        </div>
      )}
    </span>
  );
}

export default function BugReportModal({ isOpen, onClose, walletAddress }: BugReportModalProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [screenshot, setScreenshot] = useState<FileState>({
    file: null, uploadedFilename: null, uploading: false, progress: 0, error: null
  });
  const [consoleLog, setConsoleLog] = useState<FileState>({
    file: null, uploadedFilename: null, uploading: false, progress: 0, error: null
  });
  const [harFile, setHarFile] = useState<FileState>({
    file: null, uploadedFilename: null, uploading: false, progress: 0, error: null
  });

  const uploadIdRef = useRef<string>('');

  // Reset form on close
  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setCategory('');
      setDescription('');
      setSubmitError(null);
      setSubmitSuccess(false);
      setScreenshot({ file: null, uploadedFilename: null, uploading: false, progress: 0, error: null });
      setConsoleLog({ file: null, uploadedFilename: null, uploading: false, progress: 0, error: null });
      setHarFile({ file: null, uploadedFilename: null, uploading: false, progress: 0, error: null });
      uploadIdRef.current = '';
    } else {
      // Generate new upload ID when modal opens
      uploadIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }, [isOpen]);

  const generateUploadId = useCallback(() => {
    if (!uploadIdRef.current) {
      uploadIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return uploadIdRef.current;
  }, []);

  const uploadFile = useCallback(async (
    file: File,
    fieldName: 'screenshot' | 'consoleLog' | 'harFile',
    setFileState: React.Dispatch<React.SetStateAction<FileState>>
  ) => {
    const uploadId = generateUploadId();
    
    setFileState(prev => ({ ...prev, uploading: true, progress: 0, error: null }));

    try {
      if (file.size <= CHUNK_SIZE) {
        // Small file - upload as single chunk
        const base64 = await fileToBase64(file);
        
        const chunkResp = await fetch('/api/bug-reports/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            chunkIndex: 0,
            totalChunks: 1,
            fieldName,
            chunk: base64
          })
        });

        if (!chunkResp.ok) {
          const err = await chunkResp.json();
          throw new Error(err.message || 'Chunk upload failed');
        }

        setFileState(prev => ({ ...prev, progress: 50 }));
      } else {
        // Large file - chunked upload
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const slice = file.slice(start, end);
          const base64 = await blobToBase64(slice);

          const chunkResp = await fetch('/api/bug-reports/chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploadId,
              chunkIndex: i,
              totalChunks,
              fieldName,
              chunk: base64
            })
          });

          if (!chunkResp.ok) {
            const err = await chunkResp.json();
            throw new Error(err.message || 'Chunk upload failed');
          }

          setFileState(prev => ({ 
            ...prev, 
            progress: Math.round(((i + 1) / totalChunks) * 50) 
          }));
        }
      }

      // Finalize
      const finalizeResp = await fetch('/api/bug-reports/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, fieldName })
      });

      if (!finalizeResp.ok) {
        const err = await finalizeResp.json();
        throw new Error(err.message || 'Finalize failed');
      }

      const { filename } = await finalizeResp.json();
      
      setFileState(prev => ({ 
        ...prev, 
        uploading: false, 
        progress: 100, 
        uploadedFilename: filename,
        error: null 
      }));
    } catch (error) {
      console.error(`[BugReportModal] ${fieldName} upload error:`, error);
      setFileState(prev => ({ 
        ...prev, 
        uploading: false, 
        progress: 0, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      }));
    }
  }, [generateUploadId]);

  const handleFileSelect = useCallback((
    event: React.ChangeEvent<HTMLInputElement>,
    fieldName: 'screenshot' | 'consoleLog' | 'harFile',
    setFileState: React.Dispatch<React.SetStateAction<FileState>>,
    maxSize: number,
    acceptTypes: string[]
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    
    if (!file) return;

    // Size check
    if (file.size > maxSize) {
      const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
      setFileState(prev => ({ 
        ...prev, 
        file: null, 
        error: `File too large. Maximum ${maxMB}MB.` 
      }));
      return;
    }

    setFileState({ 
      file, 
      uploadedFilename: null, 
      uploading: false, 
      progress: 0, 
      error: null 
    });

    // Start upload immediately
    uploadFile(file, fieldName, setFileState);
  }, [uploadFile]);

  const removeFile = useCallback((
    setFileState: React.Dispatch<React.SetStateAction<FileState>>
  ) => {
    setFileState({ 
      file: null, 
      uploadedFilename: null, 
      uploading: false, 
      progress: 0, 
      error: null 
    });
  }, []);

  const canSubmit = useMemo(() => {
    return (
      title.trim().length > 0 &&
      title.length <= 100 &&
      category !== '' &&
      description.trim().length > 0 &&
      description.length <= 2000 &&
      consoleLog.uploadedFilename !== null &&
      harFile.uploadedFilename !== null &&
      !consoleLog.uploading &&
      !harFile.uploading &&
      !screenshot.uploading &&
      !isSubmitting
    );
  }, [title, category, description, consoleLog, harFile, screenshot, isSubmitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          category,
          description: description.trim(),
          screenshotPreUploaded: screenshot.uploadedFilename,
          consoleLogPreUploaded: consoleLog.uploadedFilename,
          harFilePreUploaded: harFile.uploadedFilename
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Submission failed');
      }

      setSubmitSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (error) {
      console.error('[BugReportModal] Submit error:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit bug report');
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalStyles = useMemo(() => ({
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
      maxWidth: '36rem',
      width: '95vw',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      color: isDark ? '#f5f5f5' : '#0f172a',
      boxShadow: isDark ? '0 20px 40px rgba(0, 0, 0, 0.45)' : '0 12px 30px rgba(15, 23, 42, 0.15)'
    },
    overlay: {
      backgroundColor: isDark ? 'rgba(5, 5, 8, 0.78)' : 'rgba(15, 23, 42, 0.35)',
      backdropFilter: 'blur(4px)',
      zIndex: 200
    }
  }), [isDark]);

  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 ${
    isDark ? 'border-red-500/30 bg-black/40 text-white' : 'border-red-200 bg-white text-slate-900'
  }`;

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={modalStyles}
      contentLabel="Report a bug"
      shouldCloseOnOverlayClick={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 sm:pr-2 scrollbar-thin scrollbar-thumb-red-600/40 scrollbar-track-transparent">
          <div className="flex flex-col gap-4 pb-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  Report a Bug
                </h2>
                <p className={`mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                  Help us improve by reporting issues you encounter.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`rounded-full border border-transparent p-1 ${
                  isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                } hover:border-red-500 focus:outline-none`}
                disabled={isSubmitting}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Title */}
            <div>
              <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={100}
                placeholder="Brief summary of the issue"
                className={`mt-1 ${inputClass}`}
              />
              <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                {title.length}/100
              </p>
            </div>

            {/* Category */}
            <div>
              <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="">Select a category</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Steps to reproduce, expected behavior, actual behavior..."
                className={`mt-1 resize-none ${inputClass}`}
              />
              <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                {description.length}/2000
              </p>
            </div>

            {/* Console Log (Required) */}
            <FileUploadField
              label="Console Log"
              required
              tooltip="DevTools Console → Right-click → Save as..."
              accept=".txt,.log"
              maxSize={MAX_CONSOLE_LOG_BYTES}
              fileState={consoleLog}
              onChange={e => handleFileSelect(e, 'consoleLog', setConsoleLog, MAX_CONSOLE_LOG_BYTES, ['.txt', '.log'])}
              onRemove={() => removeFile(setConsoleLog)}
              isDark={isDark}
            />

            {/* HAR File (Required) */}
            <FileUploadField
              label="HAR File"
              required
              tooltip="DevTools Network → Right-click → Save all as HAR with content"
              accept=".har,.json"
              maxSize={MAX_HAR_BYTES}
              fileState={harFile}
              onChange={e => handleFileSelect(e, 'harFile', setHarFile, MAX_HAR_BYTES, ['.har', '.json'])}
              onRemove={() => removeFile(setHarFile)}
              isDark={isDark}
            />

            {/* Screenshot (Optional) */}
            <FileUploadField
              label="Screenshot"
              required={false}
              tooltip="PNG, JPG, or WebP image"
              accept="image/jpeg,image/png,image/webp"
              maxSize={MAX_SCREENSHOT_BYTES}
              fileState={screenshot}
              onChange={e => handleFileSelect(e, 'screenshot', setScreenshot, MAX_SCREENSHOT_BYTES, ['image/jpeg', 'image/png', 'image/webp'])}
              onRemove={() => removeFile(setScreenshot)}
              isDark={isDark}
            />

            {/* Errors */}
            {submitError && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                isDark ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-300 bg-red-50 text-red-800'
              }`}>
                <ExclamationIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Success */}
            {submitSuccess && (
              <div className={`rounded-md border px-3 py-2 text-sm ${
                isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}>
                Bug report submitted successfully! Thank you for helping us improve.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={`flex-shrink-0 mt-3 flex justify-end gap-3 border-t pt-3 ${
          isDark ? 'border-red-500/20' : 'border-red-200'
        }`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg border border-transparent px-4 py-2 text-sm font-medium ${
              isDark ? 'text-gray-300 hover:text-white hover:border-red-400' : 'text-slate-700 hover:text-slate-900 hover:border-red-400'
            }`}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg border border-red-500 bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:border-red-500/40 disabled:bg-red-500/40"
            disabled={!canSubmit}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Bug Report'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface FileUploadFieldProps {
  label: string;
  required: boolean;
  tooltip: string;
  accept: string;
  maxSize: number;
  fileState: FileState;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  isDark: boolean;
}

function FileUploadField({
  label, required, tooltip, accept, maxSize, fileState, onChange, onRemove, isDark
}: FileUploadFieldProps) {
  const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
  
  return (
    <div>
      <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
        {label} {required && <span className="text-red-500">*</span>}
        <InfoTooltip text={tooltip} />
      </label>
      
      <div className={`mt-1 rounded-lg border border-dashed p-3 ${
        isDark ? 'border-red-500/40 bg-black/40' : 'border-red-200 bg-red-50'
      }`}>
        {!fileState.file ? (
          <label className={`flex cursor-pointer items-center gap-2 text-sm font-medium ${
            isDark ? 'text-red-300 hover:text-red-200' : 'text-red-600 hover:text-red-700'
          }`}>
            <UploadIcon className="h-4 w-4" />
            <span>Choose file (max {maxMB}MB)</span>
            <input type="file" accept={accept} className="hidden" onChange={onChange} />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm truncate ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                {fileState.file.name}
              </span>
              <button
                type="button"
                onClick={onRemove}
                className={`text-xs px-2 py-1 rounded ${
                  isDark ? 'text-gray-400 hover:text-red-300' : 'text-slate-500 hover:text-red-600'
                }`}
              >
                Remove
              </button>
            </div>
            
            {fileState.uploading && (
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-red-500 h-2 rounded-full transition-all"
                  style={{ width: `${fileState.progress}%` }}
                />
              </div>
            )}
            
            {fileState.uploadedFilename && (
              <p className={`text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                Uploaded successfully
              </p>
            )}
            
            {fileState.error && (
              <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                {fileState.error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper functions
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
