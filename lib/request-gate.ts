// A canceled request may still resolve: identity checks are required as well as abort.
export class RequestGate {
  private requests = new Map<string, AbortController>();
  private pending = new Set<AbortController>();

  isPending(key: string) {
    const controller = this.requests.get(key);
    return !!controller && this.pending.has(controller) && !controller.signal.aborted;
  }

  begin(key: string) {
    const previous = this.requests.get(key);
    if (previous) { previous.abort(); this.pending.delete(previous); }
    const controller = new AbortController();
    this.requests.set(key, controller);
    this.pending.add(controller);
    return {
      signal: controller.signal,
      current: () => this.requests.get(key) === controller && !controller.signal.aborted,
      finish: () => { this.pending.delete(controller); },
    };
  }

  cancel(keys?: string[]) {
    for (const key of keys ?? [...this.requests.keys()]) {
      const controller = this.requests.get(key);
      if (controller) { controller.abort(); this.pending.delete(controller); }
      this.requests.delete(key);
    }
  }
}
