import React, { useEffect, useRef } from 'react';
import { Toast } from 'primereact/toast';
import 'primereact/resources/themes/saga-green/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';

export type ToastType = {
  heading: string;
  message: string;
  type?: 'error' | 'success' | 'info' | 'warn';
  duration?: number;
};
export type ToastData = {
  toast: ToastType | undefined;
};

const ToastMessage = (props: ToastData) => {
  const toast = useRef<Toast>(null);

  useEffect(() => {
    toast.current?.show({
      severity: props.toast?.type,
      summary: props.toast?.heading,
      detail: props.toast?.message,
      life: props.toast?.duration ? props.toast.duration : 10000
    });
  }, [props.toast]);

  return <Toast ref={toast} />;
};

export default ToastMessage;
