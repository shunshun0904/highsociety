'use strict';
/* 単純な自己対戦 PPO。
     node train/train.js [--iters=N] [--games=N] [--workers=N] ...
   リーグ戦で鍛えたい場合は league.js を使う。 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./harness');
const { Runner } = require('./runner');
const { match } = require('./evaluate');
const api = H.api();

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
  gamma: num('gamma', 1.0),          // 割引率（終局報酬が本命なので既定は割り引かない）
  lam: num('lam', 0.95),             // GAE の λ。1 なら素のモンテカルロ（従来と同じ）
  pot: num('pot', 0.5),              // 中間報酬の強さ（得点差の重み。0 で中間報酬なし）
  potM: num('potM', 0.4),            // 同じく残金差の重み
  shape: num('shape', 0.15), shapeEnd: num('shapeEnd', 0.0),   // 順位の配分（線形に焼き鈍す）
  temp: num('temp', 1.0),
  pCpu: num('pCpu', 0.10),           // 相手席に既存CPUを混ぜる割合
  pPool: num('pPool', 0.20),         // 相手席に過去の自分を混ぜる割合
  poolEvery: num('poolEvery', 10), poolMax: num('poolMax', 8),
  evalEvery: num('evalEvery', 20), evalGames: num('evalGames', 1200), evalTemp: num('evalTemp', 0.4),
  seed: num('seed', 20260729),
  out: argv.out || path.join(__dirname, 'weights.json')
};
console.log('設定 ' + JSON.stringify(CFG));

const run = new Runner(CFG);
const hist = [];

// --init=weights.json で続きから学習する（Adamの状態は引き継がない）
if (argv.init) {
  const w = H.loadWeights(argv.init);
  run.load(w);
  console.log('続きから学習: ' + argv.init + '（反復 ' + (w.iter || '?') + ' 時点）');
}

(async function main() {
  const t0 = Date.now();
  let best = -1;

  for (let it = 1; it <= CFG.iters; it++) {
    const frac = it / CFG.iters;
    const shape = CFG.shape + (CFG.shapeEnd - CFG.shape) * frac;
    const st = await run.iterate({
      lr: CFG.lr + (CFG.lrEnd - CFG.lr) * frac,
      ent: CFG.ent + (CFG.entEnd - CFG.ent) * frac,
      shape: shape, pot: [CFG.pot, CFG.potM],
      temp: CFG.temp, pCpu: CFG.pCpu, pPool: CFG.pPool
    });

    if (CFG.poolEvery && it % CFG.poolEvery === 0) {
      run.pool.push(run.weights());
      if (run.pool.length > CFG.poolMax) run.pool.shift();
    }

    let line = '#' + String(it).padStart(4) + '  局 ' + st.games + '  標本 ' + st.n +
      '  自己勝率 ' + st.selfWin.toFixed(3) +
      '  価値損失 ' + st.vl.toFixed(4) + '  エントロピー ' + st.ent.toFixed(3) +
      '  KL ' + st.kl.toFixed(4) + '  clip ' + st.clip.toFixed(3) +
      '  [対戦 ' + st.msR + 'ms / 更新 ' + st.msU + 'ms]';

    if (it % CFG.evalEvery === 0 || it === CFG.iters) {
      // 評価する本体側も、そのときの報酬定義に合わせる（両向きで同一シード＝対応のある比較）
      api.agentSetShape(shape); api.agentSetPot(CFG.pot, CFG.potM);
      const net = run.net(), T = CFG.evalTemp, S = 777;
      const vsCpu = match({ kind: 'net', net: net, temp: T }, { kind: 'cpu' }, CFG.evalGames, S);
      const cpuVs = match({ kind: 'cpu' }, { kind: 'net', net: net, temp: T }, CFG.evalGames, S);
      line += '\n        評価(温度' + T + '): 学習AI1人 vs 既存CPU3人 → 勝率 ' + vsCpu.win.toFixed(3) +
        ' ±' + vsCpu.se.toFixed(3) +
        ' ／ 既存CPU1人 vs 学習AI3人 → CPUの勝率 ' + cpuVs.win.toFixed(3) + '（互角なら 0.250）';
      hist.push({ it, vsCpu: vsCpu.win, cpuVs: cpuVs.win, selfWin: st.selfWin });
      run.save(CFG.out, { iter: it, vsCpu: vsCpu.win, shape: shape, pot: [CFG.pot, CFG.potM], hist });
      if (vsCpu.win > best) { best = vsCpu.win; run.save(CFG.out.replace(/\.json$/, '.best.json'), { iter: it, vsCpu: vsCpu.win, shape: shape, pot: [CFG.pot, CFG.potM] }); }
    }
    console.log(line);
  }

  run.save(CFG.out, { iter: CFG.iters, shape: CFG.shapeEnd, pot: [CFG.pot, CFG.potM], hist });
  console.log('経過 ' + ((Date.now() - t0) / 1000).toFixed(0) + '秒　保存: ' + CFG.out);
  run.close();
})();
