export default function ItemDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="aspect-[4/3] animate-pulse rounded-card border border-line bg-surface-2" />
        <div className="space-y-4">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
          <div className="h-28 animate-pulse rounded-card bg-token/10" />
          <div className="h-24 animate-pulse rounded-card bg-surface-2" />
          <div className="h-16 animate-pulse rounded-card bg-surface-2" />
        </div>
      </div>
    </main>
  );
}
