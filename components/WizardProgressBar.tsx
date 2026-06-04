import { CheckIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';

interface WizardProgressBarProps {
  steps: string[];
  currentStep: number; // 0-based index
  completedSteps: boolean[];
}

export default function WizardProgressBar({ steps, currentStep, completedSteps }: WizardProgressBarProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <div className={`mx-2 sm:mx-20 mt-4 mb-2 rounded-2xl border p-4 ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = completedSteps[index];
          const isActive = index === currentStep;
          const isFuture = index > currentStep;

          const circleClass = isCompleted
            ? (isDark ? 'bg-green-500 text-white' : 'bg-emerald-500 text-white')
            : isActive
              ? (isDark ? 'bg-red-500 text-white' : 'bg-red-600 text-white')
              : (isDark ? 'bg-white/10 text-white/50' : 'bg-slate-200 text-slate-500');

          const textClass = isCompleted
            ? (isDark ? 'text-green-400' : 'text-emerald-600')
            : isActive
              ? (isDark ? 'text-white' : 'text-slate-900')
              : (isDark ? 'text-white/50' : 'text-slate-500');

          return (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${circleClass}`}>
                  {isCompleted ? <CheckIcon className="h-4 w-4" /> : index + 1}
                </div>
                <span className={`text-xs font-medium ${textClass}`}>{step}</span>
              </div>
              {index < steps.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 rounded ${isCompleted ? (isDark ? 'bg-green-500/50' : 'bg-emerald-500/50') : (isDark ? 'bg-white/10' : 'bg-slate-200')}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
