// Patches the installed next 16.3.x in node_modules to put
// `outerWorkUnitStore.renderSignal` back into the AbortSignal.any() composition
// in use-cache-wrapper.js — the one line that 16.3.0 dropped relative to
// 16.3.0-canary.107. Rebuild after running this, then run the load script again.
//
//   node scripts/apply-fix.mjs          # apply
//   node scripts/apply-fix.mjs revert   # put it back
//
// This is a diagnostic patch, not a proposed diff: on main the same line is
// absent and main does not leak, so main aborts that signal some other way.

import { readFileSync, writeFileSync } from "node:fs";

const targets = [
  "node_modules/next/dist/server/use-cache/use-cache-wrapper.js",
  "node_modules/next/dist/esm/server/use-cache/use-cache-wrapper.js",
];

const stock = `AbortSignal.any([
                    dynamicAccessAbortSignal,
                    timeoutAbortController.signal
                ])`;

const patched = `AbortSignal.any([
                    dynamicAccessAbortSignal,
                    outerWorkUnitStore.renderSignal,
                    timeoutAbortController.signal
                ])`;

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
