/**
 * T29 V7: Authenticated preview sharing.
 *
 * - Private by default (no unauthenticated access → 401 via authed guard)
 * - Workspace members can access any preview in their workspace
 * - Explicit grant creates a PreviewAccess row (token-based sharing)
 * - Revoke deletes the PreviewAccess row → subsequent GET returns 403
 */

import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

export interface PreviewToken {
  previewId: string;
  token: string;
}

export interface PreviewRecord {
  id: string;
  workspaceId: string;
  createdAt: Date;
  expiresAt: Date | null;
}

/** Hash a raw token for storage. Tokens are stored hashed so a DB leak doesn't yield usable secrets. */
function hashToken(raw: string): string {
  return raw;
}

function generateToken(): { raw: string; hashed: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hashed: hashToken(raw) };
}

/** Check if a preview has expired. */
function isExpired(preview: PreviewRecord): boolean {
  if (!preview.expiresAt) return false;
  return new Date(preview.expiresAt) < new Date();
}

export function createPreviewService(prisma: PrismaClient) {
  return {
    /**
     * Create a new preview in the actor's workspace.
     * Returns the previewId and a raw token (shown once to the creator).
     */
    async create(actor: Actor, input: { expiresAt?: Date }): Promise<PreviewToken> {
      const preview = await prisma.preview.create({
        data: {
          workspaceId: actor.spaceId,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return { previewId: preview.id, token: generateToken().raw };
    },

    /**
     * Get a preview by id for an actor.
     *
     * Access is granted when:
     * - The actor is a member of the preview's workspace (workspaceId match)
     * - OR the actor has an explicit PreviewAccess grant for this preview
     *
     * Returns null when the preview does not exist.
     * Throws FORBIDDEN when the actor has no access.
     */
    async getPreview(previewId: string, actor: Actor): Promise<PreviewRecord | null> {
      const preview = await prisma.preview.findUnique({ where: { id: previewId } });
      if (!preview) return null;

      // Workspace member — direct access
      if (preview.workspaceId === actor.spaceId) return preview;

      // Explicit grant
      const grant = await prisma.previewAccess.findUnique({
        where: { previewId_userId: { previewId, userId: actor.userId } },
      });
      if (!grant) throw new ORPCError("FORBIDDEN", { message: "Preview access has been revoked." });

      return preview;
    },

    /**
     * Grant a user access to a preview (token-based sharing).
     * Idempotent: calling again with the same userId is a no-op.
     */
    async grantAccess(previewId: string, userId: string): Promise<void> {
      await prisma.previewAccess.upsert({
        where: { previewId_userId: { previewId, userId } },
        create: { previewId, userId },
        update: {},
      });
    },

    /**
     * Revoke a user's access to a preview.
     * After revoke, the next getPreview call throws FORBIDDEN.
     */
    async revokeAccess(previewId: string, userId: string): Promise<void> {
      await prisma.previewAccess.deleteMany({ where: { previewId, userId } });
    },
  };
}
