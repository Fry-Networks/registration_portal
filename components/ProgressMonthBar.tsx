import { useState, useEffect } from 'react';

const ProgressMonthBar = ({ specificDate, pA }) => {
  const [progress, setProgress] = useState(0);
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const currentDateObj = new Date();
    const targetDate = new Date(specificDate);
    const endDate = new Date(targetDate);
    endDate.setDate(targetDate.getDate() + 360);
    // const differenceInDays = getDaysConsideringTime(targetDate, currentDateObj);

    // Calculate difference in days
    const differenceInTime =
      currentDateObj.getTime() - targetDate.getTime();
    const differenceInDays = Math.floor(
      differenceInTime / (1000 * 60 * 60 * 24)
    );

    // Ensure progress is within 0 to 360 days
    const calculatedProgress = Math.min(Math.max(differenceInDays, 0), 360);
    setProgress(calculatedProgress);

    // Set current date string
    setCurrentDate(currentDateObj.toISOString().split('T')[0]);
  }, [specificDate]);

  return (
    <div className="w-full mt-8">
      <div className="relative w-full h-2 bg-red-500 rounded-md overflow-hidden">
        {/* Progress bar */}
        <div
          className={`h-full ${'bg-green-500'} transition-all duration-300`}
          style={{ width: `${(progress / 360) * 100}%` }}
        ></div>

        {/* Current date marker */}
        <div
          className="absolute top-[-1rem] transform -translate-x-1/2 text-sm text-gray-700"
          style={{ left: `${(progress / 360) * 100}%` }}
        >
          {progress !== 360 ? currentDate : ''}
        </div>
      </div>
      <p className="text-center mt-2 text-gray-700">
        {progress >= 360 ? (pA === 0 ? 'All Claimed' : 'Claimable') : `${Math.floor(progress / 30) + 1} / 12 months`}
      </p>
    </div>
  );
};

export default ProgressMonthBar;
