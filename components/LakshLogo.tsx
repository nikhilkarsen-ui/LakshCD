export default function LakshLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id="lk-lg" x1="50" y1="0" x2="50" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="42%" stopColor="#00d4aa" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
      </defs>

      {/* Outer left petal */}
      <path d="M 6 43 C 10 28 34 28 50 66 C 32 68 8 60 6 43 Z"
        fill="url(#lk-lg)" stroke="white" strokeWidth="2" strokeLinejoin="round" />

      {/* Outer right petal */}
      <path d="M 94 43 C 90 28 66 28 50 66 C 68 68 92 60 94 43 Z"
        fill="url(#lk-lg)" stroke="white" strokeWidth="2" strokeLinejoin="round" />

      {/* Inner left petal */}
      <path d="M 31 17 C 21 37 30 57 50 66 C 38 54 30 38 31 17 Z"
        fill="url(#lk-lg)" stroke="white" strokeWidth="2" strokeLinejoin="round" />

      {/* Inner right petal */}
      <path d="M 69 17 C 79 37 70 57 50 66 C 62 54 70 38 69 17 Z"
        fill="url(#lk-lg)" stroke="white" strokeWidth="2" strokeLinejoin="round" />

      {/* Center petal */}
      <path d="M 50 5 C 63 20 63 46 50 66 C 37 46 37 20 50 5 Z"
        fill="url(#lk-lg)" stroke="white" strokeWidth="2" strokeLinejoin="round" />

      {/* Inner flame / drop */}
      <path d="M 50 20 C 54 30 54 43 50 53 C 46 43 46 30 50 20 Z"
        fill="white" opacity="0.88" />

      {/* Wave 1 */}
      <path d="M 7 73 Q 28.5 68 50 73 Q 71.5 78 93 73"
        stroke="url(#lk-lg)" strokeWidth="2.8" strokeLinecap="round" />

      {/* Wave 2 */}
      <path d="M 12 80 Q 31 75 50 80 Q 69 85 88 80"
        stroke="url(#lk-lg)" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />

      {/* Wave 3 */}
      <path d="M 17 87 Q 33.5 82 50 87 Q 66.5 92 83 87"
        stroke="url(#lk-lg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}
