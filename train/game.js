'use strict';
/* 自己対戦の1局を回し、学習用のサンプル（特徴・行動・報酬）を取り出す */

const H = require('./harness');

const SHAPE = 0.15;   // 報酬のうち「順位」に配分する割合。残りは勝ちかどうか

// 席の並び順を比較する。脱落者（残金最少）は勝てないので常に最下位扱い
function cmpRow(a, b) {
  if (a.castOut !== b.castOut) return a.castOut ? -1 : 1;
  if (a.castOut) return 0;
  return (a.score - b.score) || (a.money - b.money) || (a.best - b.best);
}

// 勝ち（同点は山分け）と順位を混ぜた報酬を返す
function rewards(table) {
  const rows = table.rows, n = rows.length, out = new Array(n).fill(0);
  const top = [];
  for (let i = 0; i < n; i++) {
    if (rows[i].castOut) continue;
    let isTop = true;
    for (let j = 0; j < n; j++) if (cmpRow(rows[i], rows[j]) < 0) { isTop = false; break; }
    if (isTop) top.push(i);
  }
  for (let i = 0; i < n; i++) {
    let below = 0, tie = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const c = cmpRow(rows[i], rows[j]);
      if (c > 0) below++; else if (c === 0) tie++;
    }
    const place = (below + 0.5 * tie) / (n - 1);
    const win = top.indexOf(i) >= 0 ? 1 / top.length : 0;
    out[rows[i].p.idx] = (1 - SHAPE) * win + SHAPE * place;
  }
  return { reward: out, top: top.map(i => rows[i].p.idx) };
}

/* seats[i] は打ち手の指定
     {kind:'net', net, temp, learn:true}  学習中の方策（learn の席だけサンプルを集める）
     {kind:'cpu'}                          既存の思考ルーチン
     {kind:'random'}                       合法手から一様乱択                     */
function playGame(seats, rnd, sink) {
  const api = H.api();
  const G = api.createGame(H.NAMES, H.PERSONAS);
  const marks = [];   // 学習席の意思決定（あとで報酬を書き込む）
  let guard = 0;

  while (G.phase !== 'over') {
    if (++guard > 4000) throw new Error('局が終わらない');
    if (G.phase === 'faux') {
      const p = G.players[G.pending.player];
      api.resolveFaux(G, api.cpuFauxChoice(p));
      continue;
    }
    const p = G.players[G.actor];
    const s = seats[p.idx];
    let mv;

    if (s.kind === 'cpu') {
      mv = api.cpuMove(G);
    } else if (!api.canRaise(G, p)) {
      mv = { pass: true };                       // 上乗せできない＝降りるしかない
    } else {
      const acts = api.agentActions(G, p);
      let a;
      if (s.kind === 'random') {
        const legal = [];
        for (let i = 0; i < api.AGENT_NACT; i++) if (acts[i]) legal.push(i);
        a = legal[Math.floor(rnd() * legal.length) % legal.length];
      } else {
        const f = api.agentFeatures(G, p, acts);
        const o = api.agentForward(s.net, f);
        const pr = api.agentProbs(o, acts, s.temp || 1);
        a = api.agentSample(pr, rnd);
        if (s.learn && sink) {
          const mask = new Uint8Array(api.AGENT_NACT);
          for (let i = 0; i < api.AGENT_NACT; i++) mask[i] = acts[i] ? 1 : 0;
          marks.push({ seat: p.idx, f: f, a: a, logp: Math.log(pr[a] + 1e-12),
                       v: o[api.AGENT_NACT], mask: mask });
        }
      }
      mv = acts[a].pass ? { pass: true } : { idxs: acts[a].idxs };
    }

    if (mv.pass) api.applyPass(G, p); else api.applyBid(G, p, mv.idxs);
  }

  const table = api.finalTable(G);
  const r = rewards(table);
  if (sink) for (const m of marks) { m.r = r.reward[m.seat]; sink.push(m); }
  return r;
}

module.exports = { playGame, rewards, SHAPE };
