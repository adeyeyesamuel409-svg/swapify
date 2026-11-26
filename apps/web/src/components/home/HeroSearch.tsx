"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Search } from "lucide-react";
import { setPendingPhoto } from "@/lib/pending-photo";

/**
 * Hero search: keyword search to /browse plus a camera shortcut that opens the
 * phone camera and drops the photo straight into the listing form.
 */
export default function HeroSearch() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/browse?q=${encodeURIComponent(query)}` : "/browse");
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setPendingPhoto(file);
    router.push("/post?camera=1");
  };

  return (
    <form onSubmit={submit} className="mt-8 w-full max-w-2xl">
      <div className="flex items-center gap-2 rounded-pill border border-line bg-surface p-1.5 shadow-card">
        <Search className="ml-2 h-4.5 w-4.5 shrink-0 text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What are you looking for?"
          aria-label="Search listings"
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted focus:outline-none"
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          capture="environment"
          className="hidden"
          onChange={onPhoto}
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          aria-label="Take a photo to list an item"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-line bg-surface-2 text-primary-soft transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Camera className="h-4.5 w-4.5" aria-hidden />
        </button>
        <button
          type="submit"
          className="h-11 shrink-0 rounded-pill bg-brand px-5 text-sm font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]"
        >
          Explore
        </button>
      </div>
    </form>
  );
}
