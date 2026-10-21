// npm run scan:usage [days]  - AI spend summary from the ScanRequest table. Counters only: no user ids, no receipt content.
import { PrismaClient } from "@prisma/client";
const days = Number(process.argv[2]) || 30;
const db = new PrismaClient();
const rows = await db.scanRequest.findMany({
  where: { createdAt: { gt: new Date(Date.now() - days * 86400_000) } },
  select: { createdAt: true, status: true, charged: true, errorCode: true },
});
const byDay = new Map();
for (const r of rows) {
  const d = r.createdAt.toISOString().slice(0, 10);
  const o = byDay.get(d) ?? { paidCalls: 0, cacheHits: 0, aiUnavailable: 0, otherFailures: 0, ok: 0 };
  if (r.charged) o.paidCalls++;
  if (r.status === "CACHED") o.cacheHits++;
  if (r.status === "OK") o.ok++;
  if (r.errorCode === "AI_UNAVAILABLE") o.aiUnavailable++;
  else if (r.status === "FAILED") o.otherFailures++;
  byDay.set(d, o);
}
console.table(Object.fromEntries([...byDay.entries()].sort()));
console.log(`last ${days} days: ${rows.filter((r) => r.charged).length} paid AI calls, ${rows.filter((r) => r.status === "CACHED").length} cache hits`);
await db.$disconnect();
