// QA-only config: points migrate deploy at the truncated (pre-multi-session)
// migrations copy. Never used by product code.
export default {
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
};
