"use client";

import { useState } from "react";
import ItemImage from "@/components/ItemImage";

type Props = {
  images: { id: string; url: string }[];
  alt: string;
};

export default function ItemGallery({ images, alt }: Props) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex h-80 w-full items-center justify-center rounded-card border border-line bg-surface-2 text-muted">
        No photo
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-line bg-surface-2">
        <ItemImage src={images[active].url} alt={alt} />
      </div>
      {images.length > 1 && (
        <div className="mt-3 grid grid-cols-4 gap-3">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === active}
              className={`relative aspect-[4/3] overflow-hidden rounded-btn border bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                i === active ? "border-primary" : "border-line hover:border-primary/50"
              }`}
            >
              <ItemImage src={img.url} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
