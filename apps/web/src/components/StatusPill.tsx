type Tone = "brand" | "amber" | "sky" | "emerald" | "rose" | "muted";

const tones: Record<Tone, string> = {
  brand: "border-primary/30 bg-primary/15 text-primary-soft",
  amber: "border-amber-500/40 bg-amber-950 text-amber-300",
  sky: "border-sky-500/40 bg-sky-950 text-sky-300",
  emerald: "border-emerald-500/40 bg-emerald-950 text-emerald-300",
  rose: "border-rose-500/40 bg-rose-950 text-rose-300",
  muted: "border-line bg-surface-2 text-muted",
};

export default function StatusPill({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-pill border px-3 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {label}
    </span>
  );
}
