// Lock synchronously, before React renders disabled buttons.
export class TaskAction {
  private busy = false;
  async run(write: () => Promise<void>, refresh: () => Promise<void>): Promise<"busy" | "saved" | "refresh-failed"> {
    if (this.busy) return "busy";
    this.busy = true;
    try {
      await write();
      try { await refresh(); return "saved"; }
      catch { return "refresh-failed"; }
    } finally { this.busy = false; }
  }
}
