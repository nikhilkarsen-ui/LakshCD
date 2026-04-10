export default function LakshLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 78" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id="lk-g" x1="50" y1="5" x2="50" y2="73" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#6ee7b7" />
          <stop offset="45%"  stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Left petal — angular leaf pointing upper-left */}
      <path
        d="M 23 20 L 5 54 L 27 62 L 36 46"
        stroke="url(#lk-g)" strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Right petal — mirror */}
      <path
        d="M 77 20 L 95 54 L 73 62 L 64 46"
        stroke="url(#lk-g)" strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Center petal — tall pointed shield */}
      <path
        d="M 50 6 L 36 46 L 50 56 L 64 46 Z"
        stroke="url(#lk-g)" strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Inner arcs — the curved "M" where side petals dip into center */}
      <path
        d="M 27 62 Q 38 52 50 56 Q 62 52 73 62"
        stroke="url(#lk-g)" strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Diamond at base */}
      <path
        d="M 50 56 L 43 64 L 50 72 L 57 64 Z"
        stroke="url(#lk-g)" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}
