/**
 * Pins the scrollback eviction contract for PtySessionRecord: the buffer keeps
 * the newest `scrollbackCapacity` lines in order, oldest first, regardless of
 * how many lines are appended. The reconnect path replays exactly that window.
 */

import { describe, expect, it } from "vitest";
import {
  createPtySessionRecord,
  recordScrollbackLine,
  scrollbackWindow,
} from "./process-sandbox.js";

describe("scrollback eviction", () => {
  it("keeps the newest capacity lines in order past capacity", () => {
    const record = createPtySessionRecord("task-1");
    record.scrollbackCapacity = 5;
    for (let i = 0; i < 12; i += 1) {
      recordScrollbackLine(record, `line-${i}`);
    }
    expect(scrollbackWindow(record)).toEqual(["line-7", "line-8", "line-9", "line-10", "line-11"]);
  });

  it("never exceeds capacity plus a bounded compaction margin at high volume", () => {
    const record = createPtySessionRecord("task-1");
    record.scrollbackCapacity = 100;
    for (let i = 0; i < 50_000; i += 1) {
      recordScrollbackLine(record, `line-${i}`);
    }
    // The physical array may hold at most capacity + one compaction chunk of
    // slack; the visible contract is the newest capacity lines in order.
    expect(record.scrollback.length).toBeLessThanOrEqual(record.scrollbackCapacity + 1_000);
    expect(record.scrollback.length).toBeGreaterThanOrEqual(record.scrollbackCapacity);
    expect(scrollbackWindow(record)).toEqual(
      Array.from({ length: 100 }, (_, k) => `line-${49_900 + k}`),
    );
  });

  it("does not evict before capacity is reached", () => {
    const record = createPtySessionRecord("task-1");
    record.scrollbackCapacity = 3;
    for (const line of ["a", "b"]) {
      recordScrollbackLine(record, line);
    }
    expect(scrollbackWindow(record)).toEqual(["a", "b"]);
  });
});
