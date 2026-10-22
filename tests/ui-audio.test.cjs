/* eslint-disable @typescript-eslint/no-require-imports -- Browser audio is isolated with native-API mocks. */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
function load() {
  const instance = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/ui-audio.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("module", "exports", code)(instance, instance.exports);
  return instance.exports;
}

test("all three audio palettes are gated, bounded, stop on mute/theme changes, and tolerate unavailable APIs", async () => {
  const previous = { window: global.window, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const contexts = [], timers = new Map(); let timerId = 0;
  const param = (onSet = () => {}) => ({ setValueAtTime(value) { onSet(value); }, exponentialRampToValueAtTime() {} });
  class Audio {
    state = "running"; currentTime = 0; destination = {}; notes = 0; closed = false; frequencies = [];
    constructor() { contexts.push(this); }
    createOscillator() { this.notes++; return { frequency: param(value => this.frequencies.push(value)), connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: param(), connect() {} }; }
    close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
    resume() { this.state = "running"; return Promise.resolve(); }
  }
  try {
    global.setTimeout = (callback, delay) => { assert.equal(delay, 1200); const id = ++timerId; timers.set(id, callback); return id; };
    global.clearTimeout = id => timers.delete(id);
    delete global.window;
    const { createUIAudio } = load();
    const audio = createUIAudio();
    audio.setTheme("halloween");
    audio.setEnabled(true); assert.doesNotThrow(() => audio.play("welcome"));
    global.window = {}; assert.doesNotThrow(() => audio.play("scan"));
    global.window.AudioContext = Audio;
    audio.setEnabled(false); audio.play("pop"); assert.equal(contexts.length, 0);
    audio.setEnabled(true);
    for (const [sound, count] of [["welcome", 4], ["scan", 2], ["roll", 5], ["pop", 2]]) {
      audio.play(sound); assert.equal(contexts.at(-1).notes, count); assert.equal(timers.size, 1);
      assert.ok(contexts.slice(0, -1).every(context => context.closed));
    }
    audio.setEnabled(false); assert.equal(contexts.at(-1).closed, true); assert.equal(timers.size, 0);
    audio.play("pop"); assert.equal(contexts.length, 4);
    audio.setEnabled(true); audio.play("welcome");
    const spooky = contexts.at(-1);
    assert.deepEqual(spooky.frequencies, [261.63, 311.13, 392, 784]);
    audio.setTheme("cyberpunk"); assert.equal(spooky.closed, true);
    audio.play("welcome");
    assert.deepEqual(contexts.at(-1).frequencies, [659.25, 987.77, 1318.51, 2637]);
    for (const [sound, count] of [["scan", 4], ["roll", 4], ["confirm", 3], ["click", 1]]) {
      audio.play(sound); assert.equal(contexts.at(-1).notes, count);
    }
    audio.setTheme("fantasy");
    assert.equal(contexts.at(-1).closed, true);
    for (const [sound, count] of [["page", 4], ["welcome", 4], ["click", 2], ["scan", 6], ["roll", 6], ["confirm", 5], ["pop", 5]]) {
      audio.play(sound);
      assert.equal(contexts.at(-1).notes, count);
      assert.equal(timers.size, 1);
      assert.ok(contexts.slice(0, -1).every(context => context.closed));
      if (sound === "page") assert.deepEqual(contexts.at(-1).frequencies, [587.33, 880, 1174.66, 1567.98]);
    }
    audio.setEnabled(false);
    const countBeforeMutedPlay = contexts.length;
    audio.play("page");
    assert.equal(contexts.length, countBeforeMutedPlay);
    assert.equal(timers.size, 0);
    audio.setEnabled(true); audio.play("welcome");
    [...timers.values()][0](); assert.equal(contexts.at(-1).closed, true); assert.equal(timers.size, 0);
    global.window.AudioContext = class { constructor() { throw Error("Unavailable"); } };
    assert.doesNotThrow(() => audio.play("welcome"));
    let resume;
    global.window.AudioContext = class extends Audio {
      state = "suspended";
      resume() { return new Promise(resolve => { resume = () => { this.state = "running"; resolve(); }; }); }
    };
    audio.play("welcome"); const pending = contexts.at(-1);
    audio.setEnabled(false); resume(); await Promise.resolve();
    assert.equal(pending.notes, 0); assert.equal(pending.closed, true);
    audio.setEnabled(true);
    global.window.AudioContext = class extends Audio { state = "suspended"; resume() { return Promise.reject(Error("Autoplay blocked")); } };
    audio.play("scan"); await Promise.resolve(); await Promise.resolve();
    assert.equal(contexts.at(-1).closed, true); audio.stop();
    assert.equal(timers.size, 0);
  } finally {
    if (previous.window === undefined) delete global.window; else global.window = previous.window;
    global.setTimeout = previous.setTimeout; global.clearTimeout = previous.clearTimeout;
  }
});
