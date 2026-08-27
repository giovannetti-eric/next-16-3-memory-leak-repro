// Applies the change from vercel/next.js#97476 to the installed next 16.3.x in
// node_modules: abort the timeout controller once the cache prerender settles,
// when it participates in an AbortSignal.any() composite, so React removes its
// abort listener and Node releases the composite.
//
//   node scripts/apply-upstream-fix.mjs          # apply
//   node scripts/apply-upstream-fix.mjs revert   # put it back

import { readFileSync, writeFileSync } from "node:fs";

const targets = [
  "node_modules/next/dist/server/use-cache/use-cache-wrapper.js",
  "node_modules/next/dist/esm/server/use-cache/use-cache-wrapper.js",
];

const stock = `                clearTimeout(timer);
                if (timeoutAbortController.signal.aborted) {`;

const patched = `                clearTimeout(timer);
                const didTimeout = timeoutAbortController.signal.aborted;
                if (dynamicAccessAbortSignal) {
                    // Release React's listener from the composite signal.
                    timeoutAbortController.abort();
                }
                if (didTimeout) {`;

const revert = process.argv[2] === "revert";
const [from, to] = revert ? [patched, stock] : [stock, patched];

for (const file of targets) {
  const source = readFileSync(file, "utf8");
  const hits = source.split(from).length - 1;
  if (hits === 0) {
    console.log(`${file}: already ${revert ? "reverted" : "patched"}, or not a 16.3.x build`);
    continue;
  }
  if (hits !== 1) throw new Error(`${file}: expected one match, found ${hits}`);
  writeFileSync(file, source.replace(from, to));
  console.log(`${file}: ${revert ? "reverted" : "patched"}`);
}

console.log("\nnow: rm -rf .next && npm run build");
