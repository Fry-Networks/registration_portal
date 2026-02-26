import { Flex } from '@tremor/react';
import { useState } from 'react';

export default function CopyAddress({ address }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="relative inline-block">
      <Flex
        flexDirection="row"
        className="w-auto gap-2 cursor-pointer"
        onClick={() => handleCopy()}
      >
        <svg
          className="copy-icon"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="7"
            y="6"
            width="13"
            height="16"
            stroke="var(--text-secondary)"
            strokeWidth="1.5"
          ></rect>
          <path
            d="M15 2H3V17"
            stroke="var(--text-secondary)"
            strokeWidth="1.5"
          ></path>
        </svg>
      </Flex>
      {copied && (
        <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 text-white bg-gray-800 rounded-lg shadow-lg opacity-90 transition-opacity duration-300 p-2">
          Copied!
        </span>
      )}
    </div>
  );
}
