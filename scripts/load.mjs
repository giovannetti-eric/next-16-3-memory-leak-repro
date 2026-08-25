// Drives a fixed number of distinct slugs through the running server and reports
// how much memory the process still holds afterwards, after a forced GC.
//
//   node scripts/load.mjs [requests] [concurrency] [baseUrl]

const total = Number(process.argv[2] ?? 400);
const concurrency = Number(process.argv[3] ?? 8);
const base = process.argv[4] ?? "http://127.0.0.1:3000";

const mem = async () => (await fetch(`${base}/api/mem`)).json();

async function warm() {
  // Fill whatever caches exist first, so the measured phase is not cache fill.
  const slugs = Array.from({ length: 60 }, (_, i) => `warm-${i}`);
  await run(slugs);
}

async function run(slugs) {
  let next = 0;
  const worker = async () => {
    while (next < slugs.length) {
      const slug = slugs[next++];
      const res = await fetch(`${base}/${slug}`);
      await res.arrayBuffer();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const fmt = (m) =>
  `rss ${String(m.rssMiB).padStart(7)} MiB | heapUsed ${String(m.heapUsedMiB).padStart(7)} MiB | arrayBuffers ${String(m.arrayBuffersMiB).padStart(7)} MiB`;

await warm();
const before = await mem();
if (!before.exposeGc) {
  console.error("start the server with --expose-gc (pnpm start does this) or the numbers include uncollected garbage");
}
console.log(`before  ${fmt(before)}`);

await run(Array.from({ length: total }, (_, i) => `page-${i}`));

const after = await mem();
console.log(`after   ${fmt(after)}`);
console.log(
  `delta   rss ${(after.rssMiB - before.rssMiB).toFixed(1)} MiB | heapUsed ${(after.heapUsedMiB - before.heapUsedMiB).toFixed(1)} MiB | arrayBuffers ${(after.arrayBuffersMiB - before.arrayBuffersMiB).toFixed(1)} MiB`,
);
console.log(`        over ${total} distinct slugs = ${(((after.rssMiB - before.rssMiB) * 1024) / total).toFixed(0)} KiB retained per request`);
