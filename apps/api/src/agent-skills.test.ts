import type { Actor } from "@rakazo/contracts";
import { buildSkillMd } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createAgentSkillsService } from "./agent-skills.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
};

function savedSkill(name: string, source = "user") {
  return {
    id: "saved-1",
    spaceId: actor.spaceId,
    userId: actor.userId,
    name,
    description: "Saved review recipe",
    content: buildSkillMd({ name, description: "Saved review recipe", body: "Saved steps" }),
    source,
    category: null,
    enabled: true,
    storeKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function setup(rows: ReturnType<typeof savedSkill>[] = []) {
  type Where = { id?: string; spaceId: string; userId: string; source?: string };
  const matches = (row: ReturnType<typeof savedSkill>, where: Where) =>
    Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value);
  const agentSkill = {
    findMany: vi.fn(async ({ where }: { where: Where }) =>
      rows.filter((row) => matches(row, where)),
    ),
    findFirst: vi.fn(async ({ where }: { where: Where }) =>
      rows.find((row) => matches(row, where)),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: object }) => {
      const row = rows.find((row) => matches(row, where));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const index = rows.findIndex((row) => matches(row, where));
      if (index < 0) return { count: 0 };
      rows.splice(index, 1);
      return { count: 1 };
    }),
  };
  return {
    agentSkill,
    service: createAgentSkillsService({ agentSkill } as unknown as PrismaClient),
  };
}

describe("built-in skill precedence in the API", () => {
  it.each(["interrogate", " Interrogate "])(
    "keeps %j listed, readable and mutable",
    async (name) => {
      const { service } = setup([savedSkill(name)]);
      await expect(service.list(actor)).resolves.toEqual([
        expect.objectContaining({ id: "saved-1", name, readOnly: false }),
      ]);
      await expect(service.listWithContent(actor)).resolves.toEqual([
        expect.objectContaining({ id: "saved-1", content: expect.stringContaining("Saved steps") }),
      ]);
      await expect(service.get(actor, { name: " INTERROGATE " })).resolves.toMatchObject({
        id: "saved-1",
        source: "user",
      });
      await expect(service.get(actor, { skillId: "saved-1" })).resolves.toMatchObject({ name });
      await expect(
        service.update(actor, { skillId: "saved-1", description: "Updated recipe" }),
      ).resolves.toMatchObject({ name: name.trim(), description: "Updated recipe" });
      await expect(service.remove(actor, "saved-1")).resolves.toEqual({ ok: true });
      await expect(service.get(actor, { name: "Interrogate" })).resolves.toMatchObject({
        id: "builtin:Interrogate",
        readOnly: true,
      });
    },
  );

  it("preserves plugin precedence and read-only enforcement", async () => {
    const { service, agentSkill } = setup([savedSkill(" Interrogate ", "plugin")]);
    await expect(service.get(actor, { name: "interrogate" })).resolves.toMatchObject({
      id: "saved-1",
      source: "plugin",
      readOnly: true,
    });
    await expect(service.update(actor, { skillId: "saved-1", body: "Changed" })).rejects.toThrow(
      "read-only",
    );
    await expect(service.remove(actor, "saved-1")).rejects.toThrow("read-only");
    expect(agentSkill.updateMany).not.toHaveBeenCalled();
    expect(agentSkill.deleteMany).not.toHaveBeenCalled();
  });

  it.each([{ spaceId: "other-space" }, { userId: "other-user" }])(
    "does not let foreign skills shadow the builtin: %j",
    async (foreignOwner) => {
      const { service } = setup([{ ...savedSkill(" Interrogate "), ...foreignOwner }]);
      await expect(service.get(actor, { name: "interrogate" })).resolves.toMatchObject({
        id: "builtin:Interrogate",
        readOnly: true,
      });
      await expect(service.list(actor)).resolves.toEqual([
        expect.objectContaining({ id: "builtin:Interrogate" }),
      ]);
      await expect(service.get(actor, { skillId: "saved-1" })).rejects.toThrow();
    },
  );
});

describe("skill store (install / uninstall / enable)", () => {
  const storeRow = () => ({
    ...savedSkill("Memory", "builtin"),
    id: "store-1",
    description: "Infinite organized memory",
    category: "Productivity",
    enabled: true,
    storeKey: "memory",
  });

  function storeSetup(rows: object[] = [], created: object[] = []) {
    const agentSkill = {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) =>
          Object.entries(where).every(([key, value]) => {
            if (
              typeof value === "object" &&
              value !== null &&
              "not" in (value as Record<string, unknown>)
            ) {
              return row[key as keyof typeof row] != null;
            }
            return row[key as keyof typeof row] === value;
          }),
        ),
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) =>
          Object.entries(where).every(([key, value]) => {
            if (
              typeof value === "object" &&
              value !== null &&
              "equals" in (value as Record<string, unknown>)
            ) {
              const needle = String((value as { equals: unknown }).equals).toLowerCase();
              return String(row[key as keyof typeof row]).toLowerCase() === needle;
            }
            return row[key as keyof typeof row] === value;
          }),
        ),
      ),
      create: vi.fn(async ({ data }: { data: object }) => {
        const row = {
          id: "created-1",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          ...data,
        };
        created.push(row);
        rows.push(row);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
          const row = rows.find((row) =>
            Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value),
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const index = rows.findIndex((row) =>
          Object.entries(where).every(([key, value]) => {
            if (
              typeof value === "object" &&
              value !== null &&
              "not" in (value as Record<string, unknown>)
            ) {
              return row[key as keyof typeof row] != null;
            }
            return row[key as keyof typeof row] === value;
          }),
        );
        if (index < 0) return { count: 0 };
        rows.splice(index, 1);
        return { count: 1 };
      }),
    };
    return {
      agentSkill,
      created,
      service: createAgentSkillsService({ agentSkill } as unknown as PrismaClient),
    };
  }

  it("lists store entries with installed flags", async () => {
    const { service } = storeSetup([storeRow()]);
    const catalog = await service.catalog(actor);
    expect(catalog.find((entry) => entry.key === "memory")).toMatchObject({
      key: "memory",
      installed: true,
      category: "Productivity",
    });
    expect(catalog.find((entry) => entry.key === "pdf")).toMatchObject({ installed: false });
  });

  it("installs a store skill as a read-only builtin row", async () => {
    const { service, created } = storeSetup([]);
    const skill = await service.install(actor, { key: "memory" });
    expect(created[0]).toMatchObject({ source: "builtin", storeKey: "memory", enabled: true });
    expect(skill).toMatchObject({
      id: "created-1",
      name: "memory",
      readOnly: true,
      storeKey: "memory",
    });
    await expect(service.install(actor, { key: "nope" })).rejects.toThrow("Unknown skill");
  });

  it("refuses to install over an existing skill name", async () => {
    const { service } = storeSetup([savedSkill("Memory")]);
    await expect(service.install(actor, { key: "memory" })).rejects.toThrow("already exists");
  });

  it("uninstalls store rows only", async () => {
    const { service, agentSkill } = storeSetup([storeRow(), savedSkill("Handwritten")]);
    await expect(service.uninstall(actor, "saved-1")).rejects.toThrow("Only store skills");
    await expect(service.uninstall(actor, "store-1")).resolves.toEqual({ ok: true });
    expect(agentSkill.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("disabling hides the skill from the run feed but keeps it listed", async () => {
    const disabled = { ...storeRow(), enabled: false };
    const { service } = storeSetup([disabled]);
    await expect(service.list(actor)).resolves.toEqual([
      expect.objectContaining({ id: "builtin:Interrogate" }),
      expect.objectContaining({ id: "store-1", enabled: false }),
    ]);
    await expect(service.listWithContent(actor)).resolves.toEqual([
      expect.objectContaining({ id: "builtin:Interrogate" }),
    ]);
    const restored = await service.setEnabled(actor, { skillId: "store-1", enabled: true });
    expect(restored).toMatchObject({ enabled: true });
    await expect(service.listWithContent(actor)).resolves.toEqual([
      expect.objectContaining({ id: "builtin:Interrogate" }),
      expect.objectContaining({ id: "store-1" }),
    ]);
  });
});
