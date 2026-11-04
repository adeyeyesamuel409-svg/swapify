/**
 * Swapify brand mark: two hook-arrows in 180° rotational symmetry — the
 * completed-trade glyph. Fixed brand colors (pink + navy).
 */
export default function SwapIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Swapify">
      <g transform="translate(32 32) scale(0.92) translate(-32 -32)">
        <path
          d="M31 37 C22 35 15 31 13.5 24 C12 16 18 10.5 26 9.5 C33 8.8 41 10.5 45.5 13.5"
          fill="none"
          stroke="#F12A7B"
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M44.5 20.5 L57 13.5 L44.5 6.5 Z"
          fill="#F12A7B"
          stroke="#F12A7B"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <g transform="rotate(180 32 32)">
          <path
            d="M31 37 C22 35 15 31 13.5 24 C12 16 18 10.5 26 9.5 C33 8.8 41 10.5 45.5 13.5"
            fill="none"
            stroke="#14152F"
            strokeWidth="7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M44.5 20.5 L57 13.5 L44.5 6.5 Z"
            fill="#14152F"
            stroke="#14152F"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
