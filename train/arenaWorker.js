'use strict';
/* 対戦評価をワーカースレッドで分担する。
   席の指定（打ち手の種類・重み・先読みの設定）を受け取り、割り当てられた
   局番号の範囲だけを戦って勝ち分を返す。 */

const { parentPort, workerData } = require('worker_threads');
const H = require('./harness');

const api = H.api();
const nets = new Map();

function netOf(w) {
  if (!w) return null;
  const key = w.key;
  if (nets.has(key)) return nets.get(key);
  const n = api.agentNewNet(w.h1, w.h2);
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
  nets.set(key, n);
  return n;
}

// 席の指定を、その席が指す打ち手に変える
function seatOf(s) {
  if (s.kind === 'cpu' || s.kind === 'random') return { kind: s.kind };
  return { kind: s.kind, net: netOf(s.w), temp: s.temp, rollouts: s.rollouts, depth: s.depth, opt: s.opt };
}

function move(G, s, rnd) {
  const p = G.players[G.actor];
  if (s.kind === 'cpu') return api.cpuMove(G);
  if (!api.canRaise(G, p)) return { pass: true };
  if (s.kind === 'search') {
    api.agentUseNet(s.net);
    return api.agentSearchMove(G, Object.assign({ temp: s.temp, rollouts: s.rollouts, depth: s.depth }, s.opt || {}));
  }
  const acts = api.agentActions(G, p);
  if (s.kind === 'random') {
    const legal = [];
    for (let i = 0; i < api.AGENT_NACT; i++) if (acts[i]) legal.push(i);
    const a = legal[Math.floor(rnd() * legal.length) % legal.length];
    return acts[a].pass ? { pass: true } : { idxs: acts[a].idxs };
  }
  const o = api.agentForward(s.net, api.agentFeatures(G, p, acts));
  const a = api.agentSample(api.agentProbs(o, acts, s.temp || 1), rnd);
  return a === 0 ? { pass: true } : { idxs: acts[a].idxs };
}

parentPort.on('message', (task) => {
  const A = seatOf(task.a), B = seatOf(task.b);
  const rnd = H.useRng(task.seed);
  let win = 0, reward = 0;
  for (let g = 0; g < task.games; g++) {
    const me = (task.offset + g) % 4;         // 席順の有利不利を消す
    const seats = [];
    for (let i = 0; i < 4; i++) seats.push(i === me ? A : B);
    const G = api.createGame(H.NAMES, H.PERSONAS);
    let guard = 0;
    while (G.phase !== 'over' && guard++ < 4000) {
      if (G.phase === 'faux') { api.resolveFaux(G, api.cpuFauxChoice(G.players[G.pending.player])); continue; }
      const p = G.players[G.actor];
      const mv = move(G, seats[p.idx], rnd);
      if (mv.pass) api.applyPass(G, p); else api.applyBid(G, p, mv.idxs);
    }
    const out = api.agentOutcome(G);
    if (out.top.indexOf(me) >= 0) win += 1 / out.top.length;
    reward += api.agentReward(G)[me];
  }
  parentPort.postMessage({ win, reward, games: task.games });
});
