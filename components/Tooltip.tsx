import React, { ReactNode } from 'react';

type TooltipProps = {
  // Content that will trigger the tooltip when hovered/focused.
  children: ReactNode;
  // Tooltip body; accepts ReactNode so complex markup can be supplied.
  text: ReactNode;
  // Placement relative to the trigger. Defaults to top for backwards compatibility.
  side?: 'top' | 'bottom' | 'left' | 'right';
  // Optional styling hooks for edge cases (e.g. wider panels).
  className?: string;
};

const positionClasses: Record<string, string> = {
  // Each entry maps a placement option to the Tailwind classes required to position the tooltip body.
  top: 'left-1/2 -translate-x-1/2 bottom-full mb-2',
  bottom: 'left-1/2 -translate-x-1/2 top-full mt-2',
  left: 'top-1/2 -translate-y-1/2 right-full mr-2',
  right: 'top-1/2 -translate-y-1/2 left-full ml-2'
};

const Tooltip = ({ children, text, side = 'top', className = '' }: TooltipProps) => {
  // `group` utilities let us show the tooltip on hover without additional JS.
  return (
    <div className="relative inline-flex group">
      {children}
      <div
        className={`pointer-events-none absolute hidden group-hover:flex ${positionClasses[side]} ${className}`}
      >
        <div className="max-w-xs rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
          {text}
        </div>
      </div>
    </div>
  );
};

export default Tooltip;
