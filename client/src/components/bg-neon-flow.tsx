/**
 * Neon Flow — glowing pink/cyan energy waves on a dark background.
 * Bold, tech-forward aesthetic. Best suited for dark mode.
 */
export default function NeonFlowBackground() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 w-full h-full z-0"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Glow filters */}
        <filter id="nf-glow-pink" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="nf-glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="nf-glow-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="12" />
        </filter>

        <linearGradient id="nf-pink" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="hsl(340, 90%, 60%)" />
          <stop offset="40%" stopColor="hsl(320, 85%, 55%)" />
          <stop offset="100%" stopColor="hsl(280, 70%, 50%)" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="nf-cyan" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="hsl(200, 80%, 50%)" stopOpacity="0.3" />
          <stop offset="60%" stopColor="hsl(185, 90%, 55%)" />
          <stop offset="100%" stopColor="hsl(170, 85%, 50%)" />
        </linearGradient>
      </defs>

      {/* Dark base */}
      <rect width="1200" height="800" fill="hsl(220, 40%, 6%)" className="dark:block hidden" />
      <rect width="1200" height="800" fill="hsl(210, 20%, 96%)" className="dark:hidden" />

      {/* === Dark mode: neon energy waves === */}
      <g className="hidden dark:block">
        {/* Ambient glow spots */}
        <ellipse cx="250" cy="400" rx="200" ry="120" fill="hsl(340, 80%, 45%)" opacity="0.08" filter="url(#nf-glow-soft)" />
        <ellipse cx="900" cy="400" rx="200" ry="120" fill="hsl(190, 80%, 45%)" opacity="0.08" filter="url(#nf-glow-soft)" />

        {/* Horizontal scan line */}
        <line x1="0" y1="400" x2="1200" y2="400" stroke="hsl(200, 60%, 30%)" strokeWidth="0.5" opacity="0.3" />

        {/* Pink energy waves (left side) */}
        <g filter="url(#nf-glow-pink)" opacity="0.7">
          <path
            d="M0,380 C100,340 200,420 350,370 C500,320 550,400 650,390"
            fill="none" stroke="url(#nf-pink)" strokeWidth="2.5"
          />
          <path
            d="M0,400 C120,360 250,440 400,380 C550,320 600,410 700,395"
            fill="none" stroke="url(#nf-pink)" strokeWidth="1.8" opacity="0.8"
          />
          <path
            d="M0,420 C80,380 180,450 330,400 C480,350 580,430 680,400"
            fill="none" stroke="url(#nf-pink)" strokeWidth="1.2" opacity="0.6"
          />
          <path
            d="M50,360 C150,330 280,400 380,360 C480,320 530,390 620,380"
            fill="none" stroke="hsl(340, 85%, 65%)" strokeWidth="0.8" opacity="0.4"
          />
        </g>

        {/* Cyan energy waves (right side) */}
        <g filter="url(#nf-glow-cyan)" opacity="0.7">
          <path
            d="M550,410 C650,380 750,430 900,390 C1050,350 1100,400 1200,380"
            fill="none" stroke="url(#nf-cyan)" strokeWidth="2.5"
          />
          <path
            d="M500,395 C620,370 720,420 850,385 C980,350 1080,410 1200,400"
            fill="none" stroke="url(#nf-cyan)" strokeWidth="1.8" opacity="0.8"
          />
          <path
            d="M580,420 C680,390 780,440 920,400 C1060,360 1120,420 1200,410"
            fill="none" stroke="url(#nf-cyan)" strokeWidth="1.2" opacity="0.6"
          />
          <path
            d="M600,380 C700,360 820,410 940,378 C1060,346 1130,395 1200,385"
            fill="none" stroke="hsl(180, 85%, 60%)" strokeWidth="0.8" opacity="0.4"
          />
        </g>

        {/* Floating particles */}
        <g opacity="0.5">
          <circle cx="120" cy="350" r="2" fill="hsl(340, 80%, 60%)" />
          <circle cx="200" cy="430" r="1.5" fill="hsl(330, 75%, 55%)" />
          <circle cx="350" cy="370" r="2.5" fill="hsl(320, 70%, 50%)" />
          <circle cx="500" cy="395" r="1.8" fill="hsl(280, 60%, 55%)" />
          <circle cx="700" cy="385" r="2" fill="hsl(200, 75%, 55%)" />
          <circle cx="850" cy="410" r="1.5" fill="hsl(185, 80%, 55%)" />
          <circle cx="950" cy="365" r="2.5" fill="hsl(180, 85%, 50%)" />
          <circle cx="1080" cy="395" r="1.8" fill="hsl(175, 80%, 55%)" />
          <circle cx="80" cy="420" r="1.2" fill="hsl(340, 75%, 65%)" />
          <circle cx="1120" cy="420" r="1.2" fill="hsl(170, 80%, 60%)" />
        </g>
      </g>

      {/* === Light mode: subdued version of same pattern === */}
      <g className="dark:hidden" opacity="0.3">
        <path
          d="M0,380 C100,340 200,420 350,370 C500,320 550,400 650,390"
          fill="none" stroke="hsl(340, 70%, 65%)" strokeWidth="2"
        />
        <path
          d="M0,400 C120,360 250,440 400,380 C550,320 600,410 700,395"
          fill="none" stroke="hsl(330, 65%, 70%)" strokeWidth="1.5"
        />
        <path
          d="M550,410 C650,380 750,430 900,390 C1050,350 1100,400 1200,380"
          fill="none" stroke="hsl(200, 70%, 60%)" strokeWidth="2"
        />
        <path
          d="M500,395 C620,370 720,420 850,385 C980,350 1080,410 1200,400"
          fill="none" stroke="hsl(190, 65%, 65%)" strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}
