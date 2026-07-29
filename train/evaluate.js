'use strict';
/* 対戦評価。席順の有利不利を消すため、評価対象の席を1局ごとに回す。
   4人ゲームなので「互角なら勝率0.25」が基準線。 */

const H = require('./harness');
const { playGame } = require('./game');

function seatOf(s) {
  if (s.kind === 'cpu') return { kind: 'cpu' };
  if (s.kind === 'random') return { kind: 'random' };
  if (s.kind === 'search') return { kind: 'search', net: s.net, temp: s.temp, rollouts: s.rollouts, depth: s.depth };
  return { kind: 'net', net: s.net, temp: s.temp };
}

// a を1人、b を3人にして games 局。戻り値は a の勝ち分（引き分けは山分け）と平均順位
function match(a, b, games, seed) {
  const api = H.api();
  const rnd = H.useRng(seed);
  let win = 0, place = 0;
  for (let g = 0; g < games; g++) {
    const me = g % 4;
    const seats = [];
    for (let i = 0; i < 4; i++) seats.push(i === me ? seatOf(a) : seatOf(b));
    const res = playGame(seats, rnd, null);
    if (res.top.indexOf(me) >= 0) win += 1 / res.top.length;
    place += res.reward[me];
  }
  return { win: win / games, reward: place / games };
}

module.exports = { match };
