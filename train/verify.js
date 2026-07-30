'use strict';
/* index.html に埋め込まれた重みで実際に対戦させて強さを測る。
     node train/verify.js [--games=N] [--float=train/weights.json]
   4人ゲームなので互角なら勝率 0.250。 */

const fs = require('fs');
const path = require('path');
const H = require('./harness');
const { match } = require('./evaluate');

const argv = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) argv[m[1]] = m[2]; }
const GAMES = Number(argv.games || 4000);

const api = H.api();
const net = api.agentNet();
if (!net) { console.log('index.html に重みが埋め込まれていない'); process.exit(1); }

function floatNet(file) {
  const w = H.loadWeights(file);
  const n = api.agentNewNet(w.h1, w.h2);
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
  return n;
}

const rows = [];
const push = (name, r) => { rows.push([name, r.win, r.reward, r.se]); };
// 同じ相手を測るときは同一シード（＝同じ配牌列）を使い、行どうしを比べられるようにする
const S = 4242, SS = 4250;

console.log('■ 埋め込み済みネット（int8）');
for (const t of [0.1, 0.2, 0.3, 0.45, 0.6, 0.85, 1.0]) {
  push('温度' + t.toFixed(2) + ' 1人 vs 既存CPU3人', match({ kind: 'net', net, temp: t }, { kind: 'cpu' }, GAMES, S));
}
push('温度0.30 1人 vs 乱択3人', match({ kind: 'net', net, temp: 0.3 }, { kind: 'random' }, GAMES, S));
push('既存CPU 1人 vs 学習AI3人（温度0.30）', match({ kind: 'cpu' }, { kind: 'net', net, temp: 0.3 }, GAMES, S));
push('乱択 1人 vs 学習AI3人（温度0.30）', match({ kind: 'random' }, { kind: 'net', net, temp: 0.3 }, GAMES, S));
// 先読みつき（本番の「ハード」がこれ）
const SN = Math.max(200, Math.round(GAMES / 5));   // 先読みは重いので局数を絞る
push('［先読み］1人 vs 既存CPU3人  (' + SN + '局)', match({ kind: 'search', net, temp: 0.85 }, { kind: 'cpu' }, SN, SS));
push('［先読み］1人 vs 素の方策3人  (' + SN + '局)', match({ kind: 'search', net, temp: 0.85 }, { kind: 'net', net, temp: 0.85 }, SN, SS));
push('［素の方策］1人 vs 素の方策3人  (' + SN + '局)', match({ kind: 'net', net, temp: 0.85 }, { kind: 'net', net, temp: 0.85 }, SN, SS));
push('［先読み］素の方策1人 vs 先読み3人  (' + SN + '局)', match({ kind: 'net', net, temp: 0.85 }, { kind: 'search', net, temp: 0.85 }, SN, SS));
push('［参考］既存CPU 1人 vs 乱択3人', match({ kind: 'cpu' }, { kind: 'random' }, GAMES, S));
push('［参考］乱択 1人 vs 既存CPU3人', match({ kind: 'random' }, { kind: 'cpu' }, GAMES, S));

const fl = argv.float || path.join(__dirname, 'weights.json');
if (fs.existsSync(fl)) {
  const fn = floatNet(fl);
  push('［量子化前 float32］温度0.30 1人 vs 既存CPU3人', match({ kind: 'net', net: fn, temp: 0.3 }, { kind: 'cpu' }, GAMES, S));
  push('［int8 vs float32］int8を1人・float3人', match({ kind: 'net', net, temp: 0.3 }, { kind: 'net', net: fn, temp: 0.3 }, GAMES, 4248));
}

const w = Math.max(...rows.map(r => r[0].length));
console.log('\n' + '対戦'.padEnd(w) + '   勝率            平均報酬   (' + GAMES + '局)');
for (const [name, win, rew, se] of rows) {
  console.log(name.padEnd(w) + '  ' + win.toFixed(3) + ' ±' + se.toFixed(3) + '     ' + rew.toFixed(3));
}
console.log('\n互角なら勝率 0.250。±は標準誤差。同じ相手の行は同一シード（同じ配牌列）で測ってある');
