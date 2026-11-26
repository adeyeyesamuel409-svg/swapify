import { MapPin, Navigation, ShieldCheck, Sparkles } from "lucide-react";
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
    body: "Nearby swaps skip shipping entirely. Meet locally and swap the same day.",
  },
  {
    icon: ShieldCheck,
    title: "Neighbourhood trust",
    body: "Verified profiles and completed-swap ratings keep every exchange accountable.",
  },
];

/**
 * Merged community band: the hyper-local story and the swap-meet spirit in one
 * place (replaces the old separate Local + Community sections).
 */
export default function LocalCommunityBand() {
  return (
    <section className="border-y border-line bg-surface-2">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <FadeUp>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            Hyper-local community
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Swap locally. Your street is the marketplace.
          </h2>
          <p className="mt-4 max-w-lg text-muted">
            Two streets away beats two counties away. Great finds, fair trades and zero folding
            tables: all the best parts of a swap meet, on your schedule.
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
          <div className="grid grid-cols-2 gap-4">
            <div className="overflow-hidden rounded-[24px] border border-line bg-surface shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/swap4.jpg"
                alt="People browsing clothing rails at an outdoor neighbourhood swap event"
                width={735}
                height={1102}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover object-[center_45%]"
              />
            </div>
            <div className="mt-8 overflow-hidden rounded-[24px] border border-line bg-surface shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/swap5.jpg"
                alt="A community swap table laid out with shoes and bags under a Sip and Swap sign"
                width={1200}
                height={1600}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover object-[center_60%]"
              />
            </div>
          </div>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
            <Sparkles className="h-3.5 w-3.5 text-primary-soft" aria-hidden />
            Real swap energy, without giving up your Saturday
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
