export async function registerNodeInstrumentation() {
  const documentState=globalThis as typeof globalThis & {documentMaintenanceTimer?:ReturnType<typeof setInterval>};
  if(!documentState.documentMaintenanceTimer){
    const {tryDocumentMaintenance}=await import("./lib/documents/maintenance");
    let maintaining=false;
    const run=async()=>{if(maintaining)return;maintaining=true;try{await tryDocumentMaintenance();}finally{maintaining=false;}};
    documentState.documentMaintenanceTimer=setInterval(run,60000);documentState.documentMaintenanceTimer.unref();void run();
  }
  const exportState=globalThis as typeof globalThis & {documentExportTimer?:ReturnType<typeof setInterval>};
  if(!exportState.documentExportTimer){const {tryDocumentExports}=await import("./lib/documents/export-worker");let exporting=false;const run=async()=>{if(exporting)return;exporting=true;try{await tryDocumentExports();}finally{exporting=false;}};exportState.documentExportTimer=setInterval(run,5000);exportState.documentExportTimer.unref();void run();}
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
