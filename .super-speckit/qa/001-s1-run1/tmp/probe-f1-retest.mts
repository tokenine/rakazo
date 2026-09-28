// F-1 retest probe: the FIXED call shape from 81647881 (authorization.test.ts:276)
// vs the OLD broken shape, executed against the real migrated Postgres via the
// product's own createDb. Throwaway — never part of product code.
import { createDb } from "/Users/poom-work/.super-speckit-worktrees/ss/bug/001-f1/packages/db/src/client.ts";

const { prisma, pool } = createDb("postgresql://postgres:check_pw@localhost:54330/postgres");
try {
  const fixed = await prisma.thread.findFirstOrThrow({ where: { botId: "bot-r", isPrimary: true } });
  console.log("FIXED-SHAPE-OK:", fixed.id, "isPrimary:", fixed.isPrimary, "name:", fixed.name);
  try {
    await prisma.thread.findUniqueOrThrow({ where: { botId: "bot-r" } });
    console.log("OLD-SHAPE-UNEXPECTED-OK");
  } catch (err) {
    console.log("OLD-SHAPE-ERROR:", err.constructor?.name);
  }
} finally {
  await prisma.$disconnect();
  await pool.end();
}
