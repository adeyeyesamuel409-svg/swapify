export default function BrowseLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-surface-2" />
      <div className="mt-8 flex animate-pulse gap-3">
        <div className="h-10 flex-1 rounded-btn bg-surface-2" />
        <div className="h-10 w-40 rounded-btn bg-surface-2" />
        <div className="h-10 w-40 rounded-btn bg-surface-2" />
        <div className="h-10 w-36 rounded-btn bg-surface-2" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="aspect-[4/3] animate-pulse bg-surface-2" />
            <div className="space-y-3 p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
