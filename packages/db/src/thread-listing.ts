import { ACTIVE_RUN_STATUSES, plainTextFromMarkdown } from "@rakazo/core";
import type { Prisma } from "./client.js";

/**
 * "The bot's thread" means its primary session, falling back to the earliest:
 * every legacy botId-keyed caller (messaging, routines, DTOs) resolves through
 * this order so multi-session bots behave exactly like the old unique column.
 */
export const PRIMARY_SESSION_ORDER: Prisma.ThreadOrderByWithRelationInput[] = [
  { isPrimary: "desc" },
  { createdAt: "asc" },
];

/**
 * Session list ordering: the primary session stays pinned first, remaining
 * sessions order by most-recent activity, newest first (nulls last, then age).
 */
export const SESSION_LIST_ORDER: Prisma.ThreadOrderByWithRelationInput[] = [
  { isPrimary: "desc" },
  { lastMessageAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];

export const activeRunStatuses = [...ACTIVE_RUN_STATUSES];

export const activeRunSelection = {
  where: { status: { in: activeRunStatuses } },
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: { status: true },
} as const;

export function previewFromBlocks(blocks: unknown): string {
  const rows = Array.isArray(blocks) ? blocks : [];
  for (const block of rows) {
    if (
      block &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return plainTextFromMarkdown((block as { text: string }).text);
    }
  }
  return "";
}
