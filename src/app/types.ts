export interface EmailProps {
    email: string;
    setEmail: (email: string) => void;
    setValid: (valid: boolean) => void;
}

export interface PaymentButtonProps {
    valid: boolean;
    showSplitPaymentModal: () => void;
}

export interface SplitPaymentModalProps {
    modalIsOpen: boolean;
    closeModal: () => void;
    activeAddress: string;
    email: string;
    sendTransaction: (from: string, email: string) => Promise<void>;
    valid: boolean;
    transactionMessage: {
        message: string;
        color: string;
    };
    
}