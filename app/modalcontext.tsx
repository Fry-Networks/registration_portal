import React, { createContext, useContext, useState } from 'react';

interface ModalContextProps {
  modals: { [key: string]: boolean };
  openModal: (modalName: string) => void;
  closeModal: (modalName: string) => void;
}

const ModalContext = createContext<ModalContextProps | undefined>(undefined);

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [modals, setModals] = useState<{ [key: string]: boolean }>({
    updateReward: false,
    positionVerification: false,
    withdraw_stakeVerification: false,
    registration: false,
    byodConvert: false,
    changeName: false,
    addDevice: false,
    stake: false,
    stakeVerification: false,
    withdraw: false,
    boost: false,
    claim: false,
    delete: false,
    generate_wallet: false,
    withdraw_all: false,
    fryConversion: false,
    ambient: false,
    ecowitt: false,
    pebble: false,
    airthings: false,
    purpleair: false,
    awair: false,
    kaiterra: false,
    atmotube: false,
    govee: false,
    nrf: false,
    sensecap: false,
    weatherxm: false,
    lacrosse: false,
    iopool: false,
    gmcmap: false,
    tapo: false,
    shelly: false,
    tempest: false,
    switchbot: false,
    // Add other modals here as needed
  });

  const openModal = (modalName: string) => {
    setModals((prev) => ({ ...prev, [modalName]: true }));
  };

  const closeModal = (modalName: string) => {
    setModals((prev) => ({ ...prev, [modalName]: false }));
  };

  return (
    <ModalContext.Provider value={{ modals, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};
