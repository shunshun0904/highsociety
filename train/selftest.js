'use strict';
/* AGENT 区画の健全性チェック：部分和DP・候補手・特徴量・対局ループ */

const H = require('./harness');
const { playGame } = require('./game');

const rnd = H.useRng(12345);
const api = H.api();
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.log('  NG  ' + msg); fails++; } };

/* 1. 部分和DP が総当たりと一致するか */
for (let trial = 0; trial < 200; trial++) {
  const hand = api.MONEY.filter(() => rnd() < 0.6);
  const t = api.agentSums(hand);
  const best = {};
  for (let m = 0; m < (1 << hand.length); m++) {
    let s = 0, c = 0;
    for (let i = 0; i < hand.length; i++) if (m & (1 << i)) { s += hand[i]; c++; }
    if (best[s] === undefined || c < best[s]) best[s] = c;
  }
  for (let s = 0; s <= 106; s++) {
    const has = t.cnt[s] !== 127;
    ok(has === (best[s] !== undefined), '到達可能性 s=' + s + ' hand=' + hand);
    if (has) ok(t.cnt[s] === best[s], '最小枚数 s=' + s + ' hand=' + hand);
  }
}

/* 2. 候補手：最小の上乗せがエンジンの findMinRaise と一致するか、
      各候補が「手札の実在する組合せ」であり額が正しいか */
for (let trial = 0; trial < 400; trial++) {
  const hand = api.MONEY.filter(() => rnd() < 0.7);
  const own = Math.floor(rnd() * 20);
  const high = Math.floor(rnd() * 40);
  const G = { highBid: high, players: [] };
  const p = { hand: hand, bid: own ? [own] : [] };
  const acts = api.agentActions(G, p);
  const ref = api.findMinRaise(hand, own, high);
  let first = null;
  for (let i = 1; i < api.AGENT_NACT; i++) if (acts[i]) { first = acts[i]; break; }
  ok(!!ref === !!first, '上乗せ可能性が findMinRaise と一致 hand=' + hand);
  if (ref && first) ok(ref.total === first.total, '最小上乗せ額 ' + ref.total + ' vs ' + first.total);
  for (let i = 1; i < api.AGENT_NACT; i++) {
    if (!acts[i]) continue;
    const a = acts[i];
    let s = 0;
    const seen = {};
    for (const idx of a.idxs) { ok(idx < hand.length, '手札の範囲内'); ok(!seen[idx], '重複なし'); seen[idx] = 1; s += hand[idx]; }
    ok(own + s === a.total, '合計が一致 ' + (own + s) + ' vs ' + a.total);
    ok(a.total > high, '最高額を超えている');
  }
}

/* 3. 特徴量：長さ・NaN・値域 */
{
  const G = api.createGame(H.NAMES, H.PERSONAS);
  const p = G.players[0];
  const acts = api.agentActions(G, p);
  const f = api.agentFeatures(G, p, acts);
  ok(f.length === api.AGENT_NFEAT, '特徴次元 ' + f.length + ' / ' + api.AGENT_NFEAT);
  let nz = 0;
  for (let i = 0; i < f.length; i++) { ok(Number.isFinite(f[i]), '有限値 i=' + i); if (f[i] !== 0) nz++; }
  ok(nz > 10, '非ゼロ要素が十分ある: ' + nz);
}

/* 4. 対局ループ：既存CPU同士で回して速度と手数を測る */
{
  const seats = [{ kind: 'cpu' }, { kind: 'cpu' }, { kind: 'cpu' }, { kind: 'cpu' }];
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < 2000; i++) { playGame(seats, rnd, null); n++; }
  const ms = Date.now() - t0;
  console.log('  既存CPU同士 ' + n + '局 / ' + ms + 'ms  (' + (n / ms * 1000).toFixed(0) + ' 局/秒)');

  const net = api.agentNewNet(96, 64);
  for (let i = 0; i < net.W1.length; i++) net.W1[i] = (rnd() - 0.5) * 0.2;
  const seats2 = [0, 1, 2, 3].map(() => ({ kind: 'net', net: net, temp: 1, learn: true }));
  const sink = [];
  const t1 = Date.now();
  for (let i = 0; i < 2000; i++) playGame(seats2, rnd, sink);
  const ms1 = Date.now() - t1;
  console.log('  方策ネット同士 2000局 / ' + ms1 + 'ms  (' + (2000 / ms1 * 1000).toFixed(0) + ' 局/秒)');
  console.log('  1局あたりの意思決定 ' + (sink.length / 2000).toFixed(1) + ' 回（4席合計）');
  let bad = 0;
  for (const s of sink) if (!Number.isFinite(s.r) || s.r < 0 || s.r > 1) bad++;
  ok(bad === 0, '報酬が [0,1] に収まる');
}

console.log(fails ? '\n失敗 ' + fails + ' 件' : '\nすべて通過');
process.exit(fails ? 1 : 0);
