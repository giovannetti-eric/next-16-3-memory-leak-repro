# next 16.3 memory leak reproduction

A Next.js server on **16.3.x** retains about **2 MiB per request** under
high-cardinality traffic and never gives it back. 16.2.6 does not, and neither
does the 16.4 canary line, on the same app and the same load.

The trigger is one line in `use-cache-wrapper.js`. Between `16.3.0-canary.107`
and the `16.3.0` stable, `outerWorkUnitStore.renderSignal` was dropped from the
`AbortSignal.any([...])` that guards a `"use cache"` prerender. Putting it back
makes the leak go away completely. `scripts/apply-fix.mjs` does that to the
installed package so you can check it yourself.

## Running it

```bash
npm install
npm run build
npm start            # sets NODE_OPTIONS=--expose-gc
```

In another shell:

```bash
node scripts/load.mjs 400 8
node scripts/load.mjs 400 8     # run it two or three times
```

Each run warms the caches, reads memory, drives 400 distinct slugs, then reads
memory again. `/api/mem` forces a full GC before reporting, which is why the
server needs `--expose-gc`: the delta is retained memory, not garbage waiting to
be collected.

Every run uses a fresh slug prefix. That matters. Two runs over the same slugs
would hit the cache the first run filled and report no retention at all.

**Read `heapUsed + arrayBuffers`, not `rss`.** Those two reproduce to three
digits across runs. `rss` wanders by a few hundred MiB on its own because the
allocator returns pages when it feels like it, which makes a healthy build look
noisy and a leaking one look inconsistent.

## Measured

Node v24.5.0, macOS 15 / arm64, concurrency 8, pages of ~565 KB, three
consecutive runs of 400 distinct slugs each. Per-run deltas:

| build | heapUsed | arrayBuffers | |
| --- | --- | --- | --- |
| 16.2.6 | −0.1 / +0.5 MiB | +39.1 / −0.6 MiB | plateaus |
| 16.3.3 | +272.1 / +272.7 / +272.4 MiB | +531.2 / +531.0 / +531.1 MiB | **linear** |
| 16.4.0-canary.8 | −0.1 / +0.4 / −0.1 MiB | +39.1 / −0.5 / −0.6 MiB | plateaus |
| 16.3.3 + `apply-fix.mjs` | −0.3 / +0.3 / 0.0 MiB | +39.1 / −0.5 / −0.6 MiB | plateaus |

The one-time +39.1 MiB of `arrayBuffers` in the first run is a buffer pool
filling up. Healthy builds are flat from the second run on. 16.3.3 repeats the
same delta forever: about 2057 KiB per request, and rss was past 2.8 GiB by the
end of run three.

To reproduce a row, swap the version and rebuild:

```bash
npm install next@16.2.6 && rm -rf .next && npm run build
```

## The line

Diffing the two published artifacts, `16.3.0-canary.107` (healthy, 3 Aug 14:04)
against `16.3.0` (leaks, 3 Aug 20:34), `dist/server/use-cache/use-cache-wrapper.js`
loses one entry from the composed signal:

```js
 const abortSignal = dynamicAccessAbortSignal ? AbortSignal.any([
     dynamicAccessAbortSignal,
-    outerWorkUnitStore.renderSignal,
     timeoutAbortController.signal
 ]) : timeoutAbortController.signal;
```

`dynamic-rendering-utils.js` also gains `makeUntrackedHangingPromise`, used for a
new early return when a `"use cache"` call lands after the prerender already
ended. Restoring the signal alone is enough to stop the leak, so that second
change is not what does it.

Where the memory goes: `makeHangingPromiseWithError` keeps
`reject.bind(null, error)` in `abortListenersBySignal`, a WeakMap keyed by the
signal. Each of those errors carries a V8 stack that was captured and never
read. With `renderSignal` out of the composition, the composed signal is built
from a per-call timeout controller whose timer gets cleared, so nothing ever
aborts it and the listeners are never fired or dropped. That last step is a
reading of the code, not something I measured directly.

Capping frame capture supports it. On stock 16.3.3 with
`--stack-trace-limit=2`, `heapUsed` growth drops from +272 to +94 MiB and
`arrayBuffers` from +531 to +73 MiB.

## Not the vendored React

Every 16.3.x release bundles React `19.3.0-canary-cbb046ab-20260731`. The 16.4
canaries bundle newer ones (`…-20260819`, `…-20260824`) and don't leak, so a
React bump looked like the answer. It isn't. Copying the whole
`dist/compiled/react*` tree from 16.4.0-canary.0 over a 16.3.3 install changes
nothing: +272.1 / +272.4 / +272.3 MiB of `heapUsed`, same as stock.

Worth knowing: 16.4.0-canary.8 does not have that `renderSignal` line either,
and it doesn't leak. So main must abort that signal by some other route, and the
patch here is a diagnostic, not a proposed diff.

## What the app does

`src/app/[slug]/page.tsx` is nothing unusual:

- `cacheComponents: true` in `next.config.ts`
- a `"use cache"` scope per slug returning ~565 KB of response
- a `<Suspense>` boundary around a component that reads `headers()`
- `generateStaticParams` returning a single seed entry, so every other slug is
  rendered on demand

## The V8 behaviour on its own

`scripts/plain-node-mechanism.mjs` isolates the retention with no Next.js and no
React:

```bash
node --expose-gc scripts/plain-node-mechanism.mjs on           # external +200.0 MiB
node --expose-gc scripts/plain-node-mechanism.mjs materialize  # external   +0.0 MiB
node --expose-gc scripts/plain-node-mechanism.mjs off          # external   +0.0 MiB
```

400 iterations × 512 KiB = exactly 200 MiB retained, although only an
`AbortSignal` is kept. Reading `.stack` once converts the frames to a string and
releases all of it.

## In a real application

Same signature on a production app: 966 prerendered routes, ~65k on-demand
pages, 10 replicas, 2Gi limit. Memory climbs at roughly 2 GB/h per replica and
the pods restart about every 50 minutes. On bare 16.3.2 the kernel OOM killer
takes them at the cgroup limit (exit 137). After deploying
`Error.stackTraceLimit = 1` as a mitigation, what was left was heap-dominated
rather than buffer-dominated, so V8 hit its own limit first and the pods started
dying on `Ineffective mark-compacts` at ~990 MB of heap instead (exit 134, well
under 2Gi).

Heap snapshots 140 requests apart on that app: 1592 new `Error` objects, the
three largest groups reachable through `AbortSignal.[kReason]`, plus one full
retained HTML document per request.

## Ruled out, by measurement

- the vendored React version (above)
- `partialPrefetching` — leaks with the flag off
- `output: standalone` — `next start` over the same artifacts leaks at the same rate
- a custom `cacheHandlers.default` — held 13 MB while the process held 1.9 GiB
- TypeScript version, Sentry, and the `MaxListenersExceededWarning` from [#97757](https://github.com/vercel/next.js/issues/97757)
