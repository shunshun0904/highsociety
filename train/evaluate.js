'use strict';
/* 対戦評価。席順の有利不利を消すため、評価対象の席を1局ごとに回す。
   4人ゲームなので「互角なら勝率0.25」が基準線。

   対応のある比較（common random numbers）:
     局ごとに乱数を種から作り直すので、同じ seed を渡した2つの対戦は
     「同じ配牌・同じ席順・同じ乱数列」から始まる。カードゲームの分散の主因は配牌なので、
     設定を入れ替えた2回を同一シードで走らせるだけで、同じ局数でも差の分解能が上がる。
     （局中は打ち手の判断が違えば乱数の消費もずれるので、完全な対応にはならない）
     この工夫は先読み（agentSearchMove）で試行回数を3倍にするより効いたのと同じ原理。 */

const H = require('./harness');
const { playGame } = require('./game');

function seatOf(s) {
  if (s.kind === 'cpu') return { kind: 'cpu' };
  if (s.kind === 'random') return { kind: 'random' };
  if (s.kind === 'search') return { kind: 'search', net: s.net, temp: s.temp, rollouts: s.rollouts, depth: s.depth };
  return { kind: 'net', net: s.net, temp: s.temp };
}

// 局ごとの種を先に決めておく。設定が違っても同じ配牌列から始まる
function dealSeeds(seed, games) {
  const base = H.makeRng(seed), out = new Float64Array(games);
  for (let g = 0; g < games; g++) out[g] = Math.floor(base() * 4294967296) || 1;
  return out;
}

/* a を1人、b を3人にして games 局。
   戻り値: win（a の勝ち分・引き分けは山分け）, reward（平均報酬）, se（標準誤差）,
           wins（局ごとの勝ち分。対応のある差を取るために使う） */
function match(a, b, games, seed) {
  const seeds = dealSeeds(seed, games);
  const wins = new Float64Array(games);
  let win = 0, place = 0;
  for (let g = 0; g < games; g++) {
    const rnd = H.useRng(seeds[g]);          // ここで配牌から共通化される
    const me = g % 4;
    const seats = [];
    for (let i = 0; i < 4; i++) seats.push(i === me ? seatOf(a) : seatOf(b));
    const res = playGame(seats, rnd, null);
    const w = res.top.indexOf(me) >= 0 ? 1 / res.top.length : 0;
    wins[g] = w; win += w;
    place += res.reward[me];
  }
  const p = win / games;
  let sq = 0;
  for (let g = 0; g < games; g++) sq += (wins[g] - p) * (wins[g] - p);
  return { win: p, reward: place / games, se: Math.sqrt(sq / games / games), wins: wins };
}

/* 両向きの対戦を同一シードで走らせ、対応のある差として返す。
   同じ配牌で役を入れ替えるので、配牌のブレが差から落ちる。
     diff … a の勝ち分 − b の勝ち分（互角なら 0）
     se   … 局ごとの差から求めた diff の標準誤差 */
function duel(a, b, games, seed) {
  const A = match(a, b, games, seed);
  const B = match(b, a, games, seed);
  let mu = 0;
  const d = new Float64Array(games);
  for (let g = 0; g < games; g++) { d[g] = A.wins[g] - B.wins[g]; mu += d[g]; }
  mu /= games;
  let sq = 0;
  for (let g = 0; g < games; g++) sq += (d[g] - mu) * (d[g] - mu);
  return { diff: mu, se: Math.sqrt(sq / games / games), a: A.win, b: B.win, aSe: A.se, bSe: B.se };
}

/* もっと強い対応付け：相手の3席を b に固定したまま、着目する1席だけを a と b で入れ替える。
   「b だらけの卓に a を1人置いたら、b を置くより勝てるか」を直接測る形なので、
   配牌だけでなく相手の顔ぶれまで共通になり、差のノイズがさらに落ちる（duel の約半分）。
   b を置いたときの勝ち分は定義上 0.25 なので、diff はそのまま上振れ幅を意味する。 */
function duelField(a, b, games, seed) {
  const A = match(a, b, games, seed);
  const B = match(b, b, games, seed);
  let mu = 0;
  const d = new Float64Array(games);
  for (let g = 0; g < games; g++) { d[g] = A.wins[g] - B.wins[g]; mu += d[g]; }
  mu /= games;
  let sq = 0;
  for (let g = 0; g < games; g++) sq += (d[g] - mu) * (d[g] - mu);
  return { diff: mu, se: Math.sqrt(sq / games / games), a: A.win, b: B.win, aSe: A.se, bSe: B.se };
}

module.exports = { match, duel, duelField };
