export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { tryFileCleanup } = await import("./lib/file-cleanup");
  const state = globalThis as typeof globalThis & { fileCleanupTimer?: ReturnType<typeof setInterval> };
  const reminderState = globalThis as typeof globalThis & { deadlineReminderTimer?: ReturnType<typeof setInterval> };
  if (!reminderState.deadlineReminderTimer) {
    const { tryDeadlineReminders } = await import("./lib/deadline-reminders");
    let reminding = false;
    const remind = async () => {
      if (reminding) return;
      reminding = true;
      try { await tryDeadlineReminders(); } finally { reminding = false; }
    };
    reminderState.deadlineReminderTimer = setInterval(remind, 60000);
    reminderState.deadlineReminderTimer.unref();
    void remind();
  }
  if (state.fileCleanupTimer) return;
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await tryFileCleanup(); } finally { busy = false; } };
  state.fileCleanupTimer = setInterval(run, 60000);
  state.fileCleanupTimer.unref();
  void run();
}
