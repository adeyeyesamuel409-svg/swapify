import { ImageOff } from "lucide-react";

export default function PlaceholderImage({ label = "No photo yet" }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
      <ImageOff className="h-8 w-8 opacity-60" aria-hidden />
      <span className="text-xs">{label}</span>
    </div>
  );
}
