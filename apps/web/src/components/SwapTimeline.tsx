import { Check, X } from "lucide-react";
import type { ApiSwap } from "@/lib/api";

type Props = {
  swap: ApiSwap;
  myUserId: string;
};

type Step = {
  key: string;
  label: string;
  hint: string;
};

const TERMINAL = new Set(["CANCELLED", "EXPIRED"]);

export default function SwapTimeline({ swap, myUserId }: Props) {
  const gap = Number(BigInt(swap.gapMicroTokens));
  const hasEscrowStep = gap > 0;

  const steps: Step[] = [
    { key: "REQUESTED", label: "Requested", hint: "Swap request sent" },
    { key: "AGREED", label: "Agreed", hint: "Owner accepted" },
    ...(hasEscrowStep
      ? [{ key: "ESCROWED", label: "Tokens held", hint: "Gap secured in escrow" }]
      : []),
    { key: "COMPLETED", label: "Completed", hint: "Both items received" },
  ];

  const statusIndex: Record<string, number> = { REQUESTED: 0, AGREED: 1, ESCROWED: 2, COMPLETED: 3 };
  const currentIndex = statusIndex[swap.status] ?? 0;
  const isTerminal = TERMINAL.has(swap.status);
  const isDone = swap.status === "COMPLETED";

  const iConfirmed = (swap.offeringUserId === myUserId ? swap.offeringUserConfirmedAt : swap.requestedUserConfirmedAt) != null;
  const theyConfirmed = (swap.offeringUserId === myUserId ? swap.requestedUserConfirmedAt : swap.offeringUserConfirmedAt) != null;

  function Circle({ index }: { index: number }) {
    if (isTerminal) {
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rose-500/50 bg-rose-950 text-rose-300">
          <X className="h-3.5 w-3.5" aria-hidden />
        </span>
      );
    }

    if (index < currentIndex) {
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-3.5 w-3.5" aria-hidden />
        </span>
      );
    }
    if (index === currentIndex) {
      if (isDone && index === steps.length - 1) {
        return (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        );
      }
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/20 text-primary-soft">
          <span className="h-2 w-2 rounded-full bg-primary" />
        </span>
      );
    }
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-muted">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
      </span>
    );
  }

  function Connector({ index }: { index: number }) {
    const reached = index + 1 <= currentIndex;
    return <span aria-hidden className={`mx-2 hidden h-0.5 flex-1 self-center rounded sm:block ${reached ? "bg-emerald-500/70" : "bg-line"}`} />;
  }

  function VerticalConnector({ index }: { index: number }) {
    const reached = index + 1 <= currentIndex;
    return <span aria-hidden className={`my-1 w-0.5 self-stretch rounded sm:hidden ${reached ? "bg-emerald-500/70" : "bg-line"}`} />;
  }

  return (
    <div className="rounded-card border border-line bg-surface-2/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Progress</p>

      {isTerminal ? (
        <p className="mt-2 text-sm font-semibold text-rose-300">
          This swap was {swap.status.toLowerCase()}. Both items are back up for swap.
        </p>
      ) : (
        <>
          {/* Horizontal stepper (>=sm) */}
          <ol className="mt-4 hidden sm:flex">
            {steps.map((step, i) => (
              <li key={step.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center text-center">
                  <Circle index={i} />
                  <p className="mt-1.5 text-xs font-semibold text-foreground">{step.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{step.hint}</p>
                </div>
                {i < steps.length - 1 && <Connector index={i} />}
              </li>
            ))}
          </ol>

          {/* Vertical stepper (<sm) */}
          <ol className="mt-3 flex flex-col sm:hidden">
            {steps.map((step, i) => (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Circle index={i} />
                  {i < steps.length - 1 && <VerticalConnector index={i} />}
                </div>
                <div className="pb-4">
                  <p className="text-xs font-semibold text-foreground">{step.label}</p>
                  <p className="text-[10px] text-muted">{step.hint}</p>
                </div>
              </li>
            ))}
          </ol>

          {swap.status !== "COMPLETED" && swap.status !== "CANCELLED" && (
            <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
              {iConfirmed && theyConfirmed ? (
                "Both parties confirmed — finalizing."
              ) : iConfirmed ? (
                "You confirmed receiving your item. Waiting for the other party."
              ) : (
                "Awaiting receipt confirmations."
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
