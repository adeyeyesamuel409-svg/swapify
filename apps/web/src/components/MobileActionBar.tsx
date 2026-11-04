import type { ReactNode } from "react";

/**
 * Fixed bottom action bar for mobile screens (sm and below). Carries the
 * primary/secondary actions for the current screen; hidden on larger viewports
 * where the inline action blocks render instead. Respects the iOS home
 * indicator via safe-area padding.
 */
export default function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-raise backdrop-blur sm:hidden">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2">{children}</div>
    </div>
  );
}
