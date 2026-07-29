'use strict';
/* 対戦評価。席順の有利不利を消すため、評価対象の席を1局ごとに回す。
   4人ゲームなので「互角なら勝率0.25」が基準線。 */

const H = require('./harness');
const { playGame } = require('./game');

function seatOf(kind, net, temp) {
  if (kind === 'cpu') return { kind: 'cpu' };
  if (kind === 'random') return { kind: 'random' };
  return { kind: 'net', net: net, temp: temp };
}

// a を1人、b を3人にして games 局。戻り値は a の勝ち分（引き分けは山分け）と平均順位
function match(a, b, games, seed) {
  const api = H.api();
  const rnd = H.useRng(seed);
  let win = 0, place = 0;
  for (let g = 0; g < games; g++) {
    const me = g % 4;
    const seats = [];
    for (let i = 0; i < 4; i++) seats.push(i === me ? seatOf(a.kind, a.net, a.temp) : seatOf(b.kind, b.net, b.temp));
    const res = playGame(seats, rnd, null);
    if (res.top.indexOf(me) >= 0) win += 1 / res.top.length;
    place += res.reward[me];
  }
  return { win: win / games, reward: place / games };
}

module.exports = { match };
