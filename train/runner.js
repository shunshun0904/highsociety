'use strict';
/* PPO の1反復（自己対戦 → 収集 → 更新）をまとめた土台。
   train.js（単純な自己対戦）と league.js（リーグ戦）が共有する。 */

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const H = require('./harness');
const { Trainer } = require('./net');

class Runner {
  constructor(cfg) {
    this.cfg = cfg;
    this.api = H.api();
    this.tr = new Trainer(cfg.h1, cfg.h2, cfg.seed);
    this.pool = [];
    this.workers = [];
    for (let i = 0; i < cfg.workers; i++) {
      this.workers.push(new Worker(path.join(__dirname, 'worker.js'),
        { workerData: { seed: cfg.seed + 1000 * (i + 1), h1: cfg.h1, h2: cfg.h2 } }));
    }
    // 使い回すバッファ
    this.mb = {
      X: new Float32Array(cfg.mb * this.api.AGENT_NFEAT),
      mask: new Uint8Array(cfg.mb * this.api.AGENT_NACT),
      act: new Uint8Array(cfg.mb), oldlp: new Float32Array(cfg.mb),
      adv: new Float32Array(cfg.mb), ret: new Float32Array(cfg.mb)
    };
  }

  load(w) {
    if (w.h1 !== this.cfg.h1 || w.h2 !== this.cfg.h2) throw new Error('層の大きさが合わない');
    this.tr.load(w);
  }
  weights() { return this.tr.weights(); }
  net() {
    const n = this.api.agentNewNet(this.cfg.h1, this.cfg.h2), w = this.tr.weights();
    for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
    return n;
  }
  netOf(w) {
    const n = this.api.agentNewNet(this.cfg.h1, this.cfg.h2);
    for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(w[k]);
    return n;
  }
  save(file, extra) {
    const w = this.tr.weights();
    const o = { h1: this.cfg.h1, h2: this.cfg.h2, nIn: this.api.AGENT_NFEAT, nAct: this.api.AGENT_NACT };
    for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) o[k] = Array.from(w[k]);
    Object.assign(o, extra || {});
    fs.writeFileSync(file, JSON.stringify(o));
  }

  rollout(games, opt) {
    const w = this.tr.weights();
    const per = Math.ceil(games / this.workers.length);
    return Promise.all(this.workers.map(wk => new Promise((res, rej) => {
      const onMsg = m => { wk.off('error', onErr); res(m); };
      const onErr = e => { wk.off('message', onMsg); rej(e); };
      wk.once('message', onMsg); wk.once('error', onErr);
      wk.postMessage({ w, pool: this.pool, games: per, temp: opt.temp, pCpu: opt.pCpu, pPool: opt.pPool,
        gamma: this.cfg.gamma, lam: this.cfg.lam, shape: opt.shape, pot: opt.pot });
    })));
  }

  /* 1反復。opt = {lr, ent, temp, pCpu, pPool, shape, pot} */
  async iterate(opt) {
    const cfg = this.cfg, api = this.api;
    const tR = Date.now();
    const parts = await this.rollout(cfg.games, opt);
    const msR = Date.now() - tR;

    let n = 0, games = 0, wins = 0, seats = 0;
    for (const p of parts) { n += p.n; games += p.games; wins += p.wins; seats += p.seatsLearned; }
    const nIn = api.AGENT_NFEAT, nAct = api.AGENT_NACT;
    const X = new Float32Array(n * nIn), mask = new Uint8Array(n * nAct);
    const act = new Uint8Array(n), oldlp = new Float32Array(n), adv = new Float32Array(n), ret = new Float32Array(n);
    let k = 0;
    for (const p of parts) {
      X.set(p.X, k * nIn); mask.set(p.mask, k * nAct);
      act.set(p.act, k); oldlp.set(p.oldlp, k); adv.set(p.adv, k); ret.set(p.ret, k);
      k += p.n;
    }

    // 優位性は GAE で席ごとに積んである（game.js）。ここでは平均0・分散1に正規化するだけ
    let mu = 0;
    for (let i = 0; i < n; i++) mu += adv[i];
    mu /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (adv[i] - mu) * (adv[i] - mu);
    sd = Math.sqrt(sd / n) + 1e-8;
    for (let i = 0; i < n; i++) adv[i] = (adv[i] - mu) / sd;

    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const b = this.mb;
    let st = null;
    const tU = Date.now();
    for (let ep = 0; ep < cfg.epochs; ep++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (let s = 0; s + 8 <= n; s += cfg.mb) {
        const m = Math.min(cfg.mb, n - s);
        for (let q = 0; q < m; q++) {
          const src = idx[s + q];
          b.X.set(X.subarray(src * nIn, src * nIn + nIn), q * nIn);
          b.mask.set(mask.subarray(src * nAct, src * nAct + nAct), q * nAct);
          b.act[q] = act[src]; b.oldlp[q] = oldlp[src]; b.adv[q] = adv[src]; b.ret[q] = ret[src];
        }
        st = this.tr.ppo({ n: m, X: b.X, act: b.act, oldlp: b.oldlp, adv: b.adv, ret: b.ret, mask: b.mask },
          { clip: cfg.clip, ent: opt.ent, vf: cfg.vf, lr: opt.lr });
      }
    }
    return Object.assign(st, { n, games, selfWin: wins / seats, msR, msU: Date.now() - tU });
  }

  close() { for (const w of this.workers) w.terminate(); }
}

module.exports = { Runner };
