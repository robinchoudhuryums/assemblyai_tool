/**
 * Hexagonal background pattern inspired by the isometric cube design.
 * Renders an SVG with outlined hexagons and filled cubes that flow
 * from blue (bottom-left) to pink (top-right).
 *
 * Pure CSS/SVG — no canvas, no JS animation, no performance cost.
 */
export default function HexBackground() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 w-full h-full z-0"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Gradient flowing from blue (bottom-left) to pink (top-right) */}
        <linearGradient id="hex-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(217, 91%, 60%)" />
          <stop offset="50%" stopColor="hsl(260, 60%, 68%)" />
          <stop offset="100%" stopColor="hsl(330, 70%, 72%)" />
        </linearGradient>

        {/* Reusable hexagon path (flat-top, radius ~28) */}
        <polygon id="hex" points="28,0 56,16 56,48 28,64 0,48 0,16" />

        {/* Cube face paths for isometric cubes */}
        <path id="cube-top" d="M28,0 L56,16 L28,32 L0,16 Z" />
        <path id="cube-left" d="M0,16 L28,32 L28,64 L0,48 Z" />
        <path id="cube-right" d="M56,16 L28,32 L28,64 L56,48 Z" />
      </defs>

      {/* Light grid of outlined hexagons */}
      <g className="stroke-slate-300/40 dark:stroke-slate-600/20" fill="none" strokeWidth="0.8">
        {/* Row 1 */}
        <use href="#hex" x="0" y="0" />
        <use href="#hex" x="84" y="0" />
        <use href="#hex" x="168" y="0" />
        <use href="#hex" x="252" y="0" />
        <use href="#hex" x="336" y="0" />
        <use href="#hex" x="420" y="0" />
        <use href="#hex" x="504" y="0" />
        <use href="#hex" x="588" y="0" />
        <use href="#hex" x="672" y="0" />
        <use href="#hex" x="756" y="0" />
        <use href="#hex" x="840" y="0" />
        <use href="#hex" x="924" y="0" />
        <use href="#hex" x="1008" y="0" />
        <use href="#hex" x="1092" y="0" />
        <use href="#hex" x="1176" y="0" />
        {/* Row 2 (offset) */}
        <use href="#hex" x="42" y="48" />
        <use href="#hex" x="126" y="48" />
        <use href="#hex" x="210" y="48" />
        <use href="#hex" x="294" y="48" />
        <use href="#hex" x="378" y="48" />
        <use href="#hex" x="462" y="48" />
        <use href="#hex" x="546" y="48" />
        <use href="#hex" x="630" y="48" />
        <use href="#hex" x="714" y="48" />
        <use href="#hex" x="798" y="48" />
        <use href="#hex" x="882" y="48" />
        <use href="#hex" x="966" y="48" />
        <use href="#hex" x="1050" y="48" />
        <use href="#hex" x="1134" y="48" />
        {/* Row 3 */}
        <use href="#hex" x="0" y="96" />
        <use href="#hex" x="84" y="96" />
        <use href="#hex" x="168" y="96" />
        <use href="#hex" x="252" y="96" />
        <use href="#hex" x="336" y="96" />
        <use href="#hex" x="420" y="96" />
        <use href="#hex" x="504" y="96" />
        <use href="#hex" x="588" y="96" />
        <use href="#hex" x="672" y="96" />
        <use href="#hex" x="756" y="96" />
        <use href="#hex" x="840" y="96" />
        <use href="#hex" x="924" y="96" />
        <use href="#hex" x="1008" y="96" />
        <use href="#hex" x="1092" y="96" />
        <use href="#hex" x="1176" y="96" />
        {/* Row 4 (offset) */}
        <use href="#hex" x="42" y="144" />
        <use href="#hex" x="126" y="144" />
        <use href="#hex" x="210" y="144" />
        <use href="#hex" x="294" y="144" />
        <use href="#hex" x="378" y="144" />
        <use href="#hex" x="462" y="144" />
        <use href="#hex" x="546" y="144" />
        <use href="#hex" x="630" y="144" />
        <use href="#hex" x="714" y="144" />
        <use href="#hex" x="798" y="144" />
        <use href="#hex" x="882" y="144" />
        <use href="#hex" x="966" y="144" />
        <use href="#hex" x="1050" y="144" />
        <use href="#hex" x="1134" y="144" />
        {/* Row 5 */}
        <use href="#hex" x="0" y="192" />
        <use href="#hex" x="84" y="192" />
        <use href="#hex" x="168" y="192" />
        <use href="#hex" x="252" y="192" />
        <use href="#hex" x="336" y="192" />
        <use href="#hex" x="420" y="192" />
        <use href="#hex" x="504" y="192" />
        <use href="#hex" x="588" y="192" />
        <use href="#hex" x="672" y="192" />
        <use href="#hex" x="756" y="192" />
        <use href="#hex" x="840" y="192" />
        <use href="#hex" x="924" y="192" />
        <use href="#hex" x="1008" y="192" />
        <use href="#hex" x="1092" y="192" />
        <use href="#hex" x="1176" y="192" />
        {/* Row 6 (offset) */}
        <use href="#hex" x="42" y="240" />
        <use href="#hex" x="126" y="240" />
        <use href="#hex" x="210" y="240" />
        <use href="#hex" x="294" y="240" />
        <use href="#hex" x="378" y="240" />
        <use href="#hex" x="462" y="240" />
        <use href="#hex" x="546" y="240" />
        <use href="#hex" x="630" y="240" />
        <use href="#hex" x="714" y="240" />
        <use href="#hex" x="798" y="240" />
        <use href="#hex" x="882" y="240" />
        <use href="#hex" x="966" y="240" />
        <use href="#hex" x="1050" y="240" />
        <use href="#hex" x="1134" y="240" />
        {/* Row 7 */}
        <use href="#hex" x="0" y="288" />
        <use href="#hex" x="84" y="288" />
        <use href="#hex" x="168" y="288" />
        <use href="#hex" x="252" y="288" />
        <use href="#hex" x="336" y="288" />
        <use href="#hex" x="420" y="288" />
        <use href="#hex" x="504" y="288" />
        <use href="#hex" x="588" y="288" />
        <use href="#hex" x="672" y="288" />
        <use href="#hex" x="756" y="288" />
        <use href="#hex" x="840" y="288" />
        <use href="#hex" x="924" y="288" />
        <use href="#hex" x="1008" y="288" />
        <use href="#hex" x="1092" y="288" />
        <use href="#hex" x="1176" y="288" />
        {/* Row 8 (offset) */}
        <use href="#hex" x="42" y="336" />
        <use href="#hex" x="126" y="336" />
        <use href="#hex" x="210" y="336" />
        <use href="#hex" x="294" y="336" />
        <use href="#hex" x="378" y="336" />
        <use href="#hex" x="462" y="336" />
        <use href="#hex" x="546" y="336" />
        <use href="#hex" x="630" y="336" />
        <use href="#hex" x="714" y="336" />
        <use href="#hex" x="798" y="336" />
        <use href="#hex" x="882" y="336" />
        <use href="#hex" x="966" y="336" />
        <use href="#hex" x="1050" y="336" />
        <use href="#hex" x="1134" y="336" />
        {/* Row 9 */}
        <use href="#hex" x="0" y="384" />
        <use href="#hex" x="84" y="384" />
        <use href="#hex" x="168" y="384" />
        <use href="#hex" x="252" y="384" />
        <use href="#hex" x="336" y="384" />
        <use href="#hex" x="420" y="384" />
        <use href="#hex" x="504" y="384" />
        <use href="#hex" x="588" y="384" />
        <use href="#hex" x="672" y="384" />
        <use href="#hex" x="756" y="384" />
        <use href="#hex" x="840" y="384" />
        <use href="#hex" x="924" y="384" />
        <use href="#hex" x="1008" y="384" />
        <use href="#hex" x="1092" y="384" />
        <use href="#hex" x="1176" y="384" />
        {/* Row 10 (offset) */}
        <use href="#hex" x="42" y="432" />
        <use href="#hex" x="126" y="432" />
        <use href="#hex" x="210" y="432" />
        <use href="#hex" x="294" y="432" />
        <use href="#hex" x="378" y="432" />
        <use href="#hex" x="462" y="432" />
        <use href="#hex" x="546" y="432" />
        <use href="#hex" x="630" y="432" />
        <use href="#hex" x="714" y="432" />
        <use href="#hex" x="798" y="432" />
        <use href="#hex" x="882" y="432" />
        <use href="#hex" x="966" y="432" />
        <use href="#hex" x="1050" y="432" />
        <use href="#hex" x="1134" y="432" />
        {/* Row 11 */}
        <use href="#hex" x="0" y="480" />
        <use href="#hex" x="84" y="480" />
        <use href="#hex" x="168" y="480" />
        <use href="#hex" x="252" y="480" />
        <use href="#hex" x="336" y="480" />
        <use href="#hex" x="420" y="480" />
        <use href="#hex" x="504" y="480" />
        <use href="#hex" x="588" y="480" />
        <use href="#hex" x="672" y="480" />
        <use href="#hex" x="756" y="480" />
        <use href="#hex" x="840" y="480" />
        <use href="#hex" x="924" y="480" />
        <use href="#hex" x="1008" y="480" />
        <use href="#hex" x="1092" y="480" />
        <use href="#hex" x="1176" y="480" />
        {/* Row 12 (offset) */}
        <use href="#hex" x="42" y="528" />
        <use href="#hex" x="126" y="528" />
        <use href="#hex" x="210" y="528" />
        <use href="#hex" x="294" y="528" />
        <use href="#hex" x="378" y="528" />
        <use href="#hex" x="462" y="528" />
        <use href="#hex" x="546" y="528" />
        <use href="#hex" x="630" y="528" />
        <use href="#hex" x="714" y="528" />
        <use href="#hex" x="798" y="528" />
        <use href="#hex" x="882" y="528" />
        <use href="#hex" x="966" y="528" />
        <use href="#hex" x="1050" y="528" />
        <use href="#hex" x="1134" y="528" />
        {/* Row 13 */}
        <use href="#hex" x="0" y="576" />
        <use href="#hex" x="84" y="576" />
        <use href="#hex" x="168" y="576" />
        <use href="#hex" x="252" y="576" />
        <use href="#hex" x="336" y="576" />
        <use href="#hex" x="420" y="576" />
        <use href="#hex" x="504" y="576" />
        <use href="#hex" x="588" y="576" />
        <use href="#hex" x="672" y="576" />
        <use href="#hex" x="756" y="576" />
        <use href="#hex" x="840" y="576" />
        <use href="#hex" x="924" y="576" />
        <use href="#hex" x="1008" y="576" />
        <use href="#hex" x="1092" y="576" />
        <use href="#hex" x="1176" y="576" />
        {/* Row 14 (offset) */}
        <use href="#hex" x="42" y="624" />
        <use href="#hex" x="126" y="624" />
        <use href="#hex" x="210" y="624" />
        <use href="#hex" x="294" y="624" />
        <use href="#hex" x="378" y="624" />
        <use href="#hex" x="462" y="624" />
        <use href="#hex" x="546" y="624" />
        <use href="#hex" x="630" y="624" />
        <use href="#hex" x="714" y="624" />
        <use href="#hex" x="798" y="624" />
        <use href="#hex" x="882" y="624" />
        <use href="#hex" x="966" y="624" />
        <use href="#hex" x="1050" y="624" />
        <use href="#hex" x="1134" y="624" />
        {/* Row 15 */}
        <use href="#hex" x="0" y="672" />
        <use href="#hex" x="84" y="672" />
        <use href="#hex" x="168" y="672" />
        <use href="#hex" x="252" y="672" />
        <use href="#hex" x="336" y="672" />
        <use href="#hex" x="420" y="672" />
        <use href="#hex" x="504" y="672" />
        <use href="#hex" x="588" y="672" />
        <use href="#hex" x="672" y="672" />
        <use href="#hex" x="756" y="672" />
        <use href="#hex" x="840" y="672" />
        <use href="#hex" x="924" y="672" />
        <use href="#hex" x="1008" y="672" />
        <use href="#hex" x="1092" y="672" />
        <use href="#hex" x="1176" y="672" />
        {/* Row 16 (offset) */}
        <use href="#hex" x="42" y="720" />
        <use href="#hex" x="126" y="720" />
        <use href="#hex" x="210" y="720" />
        <use href="#hex" x="294" y="720" />
        <use href="#hex" x="378" y="720" />
        <use href="#hex" x="462" y="720" />
        <use href="#hex" x="546" y="720" />
        <use href="#hex" x="630" y="720" />
        <use href="#hex" x="714" y="720" />
        <use href="#hex" x="798" y="720" />
        <use href="#hex" x="882" y="720" />
        <use href="#hex" x="966" y="720" />
        <use href="#hex" x="1050" y="720" />
        <use href="#hex" x="1134" y="720" />
        {/* Row 17 */}
        <use href="#hex" x="0" y="768" />
        <use href="#hex" x="84" y="768" />
        <use href="#hex" x="168" y="768" />
        <use href="#hex" x="252" y="768" />
        <use href="#hex" x="336" y="768" />
        <use href="#hex" x="420" y="768" />
        <use href="#hex" x="504" y="768" />
        <use href="#hex" x="588" y="768" />
        <use href="#hex" x="672" y="768" />
        <use href="#hex" x="756" y="768" />
        <use href="#hex" x="840" y="768" />
        <use href="#hex" x="924" y="768" />
        <use href="#hex" x="1008" y="768" />
        <use href="#hex" x="1092" y="768" />
        <use href="#hex" x="1176" y="768" />
      </g>

      {/* Filled isometric cubes — scattered along the blue→pink diagonal */}
      {/* Bottom-left cluster (blue tones) */}
      <g opacity="0.55">
        <g transform="translate(0, 576)">
          <use href="#cube-top" fill="hsl(217, 85%, 62%)" />
          <use href="#cube-left" fill="hsl(217, 80%, 55%)" />
          <use href="#cube-right" fill="hsl(217, 75%, 70%)" />
        </g>
        <g transform="translate(84, 576)">
          <use href="#cube-top" fill="hsl(217, 80%, 68%)" />
          <use href="#cube-left" fill="hsl(217, 75%, 60%)" />
          <use href="#cube-right" fill="hsl(217, 70%, 75%)" />
        </g>
        <g transform="translate(42, 528)">
          <use href="#cube-top" fill="hsl(217, 80%, 72%)" />
          <use href="#cube-left" fill="hsl(217, 75%, 64%)" />
          <use href="#cube-right" fill="hsl(217, 70%, 78%)" />
        </g>
        <g transform="translate(0, 480)">
          <use href="#cube-top" fill="hsl(220, 75%, 75%)" />
          <use href="#cube-left" fill="hsl(220, 70%, 68%)" />
          <use href="#cube-right" fill="hsl(220, 65%, 80%)" />
        </g>
        <g transform="translate(168, 576)">
          <use href="#cube-top" fill="hsl(222, 70%, 74%)" />
          <use href="#cube-left" fill="hsl(222, 65%, 66%)" />
          <use href="#cube-right" fill="hsl(222, 60%, 80%)" />
        </g>
      </g>

      {/* Center cluster (lavender/purple tones) */}
      <g opacity="0.45">
        <g transform="translate(420, 336)">
          <use href="#cube-top" fill="hsl(255, 55%, 72%)" />
          <use href="#cube-left" fill="hsl(255, 50%, 64%)" />
          <use href="#cube-right" fill="hsl(255, 45%, 78%)" />
        </g>
        <g transform="translate(504, 336)">
          <use href="#cube-top" fill="hsl(260, 50%, 74%)" />
          <use href="#cube-left" fill="hsl(260, 45%, 66%)" />
          <use href="#cube-right" fill="hsl(260, 40%, 80%)" />
        </g>
        <g transform="translate(462, 288)">
          <use href="#cube-top" fill="hsl(258, 52%, 70%)" />
          <use href="#cube-left" fill="hsl(258, 47%, 62%)" />
          <use href="#cube-right" fill="hsl(258, 42%, 76%)" />
        </g>
        <g transform="translate(546, 288)">
          <use href="#cube-top" fill="hsl(262, 48%, 76%)" />
          <use href="#cube-left" fill="hsl(262, 43%, 68%)" />
          <use href="#cube-right" fill="hsl(262, 38%, 82%)" />
        </g>
        <g transform="translate(504, 240)">
          <use href="#cube-top" fill="hsl(265, 45%, 78%)" />
          <use href="#cube-left" fill="hsl(265, 40%, 70%)" />
          <use href="#cube-right" fill="hsl(265, 35%, 84%)" />
        </g>
        <g transform="translate(378, 384)">
          <use href="#cube-top" fill="hsl(250, 50%, 75%)" />
          <use href="#cube-left" fill="hsl(250, 45%, 67%)" />
          <use href="#cube-right" fill="hsl(250, 40%, 81%)" />
        </g>
      </g>

      {/* Top-right cluster (pink tones) */}
      <g opacity="0.5">
        <g transform="translate(924, 96)">
          <use href="#cube-top" fill="hsl(320, 60%, 74%)" />
          <use href="#cube-left" fill="hsl(320, 55%, 66%)" />
          <use href="#cube-right" fill="hsl(320, 50%, 80%)" />
        </g>
        <g transform="translate(1008, 96)">
          <use href="#cube-top" fill="hsl(325, 65%, 72%)" />
          <use href="#cube-left" fill="hsl(325, 60%, 64%)" />
          <use href="#cube-right" fill="hsl(325, 55%, 78%)" />
        </g>
        <g transform="translate(966, 48)">
          <use href="#cube-top" fill="hsl(330, 68%, 76%)" />
          <use href="#cube-left" fill="hsl(330, 63%, 68%)" />
          <use href="#cube-right" fill="hsl(330, 58%, 82%)" />
        </g>
        <g transform="translate(1050, 48)">
          <use href="#cube-top" fill="hsl(335, 65%, 74%)" />
          <use href="#cube-left" fill="hsl(335, 60%, 66%)" />
          <use href="#cube-right" fill="hsl(335, 55%, 80%)" />
        </g>
        <g transform="translate(1008, 0)">
          <use href="#cube-top" fill="hsl(328, 70%, 78%)" />
          <use href="#cube-left" fill="hsl(328, 65%, 70%)" />
          <use href="#cube-right" fill="hsl(328, 60%, 84%)" />
        </g>
        <g transform="translate(840, 144)">
          <use href="#cube-top" fill="hsl(315, 55%, 76%)" />
          <use href="#cube-left" fill="hsl(315, 50%, 68%)" />
          <use href="#cube-right" fill="hsl(315, 45%, 82%)" />
        </g>
      </g>

      {/* Scattered accent cubes along the diagonal */}
      <g opacity="0.3">
        <g transform="translate(210, 480)">
          <use href="#cube-top" fill="hsl(230, 65%, 72%)" />
          <use href="#cube-left" fill="hsl(230, 60%, 64%)" />
          <use href="#cube-right" fill="hsl(230, 55%, 78%)" />
        </g>
        <g transform="translate(336, 384)">
          <use href="#cube-top" fill="hsl(245, 55%, 74%)" />
          <use href="#cube-left" fill="hsl(245, 50%, 66%)" />
          <use href="#cube-right" fill="hsl(245, 45%, 80%)" />
        </g>
        <g transform="translate(672, 192)">
          <use href="#cube-top" fill="hsl(285, 50%, 74%)" />
          <use href="#cube-left" fill="hsl(285, 45%, 66%)" />
          <use href="#cube-right" fill="hsl(285, 40%, 80%)" />
        </g>
        <g transform="translate(798, 144)">
          <use href="#cube-top" fill="hsl(305, 55%, 76%)" />
          <use href="#cube-left" fill="hsl(305, 50%, 68%)" />
          <use href="#cube-right" fill="hsl(305, 45%, 82%)" />
        </g>
      </g>
    </svg>
  );
}
