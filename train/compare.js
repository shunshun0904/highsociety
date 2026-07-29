'use strict';
/* 2つの重みを直接対戦させて優劣を決める。
     node train/compare.js --a=train/weights-wide.best.json --b=embedded [--games=800] [--search]

   1人対3人を両向きに行い、勝ち分の差で判定する（席順は1局ごとに回す）。
   --search を付けると両者とも先読みつきで戦わせる（本番と同じ条件）。 */

const path = require('path');
const H = require('./harness');
const { match } = require('./evaluate');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}
const api = H.api();
const N = Number(argv.games || 800);
const T = Number(argv.temp || 0.85);
const useSearch = !!argv.search;

function netOf(spec) {
  const w = H.loadWeights(spec);
  const n = api.agentNewNet(w.h1, w.h2);
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
  return { net: n, label: spec + '（' + w.h1 + 'x' + w.h2 + '）' };
}

const A = netOf(argv.a || path.join(__dirname, 'weights.json'));
const B = netOf(argv.b || 'embedded');
const kind = useSearch ? 'search' : 'net';
const sa = { kind, net: A.net, temp: T }, sb = { kind, net: B.net, temp: T };

console.log('A: ' + A.label);
console.log('B: ' + B.label);
console.log((useSearch ? '先読みあり' : '素の方策') + '・各' + N + '局・温度' + T);

const ab = match(sa, sb, N, 8801);
const ba = match(sb, sa, N, 8802);
const diff = ab.win - ba.win;
console.log('  A1人 vs B3人 → A ' + ab.win.toFixed(3));
console.log('  B1人 vs A3人 → B ' + ba.win.toFixed(3));
console.log('  差 ' + (diff >= 0 ? '+' : '') + diff.toFixed(3) +
  '（互角なら 0）→ ' + (Math.abs(diff) < 0.03 ? '互角' : diff > 0 ? 'A のほうが強い' : 'B のほうが強い'));
// 参考として既存CPU相手の数字も
const ca = match(sa, { kind: 'cpu' }, N, 8803);
const cb = match(sb, { kind: 'cpu' }, N, 8804);
console.log('  ［参考］既存CPU3人相手  A ' + ca.win.toFixed(3) + ' / B ' + cb.win.toFixed(3) + '（互角なら 0.250）');
