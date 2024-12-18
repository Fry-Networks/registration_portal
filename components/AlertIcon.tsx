import { useState } from 'react';

const AlertWithTooltip = ({
  deviceStatus
}: {
  deviceStatus: { [key: string]: string };
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="relative flex justify-end items-center">
      {/* Red Alert Icon */}
      <div
        className="w-4 h-4 bg-red-500 text-white flex justify-center items-center rounded-full cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        !
      </div>

      {/* Tooltip */}
      {isHovered && (
        <div className="absolute min-w-[250px] sm:min-w-[500px] left-0 top-full mt-2 bg-gray-900 text-white text-sm px-3 py-2 rounded shadow-lg">
          {deviceStatus['position'] && (
            <p>
              <strong>Position: </strong>Not set
            </p>
          )}
          {deviceStatus['reward_wallet'] && (
            <p>
              <strong>Reward Wallet: </strong>Not set
            </p>
          )}

          {deviceStatus['connectivity_wallet'] && (
            <p>
              <strong>Connectivity Wallet: </strong>Not set
            </p>
          )}
          {deviceStatus['registration'] && (
            <p>
              <strong>Registration Staking: </strong>
              {deviceStatus['registration']}
            </p>
          )}
          {deviceStatus['node'] && (
            <p>
              <strong>Node Staking: </strong>
              {deviceStatus['node']}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertWithTooltip;
