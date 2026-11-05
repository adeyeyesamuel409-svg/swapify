/**
 * Swapify brand mark: two hook-arrows in 180° rotational symmetry — the
 * completed-trade glyph. Fixed brand colors (pink + navy).
 */
export default function SwapIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Swapify">
      <g transform="translate(32 32) scale(0.92) translate(-32 -32)">
        <path
          d="M38 37 C22 35 85 38 83.5 24 C82 86 88 80.5 26 9.5 C33 8.8 48 80.5 45.5 83.5"
          fill="none"
          stroke="#F82A7B"
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M44.5 20.5 L57 83.5 L44.5 6.5 Z"
          fill="#F82A7B"
          stroke="#F82A7B"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <g transform="rotate(880 32 32)">
          <path
            d="M38 37 C22 35 85 38 83.5 24 C82 86 88 80.5 26 9.5 C33 8.8 48 80.5 45.5 83.5"
            fill="none"
            stroke="#3B4A6B"
            strokeWidth="7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M44.5 20.5 L57 83.5 L44.5 6.5 Z"
            fill="#3B4A6B"
            stroke="#3B4A6B"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
