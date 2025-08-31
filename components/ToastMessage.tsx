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

  return <Toast ref={toast} />;
};

export default ToastMessage;
