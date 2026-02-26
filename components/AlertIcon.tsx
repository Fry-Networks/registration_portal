import { useMemo, useState } from 'react';

const LABELS: Record<string, string> = {
  position: 'Position',
  reward_wallet: 'Reward Wallet',
  registration: 'Registration Staking',
  node: 'Node Staking',
  hardware: 'Hardware',
};

const AlertWithTooltip = ({
  deviceStatus
}: {
  deviceStatus: { [key: string]: string };
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const issues = useMemo(() => {
    return Object.entries(deviceStatus)
      .filter(([_, value]) => Boolean(value))
      .map(([key, value]) => ({
        key,
        label: LABELS[key] ?? key.replace(/_/g, ' '),
        message: value,
      }));
  }, [deviceStatus]);

  if (!issues.length) return null;

  return (
    <div className="relative flex items-center justify-end">
      <div
        className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-red-500 text-[0.6rem] font-bold text-white"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        !
      </div>

      {isHovered && (
        <div className="absolute right-0 top-full z-50 mt-2 max-w-xs sm:max-w-sm rounded-md border border-red-500/40 bg-black/90 px-3 py-2 text-xs text-gray-100 shadow-lg">
          <div className="space-y-2">
            {issues.map(({ key, label, message }) => (
              <div key={key} className="leading-snug">
                <div className="font-semibold text-red-200">{label}</div>
                <div className="text-gray-200 whitespace-pre-wrap break-words">{message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertWithTooltip;
