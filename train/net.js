'use strict';
/* 方策ネットワークの学習側。index.html の agentForward と同じ形の重みを持ち、
   バッチでの順伝播・逆伝播と Adam 更新を行う（外部ライブラリなし）。 */

const H = require('./harness');

function heInit(arr, fanIn, rnd, gain) {
  const s = (gain === undefined ? 1 : gain) * Math.sqrt(2 / fanIn);
  for (let i = 0; i < arr.length; i++) {
    // Box-Muller で正規乱数
    const u = Math.max(rnd(), 1e-12), v = rnd();
    arr[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * s;
  }
}

class Trainer {
  constructor(h1, h2, seed) {
    const api = H.api();
    this.api = api;
    this.nIn = api.AGENT_NFEAT;
    this.nAct = api.AGENT_NACT;
    this.nOut = api.AGENT_NACT + 1;
    this.h1 = h1; this.h2 = h2;
    const rnd = H.makeRng(seed || 1);
    this.net = api.agentNewNet(h1, h2);
    heInit(this.net.W1, this.nIn, rnd);
    heInit(this.net.W2, h1, rnd);
    heInit(this.net.W3, h2, rnd, 0.1);      // 出力層は小さく始める
    this.names = ['W1', 'B1', 'W2', 'B2', 'W3', 'B3'];
    this.g = {}; this.m = {}; this.v = {};
    for (const k of this.names) {
      this.g[k] = new Float64Array(this.net[k].length);
      this.m[k] = new Float64Array(this.net[k].length);
      this.v[k] = new Float64Array(this.net[k].length);
    }
    this.step = 0;
    this.cap = 0;
  }

  weights() {
    const o = {};
    for (const k of this.names) o[k] = Float32Array.from(this.net[k]);
    o.h1 = this.h1; o.h2 = this.h2;
    return o;
  }
  load(w) {
    for (const k of this.names) this.net[k].set(w[k]);
  }

  alloc(n) {
    if (n <= this.cap) return;
    this.cap = n;
    this.A1 = new Float64Array(n * this.h1);
    this.A2 = new Float64Array(n * this.h2);
    this.O = new Float64Array(n * this.nOut);
    this.D1 = new Float64Array(n * this.h1);
    this.D2 = new Float64Array(n * this.h2);
    this.D3 = new Float64Array(n * this.nOut);
  }

  forward(X, n) {
    this.alloc(n);
    const { W1, B1, W2, B2, W3, B3 } = this.net;
    const { A1, A2, O } = this;
    const nIn = this.nIn, h1 = this.h1, h2 = this.h2, nOut = this.nOut;
    for (let b = 0; b < n; b++) {
      const xo = b * nIn, ao = b * h1;
      for (let j = 0; j < h1; j++) {
        let s = B1[j]; const r = j * nIn;
        for (let i = 0; i < nIn; i++) s += W1[r + i] * X[xo + i];
        A1[ao + j] = s > 0 ? s : 0;
      }
      const bo = b * h2;
      for (let j = 0; j < h2; j++) {
        let s = B2[j]; const r = j * h1;
        for (let i = 0; i < h1; i++) s += W2[r + i] * A1[ao + i];
        A2[bo + j] = s > 0 ? s : 0;
      }
      const oo = b * nOut;
      for (let j = 0; j < nOut; j++) {
        let s = B3[j]; const r = j * h2;
        for (let i = 0; i < h2; i++) s += W3[r + i] * A2[bo + i];
        O[oo + j] = s;
      }
    }
  }

  // D3（出力の勾配）が入っている前提で重みの勾配を積む
  backward(X, n) {
    const { W2, W3 } = this.net;
    const { A1, A2, D1, D2, D3 } = this;
    const g = this.g;
    const nIn = this.nIn, h1 = this.h1, h2 = this.h2, nOut = this.nOut;
    for (const k of this.names) g[k].fill(0);

    for (let b = 0; b < n; b++) {
      const oo = b * nOut, bo = b * h2, ao = b * h1;
      for (let j = 0; j < h2; j++) D2[bo + j] = 0;
      for (let j = 0; j < nOut; j++) {
        const d = D3[oo + j];
        if (d === 0) continue;
        const r = j * h2;
        g.B3[j] += d;
        for (let i = 0; i < h2; i++) { g.W3[r + i] += d * A2[bo + i]; D2[bo + i] += d * W3[r + i]; }
      }
      for (let j = 0; j < h1; j++) D1[ao + j] = 0;
      for (let j = 0; j < h2; j++) {
        let d = A2[bo + j] > 0 ? D2[bo + j] : 0;
        if (d === 0) continue;
        const r = j * h1;
        g.B2[j] += d;
        for (let i = 0; i < h1; i++) { g.W2[r + i] += d * A1[ao + i]; D1[ao + i] += d * W2[r + i]; }
      }
      const xo = b * nIn;
      for (let j = 0; j < h1; j++) {
        const d = A1[ao + j] > 0 ? D1[ao + j] : 0;
        if (d === 0) continue;
        const r = j * nIn;
        g.B1[j] += d;
        for (let i = 0; i < nIn; i++) g.W1[r + i] += d * X[xo + i];
      }
    }
  }

  adam(lr, clipNorm) {
    const g = this.g, m = this.m, v = this.v;
    if (clipNorm) {
      let sq = 0;
      for (const k of this.names) { const a = g[k]; for (let i = 0; i < a.length; i++) sq += a[i] * a[i]; }
      const nrm = Math.sqrt(sq);
      if (nrm > clipNorm) {
        const s = clipNorm / (nrm + 1e-8);
        for (const k of this.names) { const a = g[k]; for (let i = 0; i < a.length; i++) a[i] *= s; }
      }
    }
    this.step++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, this.step), c2 = 1 - Math.pow(b2, this.step);
    for (const k of this.names) {
      const w = this.net[k], gk = g[k], mk = m[k], vk = v[k];
      for (let i = 0; i < w.length; i++) {
        const gi = gk[i];
        mk[i] = b1 * mk[i] + (1 - b1) * gi;
        vk[i] = b2 * vk[i] + (1 - b2) * gi * gi;
        w[i] -= lr * (mk[i] / c1) / (Math.sqrt(vk[i] / c2) + eps);
      }
    }
  }

  /* PPO の1ミニバッチ。戻り値は診断用の統計 */
  ppo(batch, opt) {
    const n = batch.n;
    const { X, act, oldlp, adv, ret, mask } = batch;
    const nAct = this.nAct, nOut = this.nOut;
    this.forward(X, n);
    const O = this.O, D3 = this.D3;
    D3.fill(0, 0, n * nOut);
    const clip = opt.clip, ent = opt.ent, vf = opt.vf;
    let pl = 0, vl = 0, el = 0, kl = 0, clipped = 0;
    const pr = new Float64Array(nAct);

    for (let b = 0; b < n; b++) {
      const oo = b * nOut, mo = b * nAct;
      let mx = -Infinity;
      for (let a = 0; a < nAct; a++) if (mask[mo + a] && O[oo + a] > mx) mx = O[oo + a];
      let z = 0;
      for (let a = 0; a < nAct; a++) {
        if (!mask[mo + a]) { pr[a] = 0; continue; }
        const e = Math.exp(O[oo + a] - mx); pr[a] = e; z += e;
      }
      let H0 = 0;
      for (let a = 0; a < nAct; a++) { pr[a] /= z; if (pr[a] > 0) H0 -= pr[a] * Math.log(pr[a]); }

      const a0 = act[b];
      const lp = Math.log(pr[a0] + 1e-12);
      const A = adv[b];
      const r = Math.exp(lp - oldlp[b]);
      const un = r * A, cl = Math.min(Math.max(r, 1 - clip), 1 + clip) * A;
      const use = un <= cl;
      if (!use) clipped++;
      pl += -Math.min(un, cl);
      el += H0;
      kl += oldlp[b] - lp;

      const dlp = use ? -A * r : 0;
      for (let a = 0; a < nAct; a++) {
        if (!mask[mo + a]) continue;
        let d = dlp * ((a === a0 ? 1 : 0) - pr[a]);
        d += ent * pr[a] * (Math.log(pr[a] + 1e-12) + H0);   // エントロピー項（最大化）
        D3[oo + a] = d / n;
      }
      const V = O[oo + nAct], dv = V - ret[b];
      vl += dv * dv;
      D3[oo + nAct] = 2 * vf * dv / n;
    }
    this.backward(X, n);
    this.adam(opt.lr, opt.clipNorm || 1.0);
    return { pl: pl / n, vl: vl / n, ent: el / n, kl: kl / n, clip: clipped / n };
  }
}

module.exports = { Trainer };
