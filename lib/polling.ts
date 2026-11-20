type Timer = ReturnType<typeof setTimeout>;
type Scheduler = {
  set(callback: () => void, delay: number): Timer;
  clear(timer: Timer): void;
};

// Schedule only after completion; cleanup never restarts a stopped poll.
export function startPolling(run: () => Promise<void>, interval: number, scheduler: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay), clear: (timer) => clearTimeout(timer),
}) {
  let stopped = false;
  let failures = 0;
  let timer: Timer;
  const schedule = (delay: number) => { timer = scheduler.set(() => { void tick(); }, delay); };
  async function tick() {
    if (stopped) return;
    try { await run(); failures = 0; }
    catch { failures = Math.min(failures + 1, 3); }
    if (!stopped) schedule(Math.min(interval * 2 ** failures, 120000));
  }
  schedule(interval);
  return () => { stopped = true; scheduler.clear(timer); };
}
