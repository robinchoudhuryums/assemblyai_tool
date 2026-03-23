/**
 * Soft Waves — gentle flowing blue curves with halftone dot accents.
 * Light, professional feel. Best in light mode.
 */
export default function SoftWavesBackground() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 w-full h-full z-0"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sw-grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(210, 100%, 92%)" />
          <stop offset="100%" stopColor="hsl(210, 100%, 82%)" />
        </linearGradient>
        <linearGradient id="sw-grad2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(210, 90%, 88%)" />
          <stop offset="100%" stopColor="hsl(210, 95%, 95%)" />
        </linearGradient>
        <linearGradient id="sw-grad3" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(215, 100%, 90%)" />
          <stop offset="100%" stopColor="hsl(205, 90%, 85%)" />
        </linearGradient>
        {/* Halftone dot pattern */}
        <pattern id="sw-dots" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="0.8" fill="white" opacity="0.4" />
        </pattern>
      </defs>

      {/* Base fill */}
      <rect width="1200" height="800" fill="hsl(210, 80%, 95%)" className="dark:hidden" />
      <rect width="1200" height="800" fill="hsl(220, 30%, 8%)" className="hidden dark:block" />

      {/* Large flowing curves — light mode */}
      <g className="dark:hidden">
        {/* Wave 1 — sweeping from bottom-left to top-right */}
        <path
          d="M-100,600 C200,500 400,300 600,350 C800,400 1000,200 1300,150 L1300,800 L-100,800 Z"
          fill="url(#sw-grad1)"
          opacity="0.5"
        />
        {/* Wave 2 — crossing wave */}
        <path
          d="M-100,200 C100,400 350,500 600,400 C850,300 1000,450 1300,350 L1300,800 L-100,800 Z"
          fill="url(#sw-grad2)"
          opacity="0.4"
        />
        {/* Wave 3 — foreground accent */}
        <path
          d="M-100,500 C150,350 400,450 650,380 C900,310 1050,500 1300,420 L1300,800 L-100,800 Z"
          fill="url(#sw-grad3)"
          opacity="0.35"
        />
        {/* Subtle highlight wave */}
        <path
          d="M-100,300 C200,250 500,350 700,280 C900,210 1100,300 1300,250"
          fill="none"
          stroke="white"
          strokeWidth="1.5"
          opacity="0.3"
        />
        {/* Halftone dot overlay along a curve */}
        <path
          d="M-100,350 C200,280 500,400 750,320 C1000,240 1100,360 1300,300 L1300,500 L-100,500 Z"
          fill="url(#sw-dots)"
          opacity="0.6"
        />
      </g>

      {/* Dark mode version — muted blue tones */}
      <g className="hidden dark:block">
        <path
          d="M-100,600 C200,500 400,300 600,350 C800,400 1000,200 1300,150 L1300,800 L-100,800 Z"
          fill="hsl(215, 50%, 15%)"
          opacity="0.5"
        />
        <path
          d="M-100,200 C100,400 350,500 600,400 C850,300 1000,450 1300,350 L1300,800 L-100,800 Z"
          fill="hsl(210, 45%, 12%)"
          opacity="0.4"
        />
        <path
          d="M-100,500 C150,350 400,450 650,380 C900,310 1050,500 1300,420 L1300,800 L-100,800 Z"
          fill="hsl(220, 40%, 18%)"
          opacity="0.35"
        />
        <path
          d="M-100,300 C200,250 500,350 700,280 C900,210 1100,300 1300,250"
          fill="none"
          stroke="hsl(210, 60%, 40%)"
          strokeWidth="1"
          opacity="0.2"
        />
      </g>
    </svg>
  );
}
