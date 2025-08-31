import { createContext, useContext, useState } from 'react';
import ToastMessage, { ToastData, ToastType } from '../components/ToastMessage';

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

  const error = ({ heading, message, content, duration }: ToastType) => {
    const toastData: ToastType = { heading, message, content, duration, type: 'error' };
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
