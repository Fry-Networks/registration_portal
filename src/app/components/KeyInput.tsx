import React from 'react';

const KeyInput = ({ apiKey, setApiKey, setValid, disappear }: { apiKey: string, setApiKey: Function, setValid: Function, disappear: boolean }) => (
  <input
    type="text"
    value={apiKey}
    autoComplete="off"
    data-lpignore="true"
    data-form-type="other"
    onChange={e => {
      setApiKey(e.target.value);
      setValid(/^[a-z0-9]{64}$/.test(e.target.value));
    }}
    placeholder="Enter your API Key"
    style={keyInputStyle}
    className={disappear ? 'fade-out' : ''}
  />
);

const keyInputStyle = {
  color: 'black',
  padding: '10px',
  marginBottom: '10px',
  borderRadius: '5px',
};

export default KeyInput;
