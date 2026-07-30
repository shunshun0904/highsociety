'use strict';
/* 自己対戦の1局を回し、学習用のサンプル（特徴・行動・優位性・価値の目標）を取り出す。
   勝敗と報酬の定義は index.html の agentOutcome / agentReward（＝本番と同一）を使う。

   信用割当:
     終局報酬だけだと1席20回以上の判断すべてに同じ数字が届き、どの上乗せが良かったのかを
     区別できない。そこで index.html の agentPotential（他家との得点差・残金差）を Φ として
       中間報酬 r_t = γΦ(s_{t+1}) − Φ(s_t)      （最後の判断だけ終局報酬 R を足す）
     を与え、席ごとの判断列に対して GAE(γ, λ) で優位性を積む。
     Φ の合計は1局で畳まれるので最適方策は変わらず、配分だけが競りごとに割り振られる。
     pot=[0,0]・γ=1・λ=1 なら A_t = R − V(s_t)、ret_t = R となり従来と数値まで一致する。 */

const H = require('./harness');

/* seats[i] は打ち手の指定
     {kind:'net', net, temp, learn:true}   学習中の方策（learn の席だけサンプルを集める）
     {kind:'search', net, temp, rollouts}  先読みつきの方策
     {kind:'cpu'}                          既存の思考ルーチン
     {kind:'random'}                       合法手から一様乱択

   opt = {gamma, lam}（既定は 1 / 1 ＝ 素のモンテカルロ）                     */
function playGame(seats, rnd, sink, opt) {
  const api = H.api();
  const gamma = opt && opt.gamma !== undefined ? opt.gamma : 1;
  const lam = opt && opt.lam !== undefined ? opt.lam : 1;
  const G = api.createGame(H.NAMES, H.PERSONAS);
  const traj = G.players.map(() => []);   // 席ごとの意思決定列（あとで報酬と優位性を書き込む）
  let learned = false;
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
      mv = api.agentSearchMove(G, { temp: s.temp, rollouts: s.rollouts, depth: s.depth });
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
          traj[p.idx].push({ f: f, a: a, logp: Math.log(pr[a] + 1e-12),
                             v: o[api.AGENT_NACT], phi: api.agentPotential(G, p), mask: mask });
          learned = true;
        }
      }
      mv = acts[a].pass ? { pass: true } : { idxs: acts[a].idxs };
    }

    if (mv.pass) api.applyPass(G, p); else api.applyBid(G, p, mv.idxs);
  }

  const out = api.agentOutcome(G);
  const reward = api.agentReward(G);

  if (sink && learned) {
    for (let i = 0; i < traj.length; i++) {
      const q = traj[i];
      if (!q.length) continue;
      const k = q.length;
      // Φ(終局)=0 とし、終局報酬は最後の遷移に載せる
      let adv = 0;
      for (let t = k - 1; t >= 0; t--) {
        const last = (t === k - 1);
        const phiNext = last ? 0 : q[t + 1].phi;
        const vNext = last ? 0 : q[t + 1].v;
        const r = gamma * phiNext - q[t].phi + (last ? reward[i] : 0);
        const delta = r + gamma * vNext - q[t].v;
        adv = delta + gamma * lam * adv;
        q[t].adv = adv;
        q[t].ret = adv + q[t].v;                 // 価値の回帰目標（GAEと整合した形）
        sink.push(q[t]);
      }
    }
  }
  return { reward: reward, top: out.top };
}

module.exports = { playGame };
