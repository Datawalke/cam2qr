import { describe, expect, it } from 'vitest';
import { Deduper } from '../../src/scanner/dedupe.js';

describe('Deduper', () => {
  it('fires the first sighting and suppresses repeats inside the window', () => {
    const deduper = new Deduper(1500);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    expect(deduper.shouldEmit('a', 100)).toBe(false);
    expect(deduper.shouldEmit('a', 1400)).toBe(false);
  });

  it('keeps suppressing while the code stays in view (rolling window)', () => {
    const deduper = new Deduper(1000);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    // Seen every 500ms — each sighting refreshes the timer.
    expect(deduper.shouldEmit('a', 500)).toBe(false);
    expect(deduper.shouldEmit('a', 1000)).toBe(false);
    expect(deduper.shouldEmit('a', 1500)).toBe(false);
    // Out of sight for a full window → fires again.
    expect(deduper.shouldEmit('a', 2600)).toBe(true);
  });

  it('fires immediately for a different payload', () => {
    const deduper = new Deduper(1500);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    expect(deduper.shouldEmit('b', 10)).toBe(true);
  });

  it('tracks payloads independently — alternating codes do not re-fire', () => {
    // Two codes visible at once (multiple mode) alternate per frame; each
    // must dedupe on its own clock instead of displacing the other.
    const deduper = new Deduper(1500);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    expect(deduper.shouldEmit('b', 10)).toBe(true);
    expect(deduper.shouldEmit('a', 20)).toBe(false);
    expect(deduper.shouldEmit('b', 30)).toBe(false);
    // 'a' out of sight for a full window re-fires; 'b' kept fresh does not.
    expect(deduper.shouldEmit('b', 1400)).toBe(false);
    expect(deduper.shouldEmit('a', 1600)).toBe(true);
    expect(deduper.shouldEmit('b', 1700)).toBe(false);
  });

  it('prunes stale payloads so re-sighting after the window fires again', () => {
    const deduper = new Deduper(100);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    expect(deduper.shouldEmit('b', 10)).toBe(true);
    expect(deduper.shouldEmit('a', 500)).toBe(true);
    expect(deduper.shouldEmit('b', 510)).toBe(true);
  });

  it('window 0 disables deduplication', () => {
    const deduper = new Deduper(0);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    expect(deduper.shouldEmit('a', 1)).toBe(true);
  });

  it('reset() forgets the last payload', () => {
    const deduper = new Deduper(1500);
    expect(deduper.shouldEmit('a', 0)).toBe(true);
    deduper.reset();
    expect(deduper.shouldEmit('a', 1)).toBe(true);
  });
});
