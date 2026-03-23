/**
 * Topo Mesh — organic topographic contour lines over a blue-to-pink gradient.
 * Modern, artistic feel with flowing organic shapes.
 */
export default function TopoMeshBackground() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 w-full h-full z-0"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="tm-bg" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="hsl(220, 70%, 55%)" />
          <stop offset="50%" stopColor="hsl(270, 50%, 60%)" />
          <stop offset="100%" stopColor="hsl(330, 60%, 70%)" />
        </linearGradient>
        <linearGradient id="tm-bg-dark" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="hsl(220, 50%, 12%)" />
          <stop offset="50%" stopColor="hsl(260, 35%, 14%)" />
          <stop offset="100%" stopColor="hsl(320, 40%, 16%)" />
        </linearGradient>
      </defs>

      {/* Gradient base — light mode */}
      <rect width="1200" height="800" fill="url(#tm-bg)" opacity="0.15" className="dark:hidden" />
      {/* Gradient base — dark mode */}
      <rect width="1200" height="800" fill="url(#tm-bg-dark)" className="hidden dark:block" />

      {/* Topographic contour lines — right half organic cluster */}
      <g className="dark:hidden" fill="none" strokeWidth="0.8" opacity="0.2">
        {/* Outer contours */}
        <ellipse cx="850" cy="400" rx="320" ry="350" stroke="white" />
        <ellipse cx="855" cy="395" rx="290" ry="320" stroke="white" />
        <ellipse cx="860" cy="390" rx="260" ry="290" stroke="white" />
        <ellipse cx="865" cy="385" rx="230" ry="260" stroke="white" />
        <ellipse cx="870" cy="380" rx="200" ry="230" stroke="white" />
        <ellipse cx="875" cy="375" rx="170" ry="200" stroke="white" />
        <ellipse cx="880" cy="370" rx="140" ry="170" stroke="white" />
        <ellipse cx="885" cy="365" rx="110" ry="140" stroke="white" />
        <ellipse cx="890" cy="360" rx="80" ry="110" stroke="white" />
        <ellipse cx="895" cy="355" rx="50" ry="80" stroke="white" />

        {/* Organic deformed contours — secondary cluster */}
        <path d="M700,150 C750,120 820,100 880,130 C940,160 980,110 1020,140 C1060,170 1100,130 1150,160" stroke="white" />
        <path d="M720,180 C770,150 830,135 890,165 C950,195 990,140 1030,170 C1070,200 1110,160 1160,190" stroke="white" />
        <path d="M740,210 C790,180 840,170 900,200 C960,230 1000,170 1040,200 C1080,230 1120,190 1170,220" stroke="white" />
        <path d="M680,250 C730,220 810,200 870,230 C930,260 970,210 1010,240 C1050,270 1090,225 1140,255" stroke="white" />

        {/* Scattered organic loops */}
        <path d="M900,300 C930,260 970,250 1000,280 C1030,310 1010,350 980,340 C950,330 920,350 900,300" stroke="white" />
        <path d="M820,250 C850,210 890,200 920,230 C950,260 930,300 900,290 C870,280 840,295 820,250" stroke="white" />
        <path d="M950,200 C980,170 1020,165 1040,190 C1060,215 1045,245 1020,238 C995,231 965,240 950,200" stroke="white" />
      </g>

      {/* Dark mode contours — slightly brighter */}
      <g className="hidden dark:block" fill="none" strokeWidth="0.6" opacity="0.12">
        <ellipse cx="850" cy="400" rx="320" ry="350" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="855" cy="395" rx="290" ry="320" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="860" cy="390" rx="260" ry="290" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="865" cy="385" rx="230" ry="260" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="870" cy="380" rx="200" ry="230" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="875" cy="375" rx="170" ry="200" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="880" cy="370" rx="140" ry="170" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="885" cy="365" rx="110" ry="140" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="890" cy="360" rx="80" ry="110" stroke="hsl(260, 60%, 70%)" />
        <ellipse cx="895" cy="355" rx="50" ry="80" stroke="hsl(260, 60%, 70%)" />

        <path d="M700,150 C750,120 820,100 880,130 C940,160 980,110 1020,140 C1060,170 1100,130 1150,160" stroke="hsl(260, 50%, 60%)" />
        <path d="M720,180 C770,150 830,135 890,165 C950,195 990,140 1030,170 C1070,200 1110,160 1160,190" stroke="hsl(260, 50%, 60%)" />
        <path d="M740,210 C790,180 840,170 900,200 C960,230 1000,170 1040,200 C1080,230 1120,190 1170,220" stroke="hsl(260, 50%, 60%)" />

        <path d="M900,300 C930,260 970,250 1000,280 C1030,310 1010,350 980,340 C950,330 920,350 900,300" stroke="hsl(260, 50%, 60%)" />
        <path d="M820,250 C850,210 890,200 920,230 C950,260 930,300 900,290 C870,280 840,295 820,250" stroke="hsl(260, 50%, 60%)" />
      </g>
    </svg>
  );
}
