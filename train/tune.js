'use strict';
/* エクストラ段の候補案を、ハード（現行の先読み）と直接対決させて選ぶ。
     node train/tune.js [--games=800]

   差 > 0 なら候補のほうが強い。標準誤差つきで出すので、
   誤差に埋もれる案は採らない。 */

const H = require('./harness');
const { Arena } = require('./arena');

const argv = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) argv[m[1]] = m[2]; }
const GAMES = Number(argv.games || 800);

const api = H.api();
const net = api.agentNet();
const w = { h1: net.h1, h2: net.h2, W1: net.W1, B1: net.B1, W2: net.W2, B2: net.B2, W3: net.W3, B3: net.B3 };

// ハード＝現行の既定（K=12・深さ2）
const HARD = { kind: 'search', w, temp: 0.85 };
const S = o => ({ kind: 'search', w, temp: 0.85, rollouts: o.rollouts, depth: o.depth, opt: o });

const CANDS = [
  ['予算3倍（K=36）',                 S({ rollouts: 36 })],
  ['絞り込み緩和（K=24・prune 0）',    S({ rollouts: 24, prune: 0 })],
  ['逐次配分（K=12相当）',            S({ rollouts: 12, halving: true })],
  ['逐次配分＋予算3倍',               S({ rollouts: 36, halving: true })],
  ['終盤は終局まで読む（残り4枚以下）', S({ rollouts: 12, endgame: 4 })],
  ['読みの中の相手を強めに（温度0.4）', S({ rollouts: 12, rtemp: 0.4 })],
  ['深さ3',                          S({ rollouts: 12, depth: 3 })],
];

(async () => {
  const ar = new Arena();
  console.log('候補 vs ハード（K=12・深さ2）　各' + GAMES + '局×2方向　差>0なら候補が強い\n');
  const rows = [];
  for (const [name, cand] of CANDS) {
    const t = Date.now();
    const r = await ar.duel(cand, HARD, GAMES, 61000);
    const sig = Math.abs(r.diff) / r.se;
    rows.push([name, r.diff, r.se, sig]);
    console.log(name.padEnd(28) + ' 候補 ' + r.a.toFixed(3) + ' / ハード ' + r.b.toFixed(3) +
      '　差 ' + (r.diff >= 0 ? '+' : '') + r.diff.toFixed(3) + ' ± ' + r.se.toFixed(3) +
      '（' + sig.toFixed(1) + 'σ）  ' + ((Date.now() - t) / 1000).toFixed(0) + '秒');
  }
  console.log('\n=== 差の大きい順 ===');
  rows.sort((a, b) => b[1] - a[1]);
  for (const [name, d, se, sig] of rows) {
    console.log('  ' + (d >= 0 ? '+' : '') + d.toFixed(3) + ' ± ' + se.toFixed(3) + '  ' + name +
      (sig >= 2 ? '  ← 有意' : ''));
  }
  ar.close();
})();
