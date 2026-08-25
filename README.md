# next 16.3 memory leak reproduction

A Next.js server on **16.3.0** retains roughly **1.8 MiB per request** under
high-cardinality traffic and never gives it back. **16.2.6 does not**, on the same
app, the same build and the same load.

The retention is pinned by `Error` objects created during render whose `.stack` is
never read: V8 keeps their frames as structured `CallSiteInfo` objects, and those
frames keep the render closures — and therefore the rendered HTML and the stream
buffers — reachable. Capping V8 frame capture removes most of it, which is what
identifies the mechanism.

## Running it

```bash
npm install
npm run build
NODE_OPTIONS='--expose-gc' node_modules/.bin/next start
```

In another shell:

```bash
node scripts/load.mjs 400 8
```

The load script warms the caches first, reads memory, drives 400 **distinct**
slugs, then reads memory again. `/api/mem` forces a full GC before reporting, so
the delta is retained memory rather than uncollected garbage — this is why the
server has to be started with `--expose-gc`.

## Measured

Node v24.5.0, macOS 15 / arm64, 400 distinct slugs at concurrency 8, pages of
~568 KB each.

| build | rss delta | heapUsed delta | arrayBuffers delta | retained per request |
| --- | --- | --- | --- | --- |
| 16.2.6 | +105.0 MiB | **+0.3 MiB** | +40.5 MiB | **269 KiB** |
| 16.3.0 | +705.3 MiB | +265.9 MiB | +511.5 MiB | **1806 KiB** |
| 16.3.0, `--stack-trace-limit=2` | +235.2 MiB | +91.5 MiB | +70.8 MiB | **602 KiB** |

On 16.2.6 the heap is flat: the 269 KiB per request is the `use cache` entry for
each distinct slug, which is the cache doing its job. On 16.3.0 the same workload
retains almost seven times as much, and the heap itself grows by a quarter of a
gigabyte.

To reproduce a row, swap the version and rebuild:

```bash
npm install next@16.2.6 && rm -rf .next && npm run build
```

## What the app does

`src/app/[slug]/page.tsx` is deliberately ordinary:

- `cacheComponents: true` in `next.config.ts`
- a `"use cache"` scope per slug returning ~568 KB of markup
- a `<Suspense>` boundary around a component that reads `headers()`
- `generateStaticParams` returning a single seed entry, so every other slug is
  rendered on demand

That combination puts the render on the prerender/abort path where the errors are
created.

## In a real application

The same signature was measured on a production app (966 prerendered routes, ~65k
on-demand pages, 10 replicas, 2Gi limit): memory climbing linearly at ~2 GB/h per
replica until the kernel OOM-killed each pod roughly every 50 minutes. Under a
synthetic load the same build died outright:

```
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
```

Heap snapshots taken 140 requests apart on that app showed 1592 new `Error`
objects, the three largest groups reachable through `AbortSignal.[kReason]`, plus
one full retained HTML document string per request.

## The mechanism on its own

`scripts/plain-node-mechanism.mjs` isolates the V8 behaviour with no Next.js and no
React at all:

```bash
node --expose-gc scripts/plain-node-mechanism.mjs on           # external +200.0 MiB
node --expose-gc scripts/plain-node-mechanism.mjs materialize  # external   +0.0 MiB
node --expose-gc scripts/plain-node-mechanism.mjs off          # external   +0.0 MiB
```

400 iterations x 512 KiB = exactly 200 MiB retained, although only an `AbortSignal`
is kept. Reading `.stack` once (`materialize`) converts the frames to a string and
releases everything.

## Ruled out, by measurement

- `partialPrefetching` — leaks with the flag off
- `output: standalone` — `next start` over the same artifacts leaks at the same rate
- a custom `cacheHandlers.default` — held 13 MB while the process held 1.9 GiB
- TypeScript version, Sentry, and the `MaxListenersExceededWarning` from [#97757](https://github.com/vercel/next.js/issues/97757)
