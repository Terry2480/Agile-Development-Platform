// A canceled request may still resolve: identity checks are required as well as abort.
export class RequestGate {
  private requests = new Map<string, AbortController>();

  begin(key: string) {
    this.requests.get(key)?.abort();
    const controller = new AbortController();
    this.requests.set(key, controller);
    return {
      signal: controller.signal,
      current: () => this.requests.get(key) === controller && !controller.signal.aborted,
    };
  }

  cancel(keys?: string[]) {
    for (const key of keys ?? [...this.requests.keys()]) {
      this.requests.get(key)?.abort();
      this.requests.delete(key);
    }
  }
}
