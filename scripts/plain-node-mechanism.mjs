// Does an Error kept as AbortSignal.reason retain the closure graph alive at its
// creation site? Compare retained heap with frame capture on and off.
// usage: node --expose-gc scripts/plain-node-mechanism.mjs [on|materialize|off]
// modes: "on" (default V8 behaviour), "off" (no frame capture),
//        "materialize" (read .stack once, converting frames to a string)
const mode = ["off", "materialize"].includes(process.argv[2]) ? process.argv[2] : "on";
if (mode === "off") Error.stackTraceLimit = 0;

const kept = [];

function renderOne(i) {
  // Stand-in for a render pipeline: a big payload reachable from closures that are
  // on the stack when the abort Error is constructed.
  const payload = Buffer.alloc(512 * 1024, i % 251);
  const chunks = [payload];

  const emit = () => chunks.length;
  const finish = () => {
    const controller = new AbortController();
    // React does exactly this once a render settles.
    const reason = new Error(
      "This render completed successfully. All cacheSignals are now aborted to allow clean up of any unused resources.",
    );
    // The proposed upstream fix: materialising the stack drops the structured frames.
    if (mode === "materialize") void reason.stack;
    controller.abort(reason);
    return controller.signal;
  };

  const signal = (() => emit() && finish())();
  kept.push(signal); // only the signal is kept, never `payload` directly
}

function mib(n) {
  return +(n / 1048576).toFixed(1);
}

global.gc();
global.gc();
const before = process.memoryUsage();

for (let i = 0; i < 400; i++) renderOne(i);

global.gc();
global.gc();
const after = process.memoryUsage();

console.log(
  JSON.stringify({
    mode,
    signals: kept.length,
    heapUsedDeltaMiB: mib(after.heapUsed - before.heapUsed),
    externalDeltaMiB: mib(after.external - before.external),
    rssDeltaMiB: mib(after.rss - before.rss),
  }),
);
