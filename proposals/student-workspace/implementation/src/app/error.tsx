"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 p-6 text-center">
      <h1 className="text-2xl font-bold">出了点问题</h1>
      <p className="text-sm text-gray-500">操作未能完成，请稍后重试。</p>
      <button
        onClick={reset}
        className="rounded bg-black px-4 py-2 text-sm text-white"
      >
        重试
      </button>
    </main>
  );
}
