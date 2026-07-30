'use strict';
/* 学習済みの網を「太らせる」（net2net widening）。
     node train/widen.js --in=train/weights.json --h1=160 --h2=112 --out=train/weights-wide.json

   増えた側の重みは、出力に影響しない形で置く:
     ・第1層に足した行     … 通常の初期化（新しい特徴の受け皿）
     ・第2層の既存行 × 新列 … 0（足した第1層が既存の出力を乱さない）
     ・第2層に足した行     … 通常の初期化
     ・出力層の新列        … 0（足した第2層が出力を乱さない）
   これで初期状態の関数は元と完全に一致し、そこから容量だけが増える。 */

const fs = require('fs');
const path = require('path');
const H = require('./harness');

const argv = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) argv[m[1]] = m[2]; }
const num = (k, d) => (argv[k] === undefined ? d : Number(argv[k]));

const api = H.api();
const src = argv.in || path.join(__dirname, 'weights.json');
const w = H.loadWeights(src);
const nIn = api.AGENT_NFEAT, nOut = api.AGENT_NACT + 1;
const H1 = num('h1', 160), H2 = num('h2', 112);
if (H1 < w.h1 || H2 < w.h2) throw new Error('小さくはできない');

const rnd = H.makeRng(num('seed', 7));
const gauss = s => { const u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * s; };

const W1 = new Float32Array(H1 * nIn), B1 = new Float32Array(H1);
const W2 = new Float32Array(H2 * H1), B2 = new Float32Array(H2);
const W3 = new Float32Array(nOut * H2), B3 = new Float32Array(nOut);

// 第1層：既存行はそのまま、足した行は He 初期化
for (let r = 0; r < H1; r++) {
  if (r < w.h1) { for (let i = 0; i < nIn; i++) W1[r * nIn + i] = w.W1[r * nIn + i]; B1[r] = w.B1[r]; }
  else { const s = Math.sqrt(2 / nIn); for (let i = 0; i < nIn; i++) W1[r * nIn + i] = gauss(s); }
}
// 第2層：既存行は既存列だけ引き継ぎ（新列は0）、足した行は He 初期化
for (let r = 0; r < H2; r++) {
  if (r < w.h2) {
    for (let i = 0; i < w.h1; i++) W2[r * H1 + i] = w.W2[r * w.h1 + i];
    B2[r] = w.B2[r];
  } else {
    const s = Math.sqrt(2 / H1);
    for (let i = 0; i < H1; i++) W2[r * H1 + i] = gauss(s);
  }
}
// 出力層：既存列だけ引き継ぎ（新列は0）
for (let r = 0; r < nOut; r++) {
  for (let i = 0; i < w.h2; i++) W3[r * H2 + i] = w.W3[r * w.h2 + i];
  B3[r] = w.B3[r];
}

// 報酬の定義は太らせても変わらないので引き継ぐ（export.js が埋め込みに使う）
const out = { h1: H1, h2: H2, nIn: nIn, nAct: api.AGENT_NACT, widenedFrom: [w.h1, w.h2],
  shape: w.shape, pot: w.pot };
for (const [k, a] of [['W1', W1], ['B1', B1], ['W2', W2], ['B2', B2], ['W3', W3], ['B3', B3]]) out[k] = Array.from(a);
const dst = argv.out || path.join(__dirname, 'weights-wide.json');
fs.writeFileSync(dst, JSON.stringify(out));

/* 検証：無作為な局面で、太らせる前と後の出力が一致するか */
const mk = o => { const n = api.agentNewNet(o.h1, o.h2); for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) n[k].set(o[k]); return n; };
const small = mk(w), wide = mk(out);
H.useRng(1234);
let maxDiff = 0, checked = 0;
for (let t = 0; t < 400; t++) {
  const G = api.createGame(H.NAMES, H.PERSONAS);
  for (let step = 0; step < 6 && G.phase === 'auction'; step++) {
    const p = G.players[G.actor];
    if (!api.canRaise(G, p)) break;
    const acts = api.agentActions(G, p), f = api.agentFeatures(G, p, acts);
    const a = Float64Array.from(api.agentForward(small, f));
    const b = Float64Array.from(api.agentForward(wide, f));
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    checked++;
    const e = api.agentEval(small, G, p), k = api.agentSample(api.agentProbs(e.logits, e.acts, 1));
    if (k === 0) api.applyPass(G, p); else api.applyBid(G, p, e.acts[k].idxs);
  }
}
console.log('太らせ完了: ' + w.h1 + 'x' + w.h2 + ' → ' + H1 + 'x' + H2 +
  '（重み ' + (H1 * nIn + H2 * H1 + nOut * H2) + '個）→ ' + dst);
console.log('検証: ' + checked + '局面で出力の最大差 ' + maxDiff.toExponential(2) +
  (maxDiff < 1e-4 ? '  ── 関数として一致' : '  ── 一致していない！'));
process.exit(maxDiff < 1e-4 ? 0 : 1);
