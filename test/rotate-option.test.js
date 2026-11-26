// Checks the `rotate` constructor option against the built package.
// Run: npm run build && node --test test/rotate-option.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { join } = require("node:path");
const { EPDWrapper } = require("../dist");

const fakeBridge = join(__dirname, "fake_bridge.py");

async function rotateSeenByBridge(options) {
  const epd = new EPDWrapper("python3", fakeBridge, { log: false, ...options });
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
      () => new EPDWrapper(undefined, undefined, { rotate }),
      /Invalid rotate option: .* Allowed values: 0, 180\./
    );
  }
});
