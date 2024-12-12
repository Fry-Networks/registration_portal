import { createContext, useContext, useState } from 'react';
import ToastMessage, { ToastData, ToastType } from '../components/ToastMessage';

interface ToastContextType {
  success: ({ heading, message, duration }: ToastType) => void;
  warning: ({ heading, message, duration }: ToastType) => void;
  info: ({ heading, message, duration }: ToastType) => void;
  error: ({ heading, message, duration }: ToastType) => void;
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

  const success = ({ heading, message, duration }: ToastType) => {
    const toastData: ToastType = {
      heading,
      message,
      duration,
      type: 'success'
    };
    toastMessage(toastData);
  };

  const warning = ({ heading, message, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, duration, type: 'warn' };
    toastMessage(toastData);
  };

  const info = ({ heading, message, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, duration, type: 'info' };
    toastMessage(toastData);
  };

  const error = ({ heading, message, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, duration, type: 'error' };
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
