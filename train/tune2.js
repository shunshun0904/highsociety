'use strict';
/* 第2ラウンド：ハード3人の中に候補を1人入れて勝率を測る。
   同じ打ち手同士なら 0.250 になるので、それを基準線に使う。
   両向きの差より計算量が軽く（重い設定の席が1つで済む）、精度は同等。
     node train/tune2.js [--games=1500] */

const H = require('./harness');
const { Arena } = require('./arena');

const argv = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) argv[m[1]] = m[2]; }
const GAMES = Number(argv.games || 1500);

const api = H.api();
const net = api.agentNet();
const w = { h1: net.h1, h2: net.h2, W1: net.W1, B1: net.B1, W2: net.W2, B2: net.B2, W3: net.W3, B3: net.B3 };
const HARD = { kind: 'search', w, temp: 0.85 };
const S = o => ({ kind: 'search', w, temp: 0.85, rollouts: o.rollouts, depth: o.depth, opt: o });

const CANDS = [
  ['ハード自身（基準線の確認）',        HARD],
  ['K=36',                          S({ rollouts: 36 })],
  ['K=36・深さ3',                    S({ rollouts: 36, depth: 3 })],
  ['K=36・絞り込み強め(0.08)',        S({ rollouts: 36, prune: 0.08 })],
  ['K=96',                          S({ rollouts: 96 })],
  ['K=96・深さ3・絞り込み強め',        S({ rollouts: 96, depth: 3, prune: 0.08 })],
];

(async () => {
  const ar = new Arena();
  const se = Math.sqrt(0.25 * 0.75 / GAMES);
  console.log('候補1人 vs ハード3人　各' + GAMES + '局　互角なら 0.250（標準誤差 ±' + se.toFixed(3) + '）\n');
  const rows = [];
  for (const [name, cand] of CANDS) {
    const t = Date.now();
    const r = await ar.match(cand, HARD, GAMES, 71000);
    const sig = (r.win - 0.25) / se;
    rows.push([name, r.win, sig]);
    console.log(name.padEnd(26) + ' ' + r.win.toFixed(3) +
      '（' + (sig >= 0 ? '+' : '') + sig.toFixed(1) + 'σ）  ' + ((Date.now() - t) / 1000).toFixed(0) + '秒');
  }
  console.log('\n=== 強い順 ===');
  rows.sort((a, b) => b[1] - a[1]);
  for (const [name, win, sig] of rows) {
    console.log('  ' + win.toFixed(3) + '  ' + name + (Math.abs(sig) >= 2 ? '  ← 有意' : ''));
  }
  ar.close();
})();
