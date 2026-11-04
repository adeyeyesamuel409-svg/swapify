import { BadgeCheck, Clock } from "lucide-react";

/**
 * Seller trust badges: "Verified Swapper" + ID-verification status chip.
 * Verification flags come from lib/mock.ts as design-only signals — wire to
 * real verification fields before public launch.
 */
export default function TrustBadges({
  verified,
  idVerified,
  size = "sm",
}: {
  verified: boolean;
  idVerified: boolean;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {verified && (
        <span
          className={`inline-flex items-center gap-1 rounded-pill border border-emerald-500/40 bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 ${pad}`}
        >
          <BadgeCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
          Verified Swapper
        </span>
      )}
      <span
        className={`inline-flex items-center gap-1 rounded-pill border font-semibold ${
          idVerified
            ? "border-sky-500/40 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
            : "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        } ${pad}`}
      >
        {idVerified ? (
          <BadgeCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
        ) : (
          <Clock className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
        )}
        {idVerified ? "ID verified" : "ID pending"}
      </span>
    </span>
  );
}
