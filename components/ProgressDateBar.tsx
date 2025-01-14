import { useState, useEffect } from 'react';

function getDaysConsideringTime(startDate: Date, endDate: Date): number {
  // Set both dates to midnight to ignore hour differences
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );
  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );

  console.log('targetDate: ', start, end);

  // Get the difference in time in milliseconds
  const differenceInTime = end.getTime() - start.getTime();

  // Convert the difference to days (ignoring time)
  const differenceInDays = differenceInTime / (1000 * 60 * 60 * 24);

  return differenceInDays;
}

const ProgressDateBar = ({ specificDate, boosted }) => {
  const [progress, setProgress] = useState(0);
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const currentDateObj = new Date();
    const targetDate = new Date(specificDate);
    const endDate = new Date(targetDate);
    endDate.setDate(targetDate.getDate() + 30);

    const differenceInDays = getDaysConsideringTime(targetDate, currentDateObj);

    // Calculate difference in days
    // const differenceInTime =
    //   currentDateObj.getTime() - targetDate.getTime();
    // const differenceInDays = Math.floor(
    //   differenceInTime / (1000 * 60 * 60 * 24)
    // );

    console.log('ProgressBar: ', differenceInDays);

    // Ensure progress is within 0 to 30 days
    const calculatedProgress = boosted
      ? 30
      : Math.min(Math.max(differenceInDays, 0), 30);

    setProgress(calculatedProgress);

    // Set current date string
    setCurrentDate(currentDateObj.toISOString().split('T')[0]);
  }, [specificDate, boosted]);

  // Format dates for display
  const startDate = specificDate;
  const endDate = new Date(
    new Date(specificDate).setDate(new Date(specificDate).getDate() + 30)
  )
    .toISOString()
    .split('T')[0];

  return (
    <div className="w-full mt-8">
      <div className="relative w-full h-2 bg-red-500 rounded-md overflow-hidden">
        {/* Progress bar */}
        <div
          className={`h-full ${'bg-green-500'} transition-all duration-300`}
          style={{ width: `${(progress / 30) * 100}%` }}
        ></div>

        {/* Current date marker */}
        <div
          className="absolute top-[-1rem] transform -translate-x-1/2 text-sm text-gray-700"
          style={{ left: `${(progress / 30) * 100}%` }}
        >
          {progress !== 30 ? currentDate : ''}
        </div>
      </div>
      <p className="text-center mt-2 text-gray-700">
        {progress === 30 ? 'Claimable' : `${progress} / 30 days`}
      </p>
    </div>
  );
};

export default ProgressDateBar;
