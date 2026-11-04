import { BadgeCheck } from "lucide-react";

/**
 * Seller trust badge: "Verified Swapper". The flag comes from lib/mock.ts as a
 * design-only signal — email verification is the real account gate; wire this
 * to a real trust signal before public launch.
 */
export default function TrustBadges({
  verified,
  size = "sm",
}: {
  verified: boolean;
  size?: "sm" | "md";
}) {
  if (!verified) return null;
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill border border-emerald-500/40 bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ${pad}`}
    >
      <BadgeCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      Verified Swapper
    </span>
  );
}
