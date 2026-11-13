// Run: node tests/runtime-regression.cjs
// Behavioral checks for scheduling under stalls and repeated ambient updates.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function fn(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Missing function ${name}`);
  const end = html.indexOf('\n}', start) + 2;
  return html.slice(start, end);
}
function scheduler(nextT, state = 'running') {
  const starts = [];
  const env = {
    AE: {ctx: {currentTime: 10, state}}, TP: {blowing: false},
    MUS: {running: true, song: {phase: 'solo'}, nextT, look: .34, bars: [], soloH: []},
    gapTick() {}, endSong() {}, fermataTick() {}, musicOnMyHold() {},
    stepBar() { starts.push(env.MUS.nextT); env.MUS.nextT += 2; }
  };
  vm.runInNewContext(fn('schedTick') + '\nschedTick();', env);
  return starts;
}
assert.deepEqual(scheduler(0), [10.04], 'A stall must not play expired bars together');
assert.deepEqual(scheduler(10.2), [10.2], 'On-time accompaniment must keep its beat');
assert.deepEqual(scheduler(0, 'suspended'), [], 'Pause must not schedule audio');

const commands = [];
const gain = {value: .2, cancelAndHoldAtTime: t => commands.push(['hold', t]),
  setTargetAtTime: (...a) => commands.push(['target', ...a])};
const beds = {AE: {ctx: {currentTime: 1}}, BED: {babble: {g: {gain}}}};
vm.runInNewContext(fn('setBed') + '\nfor(let i=0;i<3600;i++)setBed("babble",.12,.3);setBed("babble",0,.3);', beds);
assert.equal(commands.filter(c => c[0] === 'target').length, 2, 'Steady ambience must not flood automation');
assert.equal(commands.at(-1)[1], 0, 'A hush must reach actual silence');

let disconnects = 0;
const live = new Set(), sources = [];
function source() {const node = {start() {}, stop() {}, disconnect() {disconnects++;}, addEventListener(_, cb) {node.end=cb;}}; sources.push(node); return node;}
const graphEnv = {CROWD_AUDIO: {baking: false, graphs: live}, source,
  filter: {disconnect() {disconnects++;}}};
vm.runInNewContext(fn('fxGraph') + '\nconst graph=fxGraph();graph.own(source());graph.own(source());graph.own(filter);', graphEnv);
assert.equal(live.size, 1);
sources[0].end();
assert.equal(disconnects, 0, 'A short noise source must not truncate the longer voice');
sources[1].end();
assert.equal(disconnects, 3, 'All private nodes must disconnect after the last source');
assert.equal(live.size, 0, 'Completed effects must leave the live registry');
console.log('PASS: stalled/on-time/paused scheduling, steady ambience/hush, complete effect cleanup');
