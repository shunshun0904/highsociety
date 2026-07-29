'use strict';
/* 自己対戦の1局を回し、学習用のサンプル（特徴・行動・報酬）を取り出す。
   勝敗と報酬の定義は index.html の agentOutcome / agentReward（＝本番と同一）を使う。 */

const H = require('./harness');

/* seats[i] は打ち手の指定
     {kind:'net', net, temp, learn:true}   学習中の方策（learn の席だけサンプルを集める）
     {kind:'search', net, temp, rollouts}  先読みつきの方策
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
    } else if (s.kind === 'search') {
      api.agentUseNet(s.net);
      mv = api.agentSearchMove(G, { temp: s.temp, rollouts: s.rollouts });
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

  const out = api.agentOutcome(G);
  const reward = api.agentReward(G);
  if (sink) for (const m of marks) { m.r = reward[m.seat]; sink.push(m); }
  return { reward: reward, top: out.top };
}

module.exports = { playGame };
