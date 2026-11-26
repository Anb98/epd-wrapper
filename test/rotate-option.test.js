// Checks the constructor options against the built package.
// Run: npm run build && node --test test/rotate-option.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { join } = require("node:path");
const { EPDWrapper } = require("../dist");

const fakeBridge = join(__dirname, "fake_bridge.py");

// pythonPath and bridgeScript come from the options object: only the fake bridge answers with `rotate`.
async function rotateSeenByBridge(options) {
  const epd = new EPDWrapper({ pythonPath: "python3", bridgeScript: fakeBridge, log: false, ...options });
  await epd.start();
  try {
    return (await epd.getInfo()).rotate;
  } finally {
    await epd.stop();
  }
}

test("rotate defaults to 0 and reaches the bridge as EPD_WRAPPER_ROTATE", async () => {
  assert.strictEqual(await rotateSeenByBridge({}), "0");
});

test("rotate 180 reaches the bridge", async () => {
  assert.strictEqual(await rotateSeenByBridge({ rotate: 180 }), "180");
});

test("any other rotate value throws in the constructor", () => {
  for (const rotate of [90, 270, -180, 360, NaN]) {
    assert.throws(
      () => new EPDWrapper({ rotate }),
      /Invalid rotate option: .* Allowed values: 0, 180\./
    );
  }
});

test("log and debug are read from the options object", async () => {
  const seen = [];
  const { log, debug } = console;
  console.log = console.debug = (...args) => seen.push(args.join(" "));
  try {
    await rotateSeenByBridge({ log: false });
    assert.deepStrictEqual(seen, []);
    await rotateSeenByBridge({ log: true, debug: true });
    assert.ok(seen.some((line) => line.startsWith("[EPD] Starting Python bridge")));
    assert.ok(seen.some((line) => line.startsWith("[EPD] > Sending command")));
  } finally {
    Object.assign(console, { log, debug });
  }
});

test("the 1.x positional form throws", () => {
  for (const args of [["python3"], [undefined, undefined, { rotate: 180 }]]) {
    assert.throws(() => new EPDWrapper(...args), /takes a single options object/);
  }
});
