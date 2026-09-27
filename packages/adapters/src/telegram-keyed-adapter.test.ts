import { describe, expect, it } from "vitest";
import {
  createKeyedTelegramAdapter,
  rowIdOfTelegramUserProvider,
  telegramUserProvider,
} from "./telegram-keyed-adapter.js";

const KEY = "telegram-urow123";

function makeAdapter() {
  return createKeyedTelegramAdapter(KEY, {
    botToken: "123456:test-token",
    secretToken: "test-secret",
    mode: "webhook",
  });
}

describe("createKeyedTelegramAdapter", () => {
  it("carries the registration key as its identity", () => {
    expect(makeAdapter().name).toBe(KEY);
  });

  it("encodes thread ids under the key", () => {
    const adapter = makeAdapter();
    expect(adapter.encodeThreadId({ chatId: "555" })).toBe(`${KEY}:555`);
    expect(adapter.encodeThreadId({ chatId: "555", messageThreadId: 7 })).toBe(`${KEY}:555:7`);
    expect(adapter.encodeThreadId({ chatId: "555", businessConnectionId: "biz1" })).toBe(
      `${KEY}:biz:biz1:555`,
    );
  });

  it("decodes its own ids and rejects foreign prefixes", () => {
    const adapter = makeAdapter();
    expect(adapter.decodeThreadId(`${KEY}:555`)).toEqual({ chatId: "555" });
    expect(adapter.decodeThreadId(`${KEY}:555:7`)).toEqual({ chatId: "555", messageThreadId: 7 });
    // Plain telegram ids still pass through the restore path untouched.
    expect(adapter.decodeThreadId("telegram:555")).toEqual({ chatId: "555" });
    expect(() => adapter.decodeThreadId("sendblue:555")).toThrow();
  });

  it("keeps channel ids, openDM, and raw-id resolution on the keyed prefix", async () => {
    const adapter = makeAdapter();
    expect(adapter.channelIdFromThreadId(`${KEY}:555`)).toBe(`${KEY}:555`);
    await expect(adapter.openDM("42")).resolves.toBe(`${KEY}:42`);
    const internals = adapter as unknown as { resolveThreadId(v: string): { chatId: string } };
    expect(internals.resolveThreadId(`${KEY}:555`)).toEqual({ chatId: "555" });
    // Unprefixed ids are treated as bare chat ids, matching upstream behavior.
    expect(internals.resolveThreadId("555")).toEqual({ chatId: "555" });
  });
});

describe("telegramUserProvider", () => {
  it("round-trips a row id through the provider key", () => {
    expect(telegramUserProvider("row-9")).toBe("telegram-urow-9");
    expect(rowIdOfTelegramUserProvider("telegram-urow-9")).toBe("row-9");
    expect(rowIdOfTelegramUserProvider("telegram")).toBeNull();
    expect(rowIdOfTelegramUserProvider("telegram-u")).toBeNull();
  });
});
