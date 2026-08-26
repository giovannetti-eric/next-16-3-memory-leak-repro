// Drives a fixed number of distinct slugs through the running server and reports
// how much memory the process still holds afterwards, after a forced GC.
//
//   node scripts/load.mjs [requests] [concurrency] [baseUrl] [runId]

const total = Number(process.argv[2] ?? 400);
const concurrency = Number(process.argv[3] ?? 8);
const base = process.argv[4] ?? "http://127.0.0.1:3000";

// Slugs must be new on every run: a second run over the same slugs would hit the
// cache filled by the first and report no retention at all.
const runId = process.argv[5] ?? String(Date.now()).slice(-7);

const mem = async () => (await fetch(`${base}/api/mem`)).json();

async function warm() {
  // Fill whatever caches exist first, so the measured phase is not cache fill.
  const slugs = Array.from({ length: 60 }, (_, i) => `warm-${runId}-${i}`);
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
  console.error("start the server with --expose-gc (npm start does this) or the numbers include uncollected garbage");
}
console.log(`before  ${fmt(before)}`);

await run(Array.from({ length: total }, (_, i) => `page-${runId}-${i}`));

const after = await mem();
const dRss = after.rssMiB - before.rssMiB;
const dHeap = after.heapUsedMiB - before.heapUsedMiB;
const dBuffers = after.arrayBuffersMiB - before.arrayBuffersMiB;

console.log(`after   ${fmt(after)}`);
console.log(`delta   rss ${dRss.toFixed(1)} MiB | heapUsed ${dHeap.toFixed(1)} MiB | arrayBuffers ${dBuffers.toFixed(1)} MiB`);

// heapUsed + arrayBuffers is the number to read. It reproduces to three digits
// across runs; rss wanders by a few hundred MiB because the allocator returns
// pages on its own schedule, so rss alone makes a healthy build look noisy and a
// leaking one look inconsistent.
const retained = ((dHeap + dBuffers) * 1024) / total;
console.log(`        over ${total} distinct slugs = ${retained.toFixed(0)} KiB retained per request (heapUsed + arrayBuffers)`);
console.log(`        run this two or three times: each run uses fresh slugs, so a healthy build`);
console.log(`        settles to about 0 after the first run and a leaking one repeats the same delta`);
