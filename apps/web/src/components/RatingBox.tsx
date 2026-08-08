"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSwapRatings, rateSwap, type ApiRating } from "@/lib/api";

type Props = {
  swapId: string;
  accessToken: string;
  myUserId: string;
  otherPartyName: string;
};

export default function RatingBox({ swapId, accessToken, myUserId, otherPartyName }: Props) {
  const router = useRouter();
  const [ratings, setRatings] = useState<ApiRating[]>([]);
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSwapRatings(accessToken, swapId)
      .then(({ ratings }) => setRatings(ratings))
      .catch(() => setError("Could not load ratings"));
  }, [accessToken, swapId]);

  const myRating = ratings.find((r) => r.raterId === myUserId);
  const otherRating = ratings.find((r) => r.raterId !== myUserId);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const { rating } = await rateSwap(accessToken, swapId, { score, comment: comment.trim() || undefined });
      setRatings((rs) => [...rs.filter((r) => r.raterId !== myUserId), rating]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit rating");
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <div className="mt-6 rounded-card border border-line bg-surface p-5">
      <p className="text-sm font-semibold text-foreground">Ratings</p>

      {otherRating && (
        <div className="mt-3 rounded-btn bg-surface-2 p-3 text-sm">
          <p className="text-muted">
            <span className="font-semibold text-foreground">{otherRating.rater.name}</span> rated you{" "}
            {"★".repeat(otherRating.score)}
            <span className="text-line-strong">{"★".repeat(5 - otherRating.score)}</span>
          </p>
          {otherRating.comment && <p className="mt-1 text-muted">&ldquo;{otherRating.comment}&rdquo;</p>}
        </div>
      )}

      {myRating ? (
        <div className="mt-3 rounded-btn bg-surface-2 p-3 text-sm">
          <p className="text-muted">
            You rated <span className="font-semibold text-foreground">{otherPartyName}</span>{" "}
            {"★".repeat(myRating.score)}
            <span className="text-line-strong">{"★".repeat(5 - myRating.score)}</span>
          </p>
          {myRating.comment && <p className="mt-1 text-muted">&ldquo;{myRating.comment}&rdquo;</p>}
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScore(s)}
                className={`text-2xl transition-colors ${s <= score ? "text-token" : "text-line-strong"}`}
                aria-label={`Rate ${s} star${s === 1 ? "" : "s"}`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="How was the swap?"
            rows={2}
            className="mt-3 w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="mt-2 rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Submit rating"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
