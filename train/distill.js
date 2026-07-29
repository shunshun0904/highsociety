'use strict';
/* 先読みの手を方策に教え込む（AlphaZero と同じ考え方の反復）。
     node train/distill.js --rounds=8 --games=400 --init=embedded

   1周ごとに:
     1. 現在の重みで全席を先読みで打たせ、各判断どころの「先読みが選んだ手」を集める
     2. 方策がその手を選ぶように教え込む（交差エントロピー）。価値は最終結果に回帰
     3. 先読みなしの素の方策同士で新旧を直接対決させ、強くなっていたら採用する

   先読みは方策より強いので、その選択を方策に写し取ると方策自体が強くなり、
   その上に載る先読みもさらに強くなる。 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');
const H = require('./harness');
const { Trainer } = require('./net');
const { match } = require('./evaluate');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) argv[m[1]] = m[2];
}
const num = (k, d) => (argv[k] === undefined ? d : Number(argv[k]));

const CFG = {
  h1: num('h1', 96), h2: num('h2', 64),
  rounds: num('rounds', 8),
  games: num('games', 400),          // 1周あたりの先読み自己対戦の局数
  workers: num('workers', Math.max(1, Math.min(4, os.cpus().length - 1))),
  epochs: num('epochs', 4),
  mb: num('mb', 1024),
  lr: num('lr', 2e-4),
  vf: num('vf', 0.5),
  ent: num('ent', 0.002),
  temp: num('temp', 0.85),
  rollouts: num('rollouts', 12),
  depth: num('depth', 2),
  gateGames: num('gateGames', 1200),
  margin: num('margin', 0.02),
  seed: num('seed', 777001),
  init: argv.init || 'embedded',
  out: argv.out || path.join(__dirname, 'weights-distill.json')
};
console.log('設定 ' + JSON.stringify(CFG));

const api = H.api();
const tr = new Trainer(CFG.h1, CFG.h2, CFG.seed);
tr.load(H.loadWeights(CFG.init));
console.log('出発点: ' + CFG.init);

const netOf = w => { const n = api.agentNewNet(CFG.h1, CFG.h2); for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]); return n; };
let champion = tr.weights();
let championNet = netOf(champion);
const base = netOf(champion);       // 出発点（初代）を据え置いて比較に使う
const history = [];

const workers = [];
for (let i = 0; i < CFG.workers; i++) {
  workers.push(new Worker(path.join(__dirname, 'worker.js'),
    { workerData: { seed: CFG.seed + 1000 * (i + 1), h1: CFG.h1, h2: CFG.h2 } }));
}
function collect() {
  const w = tr.weights();
  const per = Math.ceil(CFG.games / workers.length);
  return Promise.all(workers.map(wk => new Promise((res, rej) => {
    const onMsg = m => { wk.off('error', onErr); res(m); };
    const onErr = e => { wk.off('message', onMsg); rej(e); };
    wk.once('message', onMsg); wk.once('error', onErr);
    wk.postMessage({ mode: 'distill', w, games: per, temp: CFG.temp, rollouts: CFG.rollouts, depth: CFG.depth });
  })));
}
function save(file, extra) {
  const o = { h1: CFG.h1, h2: CFG.h2, nIn: api.AGENT_NFEAT, nAct: api.AGENT_NACT };
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) o[k] = Array.from(champion[k]);
  Object.assign(o, extra || {});
  fs.writeFileSync(file, JSON.stringify(o));
}

(async function main() {
  const t0 = Date.now();
  let adopted = 0;

  for (let r = 1; r <= CFG.rounds; r++) {
    const tC = Date.now();
    const parts = await collect();
    let n = 0, games = 0;
    for (const p of parts) { n += p.n; games += p.games; }
    const nIn = api.AGENT_NFEAT, nAct = api.AGENT_NACT;
    const X = new Float32Array(n * nIn), mask = new Uint8Array(n * nAct);
    const act = new Uint8Array(n), ret = new Float32Array(n);
    let k = 0;
    for (const p of parts) {
      X.set(p.X, k * nIn); mask.set(p.mask, k * nAct);
      act.set(p.act, k); ret.set(p.ret, k);
      k += p.n;
    }
    const msC = Date.now() - tC;

    // 教え込む前に、方策がすでに先読みと何割一致しているかを見る
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const b = {
      X: new Float32Array(CFG.mb * nIn), mask: new Uint8Array(CFG.mb * nAct),
      act: new Uint8Array(CFG.mb), ret: new Float32Array(CFG.mb)
    };
    let st = null, first = null;
    const tU = Date.now();
    for (let ep = 0; ep < CFG.epochs; ep++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (let s = 0; s + 8 <= n; s += CFG.mb) {
        const m = Math.min(CFG.mb, n - s);
        for (let q = 0; q < m; q++) {
          const src = idx[s + q];
          b.X.set(X.subarray(src * nIn, src * nIn + nIn), q * nIn);
          b.mask.set(mask.subarray(src * nAct, src * nAct + nAct), q * nAct);
          b.act[q] = act[src]; b.ret[q] = ret[src];
        }
        st = tr.supervised({ n: m, X: b.X, mask: b.mask, act: b.act, ret: b.ret },
          { lr: CFG.lr, vf: CFG.vf, ent: CFG.ent });
        if (!first) first = st;
      }
    }
    const msU = Date.now() - tU;

    // 素の方策同士で新旧を直接対決（先読みを外して方策そのものの実力を見る）
    const cand = netOf(tr.weights());
    const T = 0.85, N = CFG.gateGames;
    const a = match({ kind: 'net', net: cand, temp: T }, { kind: 'net', net: championNet, temp: T }, N, 5500 + r);
    const bk = match({ kind: 'net', net: championNet, temp: T }, { kind: 'net', net: cand, temp: T }, N, 6500 + r);
    const diff = a.win - bk.win;
    const take = diff > CFG.margin;

    let line = '周' + String(r).padStart(2) + '  局 ' + games + '  標本 ' + n +
      '  一致率 ' + first.acc.toFixed(3) + '→' + st.acc.toFixed(3) +
      '  交差エントロピー ' + st.ce.toFixed(3) + '  価値損失 ' + st.vl.toFixed(4) +
      '  [収集 ' + (msC / 1000).toFixed(0) + 's / 学習 ' + (msU / 1000).toFixed(0) + 's]' +
      '\n      新旧対決: 新 ' + a.win.toFixed(3) + ' / 旧 ' + bk.win.toFixed(3) +
      '（差 ' + (diff >= 0 ? '+' : '') + diff.toFixed(3) + '）';
    if (take) {
      adopted++;
      champion = tr.weights(); championNet = netOf(champion);
      const vs0 = match({ kind: 'net', net: championNet, temp: T }, { kind: 'net', net: base, temp: T }, N, 5000);
      const vsCpu = match({ kind: 'net', net: championNet, temp: T }, { kind: 'cpu' }, N, 777);
      line += ' → 採用　[初代相手 ' + vs0.win.toFixed(3) + ' / 既存CPU相手 ' + vsCpu.win.toFixed(3) + ']';
      history.push({ r, diff, vsBase: vs0.win, vsCpu: vsCpu.win, acc: st.acc });
      save(CFG.out, { round: r, vsBase: vs0.win, vsCpu: vsCpu.win, history });
    } else {
      tr.load(champion);           // 効かなかった周は捨てて王者に戻す
      line += ' → 見送り（王者に戻す）';
      history.push({ r, diff, acc: st.acc });
    }
    console.log(line);
  }

  save(CFG.out, { rounds: CFG.rounds, adopted, history });
  console.log('経過 ' + ((Date.now() - t0) / 60000).toFixed(1) + '分　採用 ' + adopted + '/' + CFG.rounds + '周　保存: ' + CFG.out);
  for (const w of workers) w.terminate();
})();
