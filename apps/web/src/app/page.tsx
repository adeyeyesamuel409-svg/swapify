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
      <AuthControls />
    </main>
  );
}
