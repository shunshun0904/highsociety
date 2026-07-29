'use strict';
/* 自己対戦 PPO の本体。
     node train/train.js [--iters=N] [--games=N] [--workers=N] ...
   重みは train/weights.json に随時保存する。 */

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
  iters: num('iters', 260),
  games: num('games', 768),          // 1反復あたりの自己対戦局数
  workers: num('workers', Math.max(1, Math.min(4, os.cpus().length - 1))),
  epochs: num('epochs', 3),
  mb: num('mb', 1024),
  lr: num('lr', 5e-4), lrEnd: num('lrEnd', 1e-4),
  clip: num('clip', 0.2),
  ent: num('ent', 0.02), entEnd: num('entEnd', 0.004),
  vf: num('vf', 0.5),
  temp: num('temp', 1.0),
  pCpu: num('pCpu', 0.10),           // 相手席に既存CPUを混ぜる割合
  pPool: num('pPool', 0.20),         // 相手席に過去の自分を混ぜる割合
  poolEvery: num('poolEvery', 10), poolMax: num('poolMax', 8),
  evalEvery: num('evalEvery', 20), evalGames: num('evalGames', 1200), evalTemp: num('evalTemp', 0.4),
  seed: num('seed', 20260729),
  out: argv.out || path.join(__dirname, 'weights.json')
};
console.log('設定 ' + JSON.stringify(CFG));

const api = H.api();
const tr = new Trainer(CFG.h1, CFG.h2, CFG.seed);

/* 続きから学習する（Adamの状態は引き継がない）
     --init=embedded            index.html に埋め込み済みの重みから
     --init=train/weights.json  学習スクリプトが保存した重みから            */
if (argv.init === 'embedded') {
  const n = api.agentNet();
  if (!n) throw new Error('index.html に重みが埋め込まれていない');
  if (n.h1 !== CFG.h1 || n.h2 !== CFG.h2) throw new Error('--init の層の大きさが合わない');
  tr.load(n);
  console.log('続きから学習: index.html に埋め込み済みの重み');
} else if (argv.init) {
  const w = JSON.parse(fs.readFileSync(argv.init, 'utf8'));
  if (w.h1 !== CFG.h1 || w.h2 !== CFG.h2) throw new Error('--init の層の大きさが合わない');
  tr.load(w);
  console.log('続きから学習: ' + argv.init + '（反復 ' + (w.iter || '?') + ' 時点）');
}
const pool = [];
const hist = [];

/* ---- ワーカー ---- */
const workers = [];
for (let i = 0; i < CFG.workers; i++) {
  workers.push(new Worker(path.join(__dirname, 'worker.js'),
    { workerData: { seed: CFG.seed + 1000 * (i + 1), h1: CFG.h1, h2: CFG.h2 } }));
}
function rollout(games) {
  const w = tr.weights();
  const per = Math.ceil(games / workers.length);
  return Promise.all(workers.map(wk => new Promise((res, rej) => {
    // 片方が発火したらもう片方を外す（反復ごとに購読が積み上がらないように）
    const onMsg = m => { wk.off('error', onErr); res(m); };
    const onErr = e => { wk.off('message', onMsg); rej(e); };
    wk.once('message', onMsg); wk.once('error', onErr);
    wk.postMessage({ w, pool, games: per, temp: CFG.temp, pCpu: CFG.pCpu, pPool: CFG.pPool });
  })));
}

function saveWeights(file, extra) {
  const w = tr.weights();
  const o = { h1: CFG.h1, h2: CFG.h2, nIn: api.AGENT_NFEAT, nAct: api.AGENT_NACT };
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) o[k] = Array.from(w[k]);
  Object.assign(o, extra || {});
  fs.writeFileSync(file, JSON.stringify(o));
}

function netFromWeights() {
  const n = api.agentNewNet(CFG.h1, CFG.h2), w = tr.weights();
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
  return n;
}

/* ---- 学習ループ ---- */
(async function main() {
  const t0 = Date.now();
  let best = -1;

  for (let it = 1; it <= CFG.iters; it++) {
    const frac = it / CFG.iters;
    const lr = CFG.lr + (CFG.lrEnd - CFG.lr) * frac;
    const ent = CFG.ent + (CFG.entEnd - CFG.ent) * frac;

    const tR = Date.now();
    const parts = await rollout(CFG.games);
    const msR = Date.now() - tR;

    let n = 0, games = 0, wins = 0, seats = 0;
    for (const p of parts) { n += p.n; games += p.games; wins += p.wins; seats += p.seatsLearned; }
    const nIn = api.AGENT_NFEAT, nAct = api.AGENT_NACT;
    const X = new Float32Array(n * nIn), mask = new Uint8Array(n * nAct);
    const act = new Uint8Array(n), oldlp = new Float32Array(n), val = new Float32Array(n), ret = new Float32Array(n);
    let k = 0;
    for (const p of parts) {
      X.set(p.X, k * nIn); mask.set(p.mask, k * nAct);
      act.set(p.act, k); oldlp.set(p.oldlp, k); val.set(p.val, k); ret.set(p.ret, k);
      k += p.n;
    }

    // 優位性＝実際の報酬 − 状態価値の見積り。平均0・分散1に正規化する
    const adv = new Float32Array(n);
    let mu = 0;
    for (let i = 0; i < n; i++) { adv[i] = ret[i] - val[i]; mu += adv[i]; }
    mu /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (adv[i] - mu) * (adv[i] - mu);
    sd = Math.sqrt(sd / n) + 1e-8;
    for (let i = 0; i < n; i++) adv[i] = (adv[i] - mu) / sd;

    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const bX = new Float32Array(CFG.mb * nIn), bMask = new Uint8Array(CFG.mb * nAct);
    const bAct = new Uint8Array(CFG.mb), bOld = new Float32Array(CFG.mb);
    const bAdv = new Float32Array(CFG.mb), bRet = new Float32Array(CFG.mb);
    let st = null;
    const tU = Date.now();
    for (let ep = 0; ep < CFG.epochs; ep++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (let s = 0; s + 8 <= n; s += CFG.mb) {
        const m = Math.min(CFG.mb, n - s);
        for (let b = 0; b < m; b++) {
          const src = idx[s + b];
          bX.set(X.subarray(src * nIn, src * nIn + nIn), b * nIn);
          bMask.set(mask.subarray(src * nAct, src * nAct + nAct), b * nAct);
          bAct[b] = act[src]; bOld[b] = oldlp[src]; bAdv[b] = adv[src]; bRet[b] = ret[src];
        }
        st = tr.ppo({ n: m, X: bX, act: bAct, oldlp: bOld, adv: bAdv, ret: bRet, mask: bMask },
          { clip: CFG.clip, ent: ent, vf: CFG.vf, lr: lr });
      }
    }
    const msU = Date.now() - tU;

    if (it % CFG.poolEvery === 0) {
      pool.push(tr.weights());
      if (pool.length > CFG.poolMax) pool.shift();
    }

    const selfWin = wins / seats;
    let line = '#' + String(it).padStart(4) + '  局 ' + games + '  標本 ' + n +
      '  自己勝率 ' + selfWin.toFixed(3) +
      '  価値損失 ' + st.vl.toFixed(4) + '  エントロピー ' + st.ent.toFixed(3) +
      '  KL ' + st.kl.toFixed(4) + '  clip ' + st.clip.toFixed(3) +
      '  [対戦 ' + msR + 'ms / 更新 ' + msU + 'ms]';

    if (it % CFG.evalEvery === 0 || it === CFG.iters) {
      const net = netFromWeights();
      // 本番の打ち手は温度を下げて使うので、評価もその温度で行う
      const T = CFG.evalTemp;
      const vsCpu = match({ kind: 'net', net: net, temp: T }, { kind: 'cpu' }, CFG.evalGames, 777);
      const cpuVs = match({ kind: 'cpu' }, { kind: 'net', net: net, temp: T }, CFG.evalGames, 778);
      line += '\n        評価(温度' + T + '): 学習AI1人 vs 既存CPU3人 → 勝率 ' + vsCpu.win.toFixed(3) +
        ' ／ 既存CPU1人 vs 学習AI3人 → CPUの勝率 ' + cpuVs.win.toFixed(3) + '（互角なら 0.250）';
      hist.push({ it, vsCpu: vsCpu.win, cpuVs: cpuVs.win, selfWin });
      saveWeights(CFG.out, { iter: it, vsCpu: vsCpu.win, hist });
      if (vsCpu.win > best) { best = vsCpu.win; saveWeights(CFG.out.replace(/\.json$/, '.best.json'), { iter: it, vsCpu: vsCpu.win }); }
    }
    console.log(line);
  }

  saveWeights(CFG.out, { iter: CFG.iters, hist });
  console.log('経過 ' + ((Date.now() - t0) / 1000).toFixed(0) + '秒　保存: ' + CFG.out);
  for (const w of workers) w.terminate();
})();
