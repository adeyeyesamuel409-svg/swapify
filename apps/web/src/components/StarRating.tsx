import { Star } from "lucide-react";

/** Five-star rating row (filled = rounded score). Server-safe presentational. */
export default function StarRating({
  score,
  size = "h-3.5 w-3.5",
  className = "",
}: {
  score: number;
  size?: string;
  className?: string;
}) {
  const rounded = Math.round(score);
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className}`}
      role="img"
      aria-label={`${score.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${size} ${i <= rounded ? "fill-token-soft text-token-soft" : "text-line-strong"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}
