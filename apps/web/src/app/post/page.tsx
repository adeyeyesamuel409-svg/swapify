"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { createItem, formatPence, uploadImages } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import MobileActionBar from "@/components/MobileActionBar";
import { CATEGORIES, CONDITIONS, CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImagePlus,
  Inbox,
  ShieldCheck,
  Tag,
  Upload,
  X,
} from "lucide-react";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function PostItemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIndex = useRef<number | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "ELECTRONICS",
    condition: "GOOD",
    valuePounds: "10",
    imageUrl: "",
  });
  const [openTo, setOpenTo] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status === "loading") return <p className="mx-auto mt-20 text-muted">Loading...</p>;

  if (!session?.accessToken) {
    return (
      <main className="mx-auto max-w-xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-navy">Sign in to post an item</h1>
        <p className="mt-2 text-muted">
          <button onClick={() => signIn(undefined, { callbackUrl: window.location.pathname })} className="text-primary-soft hover:underline">
            Sign in
          </button>{" "}
          to list your first item.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
          Secure &amp; encrypted. Your details are never shared
        </p>
      </main>
    );
  }

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const accepted = Array.from(files);
      const total = images.length + accepted.length;
      if (total > MAX_IMAGES) {
        setError(`A listing can have a maximum of ${MAX_IMAGES} images.`);
        return;
      }
      for (const file of accepted) {
        if (!file.type.startsWith("image/")) {
          setError(`"${file.name}" is not an image file.`);
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`"${file.name}" exceeds the 5 MB size limit.`);
          return;
        }
      }
      const uploaded = await uploadImages(session.accessToken!, accepted);
      setImages((imgs) => [...imgs, ...uploaded.map((f) => f.url)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload images");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const moveImage = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setImages(next);
  };

  const addImageUrl = () => {
    const url = form.imageUrl.trim();
    if (!url) return;
    if (images.length >= MAX_IMAGES) {
      setError(`A listing can have a maximum of ${MAX_IMAGES} images.`);
      return;
    }
    if (url.startsWith("/")) {
      setError("Enter a full image URL, or use the uploader.");
      return;
    }
    if (!images.includes(url)) setImages([...images, url]);
    setForm((f) => ({ ...f, imageUrl: "" }));
  };

  const toggleOpenTo = (value: string) => {
    setOpenTo((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const submit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const { item } = await createItem(session.accessToken!, {
        title: form.title,
        description: form.description,
        category: form.category,
        condition: form.condition,
        valuePence: Math.round(Number(form.valuePounds) * 100),
        images,
      });
      router.push(`/items/${item.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post item");
      setSubmitting(false);
    }
  };

  const field =
    "h-11 rounded-btn border border-line bg-surface px-3.5 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none";
  const label = "mt-5 block text-sm font-semibold text-navy";
  const valuePence = Math.round(Number(form.valuePounds || 0) * 100);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-10 sm:px-6 lg:pb-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">List an item</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy">Post an item</h1>
        <p className="mt-2 max-w-xl text-muted">
          Great photos and a fair value get items swapped fast. You can edit everything later.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
        {/* ---------------- form column ---------------- */}
        <div>
          {/* drag & drop uploader */}
          <label className={label}>Photos</label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              pickFiles(e.dataTransfer.files);
            }}
            className={`mt-1 rounded-card border-2 border-dashed p-6 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-line bg-surface-2/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
              multiple
              onChange={(e) => pickFiles(e.target.files)}
              className="hidden"
              id="image-files"
            />
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
                <Inbox className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-navy">
                Drag &amp; drop photos here
              </p>
              <p className="text-xs text-muted">
                {images.length}/{MAX_IMAGES} images &middot; JPEG, PNG, GIF, WebP, AVIF &middot; max 5 MB each
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || images.length >= MAX_IMAGES}
                className="mt-1 inline-flex items-center gap-1.5 rounded-btn bg-brand px-4 py-2 text-xs font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {uploading ? <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
                {uploading ? "Uploading..." : "Browse files"}
              </button>
            </div>
          </div>

          {/* thumbnails with re-ordering */}
          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
              {images.map((url, index) => (
                <div
                  key={url}
                  draggable
                  onDragStart={() => (dragIndex.current = index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null) moveImage(dragIndex.current, index);
                    dragIndex.current = null;
                  }}
                  className="group relative aspect-square overflow-hidden rounded-btn border border-line bg-surface"
                >
                  <ItemImage src={url} alt={`Uploaded image ${index + 1}`} />
                  {index === 0 && (
                    <span className="absolute bottom-1 left-1 rounded-pill bg-black/80 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      Cover
                    </span>
                  )}
                  <GripVertical className="absolute left-1 top-1 h-3.5 w-3.5 text-white/80 opacity-0 drop-shadow group-hover:opacity-100" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setImages(images.filter((u) => u !== url))}
                    aria-label={`Remove image ${index + 1}`}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition-opacity after:absolute after:-inset-2 after:content-[''] hover:bg-danger opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 pb-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => moveImage(index, index - 1)}
                      disabled={index === 0}
                      aria-label="Move image left"
                      className="relative flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white after:absolute after:-inset-2 after:content-[''] disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, index + 1)}
                      disabled={index === images.length - 1}
                      aria-label="Move image right"
                      className="relative flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white after:absolute after:-inset-2 after:content-[''] disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* URL fallback */}
          <label className={label}>Or add a photo by URL (external hosting)</label>
          <div className="mt-1 flex gap-2">
            <input className={`${field} flex-1`} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://example.com/image.jpg" />
            <button type="button" onClick={addImageUrl} className="min-h-[44px] rounded-btn border border-line bg-surface-2 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/60">
              Add
            </button>
          </div>

          {/* title + description */}
          <label className={label}>Title</label>
          <input className={`${field} mt-1 w-full`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sony WH-1000XM4 Headphones" />

          <label className={label}>Description</label>
          <textarea className={`${field} mt-1 h-auto w-full py-2.5`} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Condition, what's included, why you're swapping it..." />

          {/* condition chips */}
          <label className={label}>Condition</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {CONDITIONS.map((c) => {
              const active = form.condition === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, condition: c })}
                  aria-pressed={active}
                  className={`inline-flex min-h-[44px] items-center gap-1 rounded-pill border px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "border-primary bg-primary text-white shadow-glow"
                      : "border-line bg-surface text-muted hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {active && <Check className="h-3 w-3" aria-hidden />}
                  {CONDITION_LABELS[c]}
                </button>
              );
            })}
          </div>

          {/* category + value */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Category</label>
              <select className={`${field} mt-1 w-full`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Estimated fair value</label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">£</span>
                <input
                  className={`${field} w-full pl-8`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valuePounds}
                  onChange={(e) => setForm({ ...form, valuePounds: e.target.value })}
                  placeholder="80.00"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Set a fair cash value, like {formatPence(valuePence)}. If swap values don&apos;t match,
                the difference settles as a secure cash top-up.
              </p>
            </div>
          </div>

          {/* open-to-swaps preference (design preview; persisted when the API supports it) */}
          <label className={label}>Open to swaps in categories</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const active = openTo.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleOpenTo(c)}
                  aria-pressed={active}
                  className={`inline-flex min-h-[44px] items-center gap-1 rounded-pill border px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "border-token/50 bg-token/15 text-token"
                      : "border-line bg-surface text-muted hover:border-token/50 hover:text-foreground"
                  }`}
                >
                  {active ? <Check className="h-3 w-3" aria-hidden /> : <Tag className="h-3 w-3" aria-hidden />}
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Pick the categories you&apos;d happily receive. Shown on your listing as swap preferences.
          </p>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || uploading}
            className="mt-6 hidden w-full rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:scale-[1.01] hover:brightness-110 active:scale-[0.99] disabled:opacity-50 sm:block"
          >
            {submitting ? "Posting..." : "Post item"}
          </button>
        </div>

        {/* ---------------- live preview column ---------------- */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-soft">Live preview</p>
          <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div className="relative aspect-[4/3] bg-surface-2">
              {images[0] ? (
                <ItemImage src={images[0]} alt="Listing preview" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
                  <ImagePlus className="h-6 w-6 opacity-50" aria-hidden />
                  <span className="text-xs">Your first photo shows here</span>
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-pill border border-primary/30 bg-bg/85 px-2.5 py-0.5 text-[11px] font-semibold text-primary-soft backdrop-blur">
                Open to Trades
              </span>
              <span className="absolute bottom-3 left-3 rounded-pill border border-token/40 bg-bg/85 px-2.5 py-1 text-xs font-bold text-token backdrop-blur">
                {formatPence(valuePence)}
              </span>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <h3 className="line-clamp-1 font-semibold text-navy">{form.title || "Untitled listing"}</h3>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{CONDITION_LABELS[form.condition as keyof typeof CONDITION_LABELS] ?? form.condition}</span>
                <span className="text-muted/70">Just now</span>
              </div>
              {openTo.length > 0 && (
                <p className="text-[11px] text-muted">
                  Open to: <span className="font-semibold text-token">{openTo.map((c) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS]).join(", ")}</span>
                </p>
              )}
              <div className="mt-1 border-t border-line pt-3">
                <span className="inline-flex items-center gap-1 rounded-pill border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary-soft">
                  Propose Swap
                </span>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Tip: listings with 3+ photos and honest condition notes swap up to 2x faster.
          </p>
        </aside>
      </div>

      {/* sticky mobile action bar */}
      <MobileActionBar>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || uploading}
          className="min-h-[44px] w-full rounded-btn bg-brand px-4 py-2.5 font-semibold text-white shadow-glow transition-all active:scale-[0.99] disabled:opacity-50"
        >
          {submitting ? "Posting..." : "Post item"}
        </button>
      </MobileActionBar>
    </main>
  );
}
