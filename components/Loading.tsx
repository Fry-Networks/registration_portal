
const Loading = () => {
  return (
    <svg
      className="animate-spin h-6 w-6 text-red-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <defs>
        <linearGradient
          id="redGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="0%"
        >
          <stop offset="0%" stopColor="#ff0000" />
          <stop offset="50%" stopColor="#ff4d4d" />
          <stop offset="100%" stopColor="#ff9999" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="url(#redGradient)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default Loading;