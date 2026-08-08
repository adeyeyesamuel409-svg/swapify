"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { createItem } from "@/lib/api";
import { CATEGORIES, CONDITIONS, CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";

export default function PostItemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "ELECTRONICS",
    condition: "GOOD",
    valueTokens: "10",
    imageUrl: "",
  });
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (status === "loading") return <p className="mx-auto mt-20 text-muted">Loading...</p>;

  if (!session?.accessToken) {
    return (
      <main className="mx-auto max-w-xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">Sign in to post an item</h1>
        <p className="mt-2 text-muted">
          <button onClick={() => signIn("cognito")} className="text-primary-soft hover:underline">
            Sign in
          </button>{" "}
          to list your first item.
        </p>
      </main>
    );
  }

  const addImage = () => {
    const url = form.imageUrl.trim();
    if (url && !images.includes(url)) setImages([...images, url]);
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

      <label className={label}>Photo URLs (S3 upload comes later)</label>
      <div className="mt-1 flex gap-2">
        <input className={`${field} flex-1`} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
        <button type="button" onClick={addImage} className="rounded-btn bg-surface-3 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-surface-2">Add</button>
      </div>
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((url) => (
            <span key={url} className="flex items-center gap-1 rounded-pill bg-surface-3 px-2 py-1 text-xs text-foreground/80">
              {url.slice(0, 30)}...
              <button type="button" onClick={() => setImages(images.filter((u) => u !== url))} className="text-rose-400">x</button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-6 w-full rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
      >
        {submitting ? "Posting..." : "Post item"}
      </button>
    </main>
  );
}
