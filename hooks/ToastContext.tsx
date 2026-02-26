import { createContext, useContext, useState } from 'react';
import ToastMessage, { ToastData, ToastType } from '../components/ToastMessage';
import { emitClientError } from '../lib/hooks/useClientErrorLogger';

interface ToastContextType {
  success: (args: ToastType) => void;
  warning: (args: ToastType) => void;
  info: (args: ToastType) => void;
  error: (args: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider(props: any) {
  const { children } = props;

  const [toastData, setToastData] = useState<ToastType | undefined>(undefined);

  const toastMessage = (data: ToastType) => {
    setToastData({
      ...data
    });
  };

  const success = ({ heading, message, content, duration }: ToastType) => {
    const toastData: ToastType = {
      heading,
      message,
      content,
      duration,
      type: 'success'
    };
    toastMessage(toastData);
  };

  const warning = ({ heading, message, content, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, content, duration, type: 'warn' };
    toastMessage(toastData);
  };

  const info = ({ heading, message, content, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, content, duration, type: 'info' };
    toastMessage(toastData);
  };

  const error = ({
    heading,
    message,
    content,
    duration,
    minerKey,
    walletAddress,
    metadata,
    issueType,
    part,
    dedupeKey,
  }: ToastType) => {
    const toastData: ToastType = {
      heading,
      message,
      content,
      duration,
      type: 'error',
      minerKey,
      walletAddress,
      metadata,
      issueType,
      part,
      dedupeKey,
    };

    const summary = typeof heading === 'string' && heading.trim().length > 0
      ? heading.trim()
      : 'Toast Error';
    const detailMessage =
      typeof message === 'string' && message.trim().length > 0
        ? message.trim()
        : summary;

    const serializedContent =
      typeof content === 'string'
        ? content
        : content
          ? `[toast-content:${typeof content}]`
          : undefined;

    emitClientError({
      message: detailMessage,
      issueType: issueType ?? 'CLIENT_TOAST_ERROR',
      part: part ?? `toast:${summary}`,
      reason: metadata ?? {
        heading: summary,
        message: detailMessage,
        content: serializedContent,
      },
      minerKey,
      walletAddress,
      dedupeKey: dedupeKey ?? `toast:${summary}:${detailMessage}`,
    });

    toastMessage(toastData);
  };
  const value: ToastContextType = { success, warning, info, error };

  return (
    <ToastContext.Provider value={value}>
      {toastData && <ToastMessage toast={toastData} />}
      {children}
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used within an ToastProvider');
  }
  return context;
}
