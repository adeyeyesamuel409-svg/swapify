import { MapPin, Navigation, ShieldCheck } from "lucide-react";
import { FadeUp } from "../motion";

const POINTS = [
  {
    icon: MapPin,
    title: "Matched by proximity",
    body: "See what's swapping within walking distance before you scroll further afield.",
  },
  {
    icon: Navigation,
    title: "Handover, not postage",
    body: "Nearby swaps skip shipping entirely — meet locally and swap the same day.",
  },
  {
    icon: ShieldCheck,
    title: "Neighbourhood trust",
    body: "Verified profiles and completed-swap ratings keep every exchange accountable.",
  },
];

export default function LocalBand() {
  return (
    <section className="border-y border-line bg-surface-2">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <FadeUp>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            Hyper-local
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Swap locally — your street is the marketplace
          </h2>
          <p className="mt-4 max-w-lg text-muted">
            Two streets away beats two counties away. See how close every listing is and swap the
            same day.
          </p>

          <div className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold text-navy">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </FadeUp>

        <FadeUp delay={0.1}>
          <div className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-raise">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/swap4.jpg"
              alt="People browsing clothing rails at an outdoor neighbourhood swap event"
              width={735}
              height={1102}
              className="aspect-[3/4] w-full object-cover object-[center_45%]"
              loading="lazy"
            />
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
