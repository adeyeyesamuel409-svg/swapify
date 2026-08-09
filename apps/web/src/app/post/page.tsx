"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { createItem, uploadImages } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import { CATEGORIES, CONDITIONS, CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import { ImagePlus, Upload, X } from "lucide-react";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function PostItemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "ELECTRONICS",
    condition: "GOOD",
    valueTokens: "10",
    imageUrl: "",
  });
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status === "loading") return <p className="mx-auto mt-20 text-muted">Loading...</p>;

  if (!session?.accessToken) {
    return (
      <main className="mx-auto max-w-xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">Sign in to post an item</h1>
        <p className="mt-2 text-muted">
          <button onClick={() => signIn(undefined, { callbackUrl: window.location.pathname })} className="text-primary-soft hover:underline">
            Sign in
          </button>{" "}
          to list your first item.
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

  const addImageUrl = () => {
    const url = form.imageUrl.trim();
    if (!url) return;
    if (images.length >= MAX_IMAGES) {
      setError(`A listing can have a maximum of ${MAX_IMAGES} images.`);
      return;
    }
    if (url.startsWith("/")) {
      setError("Enter a full image URL, or use the upload button below.");
      return;
    }
    if (!images.includes(url)) setImages([...images, url]);
    setForm((f) => ({ ...f, imageUrl: "" }));
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
        valueTokens: Number(form.valueTokens),
        images,
      });
      router.push(`/items/${item.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post item");
      setSubmitting(false);
    }
  };

  const field =
    "h-10 rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none";
  const label = "mt-5 block text-sm font-medium text-foreground/90";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Post an item</h1>

      <label className={label}>Title</label>
      <input className={`${field} mt-1 w-full`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sony WH-1000XM4 Headphones" />

      <label className={label}>Description</label>
      <textarea className={`${field} mt-1 h-auto py-2 w-full`} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Condition, what's included, why you're swapping it..." />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Category</label>
          <select className={`${field} mt-1 w-full`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Condition</label>
          <select className={`${field} mt-1 w-full`} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </div>
      </div>

      <label className={label}>Value (tokens)</label>
      <input className={`${field} mt-1 w-full`} type="number" min="0" step="0.5" value={form.valueTokens} onChange={(e) => setForm({ ...form, valueTokens: e.target.value })} placeholder="e.g. 80" />

      <label className={label}>Photos</label>
      <div className="mt-1 rounded-card border border-dashed border-line bg-surface-2/50 p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          multiple
          onChange={(e) => pickFiles(e.target.files)}
          className="hidden"
          id="image-files"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {images.length}/{MAX_IMAGES} images &middot; JPEG, PNG, GIF, WebP, AVIF &middot; max 5 MB each
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || images.length >= MAX_IMAGES}
            className="inline-flex items-center gap-1.5 rounded-btn bg-brand px-3 py-2 text-xs font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            {uploading ? <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
            {uploading ? "Uploading..." : "Upload photos"}
          </button>
        </div>

        {images.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {images.map((url, index) => (
              <div key={url} className="group relative aspect-square overflow-hidden rounded-btn border border-line bg-surface">
                <ItemImage src={url} alt={`Uploaded image ${index + 1}`} />
                <button
                  type="button"
                  onClick={() => setImages(images.filter((u) => u !== url))}
                  aria-label={`Remove image ${index + 1}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-bg/80 text-foreground opacity-0 transition-opacity hover:bg-rose-950 hover:text-rose-300 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className={label}>Or add a photo by URL (external hosting)</label>
      <div className="mt-1 flex gap-2">
        <input className={`${field} flex-1`} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://example.com/image.jpg" />
        <button type="button" onClick={addImageUrl} className="rounded-btn bg-surface-3 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-surface-2">Add</button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || uploading}
        className="mt-6 w-full rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
      >
        {submitting ? "Posting..." : "Post item"}
      </button>
    </main>
  );
}
