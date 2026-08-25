import { connection } from "next/server";

// Reports retained memory: a full GC runs first (the server is started with
// NODE_OPTIONS=--expose-gc), so the numbers are not an artefact of collector
// scheduling. `connection()` opts the route out of prerendering — without it,
// Cache Components would serve a snapshot taken at build time.
export async function GET() {
  await connection();

  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    gc();
    gc();
  }
  const m = process.memoryUsage();
  const mib = (n: number) => +(n / 1048576).toFixed(1);
  return Response.json({
    exposeGc: Boolean(gc),
    rssMiB: mib(m.rss),
    heapUsedMiB: mib(m.heapUsed),
    externalMiB: mib(m.external),
    arrayBuffersMiB: mib(m.arrayBuffers),
  });
}
