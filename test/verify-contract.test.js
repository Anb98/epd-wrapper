// Independent probes for epd-wrapper 2.0.0: rotate option (S1), constructor contract (S3), stop()/start() (risk item 4).
// Needs a build (npm run build) and python3. Run: node --test test/verify-contract.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EPDWrapper } = require("../dist/index.js");

let unhandled = 0;
process.on("unhandledRejection", () => unhandled++);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epd-verify-"));
const head = 'import json, os, signal, sys, time\nsignal.signal(signal.SIGTERM, lambda *_: None)\nprint(json.dumps({"ready": True}), flush=True)\n';
const bridge = (name, loop) => { const p = path.join(dir, name); fs.writeFileSync(p, head + loop); return p; };
// Answers every command with the rotation env it was spawned with; ends on EOF like epd_bridge.py.
const envBridge = bridge("env_bridge.py", 'for line in sys.stdin:\n    c = json.loads(line)\n    print(json.dumps({"id": c["id"], "success": True, "data": {k: os.environ.get(k) for k in ("EPD_WRAPPER_ROTATE", "EPD_ROTATE")}}), flush=True)\n');
// Never exits after EOF: stop() must hard-kill it.
const stuckBridge = bridge("stuck_bridge.py", 'for line in sys.stdin:\n    c = json.loads(line)\n    print(json.dumps({"id": c["id"], "success": True}), flush=True)\ntime.sleep(60)\n');
// Never answers displayImage; exits 0 one second after EOF.
const slowBridge = bridge("slow_bridge.py", 'for line in sys.stdin:\n    c = json.loads(line)\n    if c["method"] != "displayImage":\n        print(json.dumps({"id": c["id"], "success": True}), flush=True)\ntime.sleep(1)\n');

const make = (bridgeScript, opts = {}) => new EPDWrapper({ bridgeScript, log: false, ...opts });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("S1: rotate accepts only 0 and 180", () => {
  for (const rotate of [undefined, 0, 180]) assert.doesNotThrow(() => new EPDWrapper({ rotate, log: false }));
  for (const rotate of [90, 270, -180, 360, "180", "0", NaN, null, true, 180.5]) {
    assert.throws(() => new EPDWrapper({ rotate, log: false }), /Invalid rotate option/, `rotate ${String(rotate)} accepted`);
  }
});

test("S1: rotate reaches the bridge as EPD_WRAPPER_ROTATE; the consumer's env does not decide it", async () => {
  const saved = { ...process.env };
  process.env.EPD_ROTATE = "180";
  process.env.EPD_WRAPPER_ROTATE = "180";
  try {
    for (const [opts, expected] of [[{}, "0"], [{ rotate: 0 }, "0"], [{ rotate: 180 }, "180"]]) {
      const epd = make(envBridge, opts);
      await epd.start();
      const env = await epd.getInfo();
      await epd.stop();
      assert.strictEqual(env.EPD_WRAPPER_ROTATE, expected, JSON.stringify(opts));
    }
  } finally {
    process.env = saved;
  }
});

test("S3: the 1.x positional constructor throws a TypeError; no arguments still works", () => {
  assert.doesNotThrow(() => new EPDWrapper());
  assert.doesNotThrow(() => new EPDWrapper({}));
  for (const args of [["python3"], ["python3", "/b.py"], ["python3", "/b.py", { log: false }], [undefined, undefined, { rotate: 180 }], [null]]) {
    assert.throws(() => new EPDWrapper(...args), TypeError, JSON.stringify(args));
  }
});

test("stop() ends the bridge, is idempotent, and start() works again", async () => {
  const epd = make(envBridge);
  await epd.stop(); // before start
  await epd.start();
  const first = epd.pythonProcess.pid;
  await Promise.all([epd.stop(), epd.stop()]);
  assert.strictEqual(alive(first), false, "bridge still running after stop()");
  assert.strictEqual(epd.isReady(), false);
  await assert.rejects(epd.clear(), /not ready or already stopped/);
  await epd.start();
  assert.notStrictEqual(epd.pythonProcess.pid, first);
  await epd.getInfo();
  await epd.stop();
  await epd.stop();
});

test("stop() hard-kills a bridge that ignores EOF after about 5 s", async () => {
  const epd = make(stuckBridge);
  await epd.start();
  const pid = epd.pythonProcess.pid;
  const t = Date.now();
  await epd.stop();
  const elapsed = Date.now() - t;
  assert.ok(elapsed >= 4500 && elapsed < 8000, `stop took ${elapsed} ms`);
  assert.strictEqual(alive(pid), false);
  await epd.start();
  await epd.stop();
});

test("a command pending during stop() is rejected, not left hanging", async () => {
  const epd = make(slowBridge);
  await epd.start();
  const t = Date.now();
  const pending = epd.displayImage("/x.png");
  const stopping = epd.stop();
  await assert.rejects(pending, /EPD bridge stopped/);
  assert.ok(Date.now() - t < 5000, "pending command waited for its 30 s timeout");
  await stopping;
});

test("no unhandled rejections", () => {
  assert.strictEqual(unhandled, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
