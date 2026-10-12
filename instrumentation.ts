export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { tryFileCleanup } = await import("./lib/file-cleanup");
  const state = globalThis as typeof globalThis & { fileCleanupTimer?: ReturnType<typeof setInterval> };
  if (state.fileCleanupTimer) return;
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await tryFileCleanup(); } finally { busy = false; } };
  state.fileCleanupTimer = setInterval(run, 60000);
  state.fileCleanupTimer.unref();
  void run();
}
