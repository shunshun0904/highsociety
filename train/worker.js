'use strict';
/* 自己対戦をワーカースレッドで並列に回し、学習サンプルを本体へ返す */

const { parentPort, workerData } = require('worker_threads');
const H = require('./harness');
const { playGame } = require('./game');

const api = H.api();
const rnd = H.useRng(workerData.seed);
const net = api.agentNewNet(workerData.h1, workerData.h2);
const pool = [];

function setNet(n, w) {
  n.W1.set(w.W1); n.B1.set(w.B1);
  n.W2.set(w.W2); n.B2.set(w.B2);
  n.W3.set(w.W3); n.B3.set(w.B3);
}

/* 先読みの手を集める（方策に教え込むための教師データ）。
   全席を先読みで打たせ、各判断どころの「特徴・先読みが選んだ手・最終結果」を返す。 */
function distill(task) {
  setNet(net, task.w);
  api.agentUseNet(net);
  const nIn = api.AGENT_NFEAT, nAct = api.AGENT_NACT;
  const rows = [];
  for (let g = 0; g < task.games; g++) {
    const G = api.createGame(H.NAMES, H.PERSONAS);
    const marks = [];
    let guard = 0;
    while (G.phase !== 'over' && guard++ < 4000) {
      if (G.phase === 'faux') { api.resolveFaux(G, api.cpuFauxChoice(G.players[G.pending.player])); continue; }
      const p = G.players[G.actor];
      if (!api.canRaise(G, p)) { api.applyPass(G, p); continue; }
      const acts = api.agentActions(G, p);
      const f = api.agentFeatures(G, p, acts);
      const out = {};
      const mv = api.agentSearchMove(G, { temp: task.temp, rollouts: task.rollouts, depth: task.depth, out: out });
      // 先読みの評価値から「やわらかい目標」を作る。
      // 値がほぼ同じ手を無理に1つへ寄せないので、試行のゆらぎを覚え込まない。
      // 目標も学習も「実際に試した手」の中だけで正規化する（試さなかった手は触らない）
      if (out.mean && out.keep.length > 1) {
        const tgt = new Float32Array(nAct), mask = new Uint8Array(nAct);
        let mx = -Infinity;
        for (const a of out.keep) if (out.mean[a] > mx) mx = out.mean[a];
        let z = 0;
        for (const a of out.keep) { const e = Math.exp((out.mean[a] - mx) / task.tau); tgt[a] = e; z += e; mask[a] = 1; }
        for (const a of out.keep) tgt[a] /= z;
        marks.push({ seat: p.idx, f: f, tgt: tgt, mask: mask });
      }
      if (mv.pass) api.applyPass(G, p); else api.applyBid(G, p, mv.idxs);
    }
    const reward = api.agentReward(G);
    for (const m of marks) { m.r = reward[m.seat]; rows.push(m); }
  }
  const n = rows.length;
  const X = new Float32Array(n * nIn), mask = new Uint8Array(n * nAct), tgt = new Float32Array(n * nAct);
  const ret = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    X.set(rows[i].f, i * nIn); mask.set(rows[i].mask, i * nAct); tgt.set(rows[i].tgt, i * nAct);
    ret[i] = rows[i].r;
  }
  parentPort.postMessage({ n, X, mask, tgt, ret, games: task.games },
    [X.buffer, mask.buffer, tgt.buffer, ret.buffer]);
}

parentPort.on('message', (task) => {
  if (task.mode === 'distill') return distill(task);
  setNet(net, task.w);
  pool.length = 0;
  for (const w of task.pool) { const n = api.agentNewNet(workerData.h1, workerData.h2); setNet(n, w); pool.push(n); }

  const sink = [];
  let games = 0, wins = 0, seatsLearned = 0;
  for (let g = 0; g < task.games; g++) {
    const seats = [{ kind: 'net', net: net, temp: task.temp, learn: true }];
    for (let i = 1; i < 4; i++) {
      const r = rnd();
      if (r < task.pCpu) seats.push({ kind: 'cpu' });
      else if (r < task.pCpu + task.pPool && pool.length) seats.push({ kind: 'net', net: pool[Math.floor(rnd() * pool.length) % pool.length], temp: task.temp });
      else seats.push({ kind: 'net', net: net, temp: task.temp, learn: true });
    }
    const res = playGame(seats, rnd, sink);
    games++;
    for (let i = 0; i < 4; i++) if (seats[i].learn) { seatsLearned++; if (res.top.indexOf(i) >= 0) wins += 1 / res.top.length; }
  }

  const n = sink.length, nIn = api.AGENT_NFEAT, nAct = api.AGENT_NACT;
  const X = new Float32Array(n * nIn), mask = new Uint8Array(n * nAct);
  const act = new Uint8Array(n), oldlp = new Float32Array(n), val = new Float32Array(n), ret = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = sink[i];
    X.set(s.f, i * nIn);
    mask.set(s.mask, i * nAct);
    act[i] = s.a; oldlp[i] = s.logp; val[i] = s.v; ret[i] = s.r;
  }
  parentPort.postMessage(
    { n, X, mask, act, oldlp, val, ret, games, wins, seatsLearned },
    [X.buffer, mask.buffer, act.buffer, oldlp.buffer, val.buffer, ret.buffer]
  );
});
