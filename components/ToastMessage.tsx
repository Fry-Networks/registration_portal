import React, { useEffect, useRef } from 'react';
import { Toast } from 'primereact/toast';
import 'primereact/resources/themes/saga-green/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';

export type ToastType = {
  heading: string;
  message?: string;
  content?: React.ReactNode;
  type?: 'error' | 'success' | 'info' | 'warn';
  duration?: number;
  minerKey?: string;
  walletAddress?: string;
  metadata?: Record<string, unknown>;
  issueType?: string;
  part?: string;
  dedupeKey?: string;
};
export type ToastData = {
  toast: ToastType | undefined;
};

const ToastMessage = (props: ToastData) => {
  const toast = useRef<Toast>(null);

  useEffect(() => {
    if (!props.toast) return;
    const { type, heading, message, content, duration } = props.toast;
    toast.current?.show({
      severity: type,
      summary: heading,
      ...(content ? { content } : { detail: message }),
      life: duration ? duration : 10000
    });
  }, [props.toast]);

  const appendTarget = typeof window !== 'undefined' ? document.body : undefined;

  return (
    <Toast
      ref={toast}
      position="top-right"
      appendTo={appendTarget}
      baseZIndex={100000}
      className="z-[100000]"
      style={{ zIndex: 100000 }}
      pt={{
        root: { className: 'z-[100000]' }
      }}
    />
  );
};

export default ToastMessage;