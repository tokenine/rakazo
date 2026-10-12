// QA probe: does the unscoped botId-only findUniqueOrThrow (the exact shape
// left at packages/testkit/src/authorization.test.ts:276) still run against
// the migrated (multi-session) schema? Uses the product's own createDb.
// Throwaway — never part of product code.
import { createDb } from "/Users/poom-work/.super-speckit-worktrees/ss/qa/001-run1/packages/db/src/client.ts";

const { prisma, pool } = createDb("postgresql://postgres:check_pw@localhost:54329/postgres");
try {
  const t = await prisma.thread.findUniqueOrThrow({ where: { botId: "bot-1" } });
  console.log("PROBE-OK row:", t.id, "isPrimary:", t.isPrimary);
} catch (err) {
  console.log("PROBE-ERROR name:", err.constructor?.name);
  console.log("PROBE-ERROR message:", String(err.message).split("\n").slice(0, 12).join("\n"));
} finally {
  await prisma.$disconnect();
  await pool.end();
}
