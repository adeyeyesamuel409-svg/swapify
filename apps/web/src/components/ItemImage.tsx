"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { resolveImageUrl } from "@/lib/api";

type Props = {
  src: string;
  alt: string;
  className?: string;
};

export default function ItemImage({ src, alt, className = "" }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 text-muted ${className}`}
      >
        <ImageOff className="h-8 w-8 opacity-60" aria-hidden />
        <span className="text-xs">Image unavailable</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolveImageUrl(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
