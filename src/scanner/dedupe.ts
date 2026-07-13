/**
 * Suppresses repeat results while a code stays in front of the camera: a
 * payload re-fires only after it has been out of sight for the whole window
 * (each sighting refreshes its timer). Payloads are tracked independently,
 * so several codes visible at once (multiple mode) each dedupe on their own
 * clock and cannot displace each other into re-firing.
 */
export class Deduper {
  private readonly seen = new Map<string, number>();

  constructor(private windowMs: number) {}

  setWindow(windowMs: number): void {
    this.windowMs = windowMs;
  }

  shouldEmit(text: string, now: number): boolean {
    if (this.windowMs <= 0) return true;
    const lastSeenAt = this.seen.get(text);
    // Delete + set keeps the map insertion-ordered by recency, so pruning
    // can stop at the first still-fresh entry.
    this.seen.delete(text);
    this.seen.set(text, now);
    this.prune(now);
    return lastSeenAt === undefined || now - lastSeenAt >= this.windowMs;
  }

  private prune(now: number): void {
    for (const [text, seenAt] of this.seen) {
      if (now - seenAt < this.windowMs) break;
      this.seen.delete(text);
    }
  }

  reset(): void {
    this.seen.clear();
  }
}
