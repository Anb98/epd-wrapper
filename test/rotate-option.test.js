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

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("stop() ends the bridge process", async () => {
  const epd = new EPDWrapper({ pythonPath: "python3", bridgeScript: fakeBridge, log: false });
  await epd.start();
  const pid = epd.pythonProcess.pid;
  await epd.stop();
  assert.strictEqual(isAlive(pid), false);
});

test("stop() then start() gives a working bridge", async () => {
  const epd = new EPDWrapper({ pythonPath: "python3", bridgeScript: fakeBridge, log: false });
  await epd.start();
  const first = epd.pythonProcess.pid;
  await epd.stop();
  await epd.start();
  // The previous bridge going away must not take the new one down with it.
  if (isAlive(first)) process.kill(first, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    assert.strictEqual((await epd.getInfo()).rotate, "0");
  } finally {
    await epd.stop();
  }
});

test("the 1.x positional form throws", () => {
  for (const args of [["python3"], [undefined, undefined, { rotate: 180 }]]) {
    assert.throws(() => new EPDWrapper(...args), /takes a single options object/);
  }
});
