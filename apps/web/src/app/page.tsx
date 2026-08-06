import AuthControls from "@/components/AuthControls";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-white">Swapify</h1>
        <p className="mt-4 max-w-xl text-lg text-gray-300">
          Swap what you no longer use for what you need. When values don&apos;t
          match, our tokens balance the difference.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <a
          href="/browse"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Browse listings
        </a>
        <a
          href="/post"
          className="rounded-md border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
        >
          Post an item
        </a>
      </div>
      <AuthControls />
    </main>
  );
}
