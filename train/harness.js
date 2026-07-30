'use strict';
/* index.html から「ENGINE」「AGENT」の2区画を切り出して Node 上で動かす。
   学習と本番で同じコードが走ることを構造的に保証するための土台。 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

// マーカーの入ったコメント直後から、終端コメント直前までを取り出す
function section(src, tag) {
  let i = src.indexOf(tag + '_START');
  if (i < 0) throw new Error('index.html に ' + tag + '_START がない');
  i = src.indexOf('*/', i) + 2;
  let j = src.indexOf(tag + '_END');
  if (j < 0) throw new Error('index.html に ' + tag + '_END がない');
  j = src.lastIndexOf('/*', j);
  return src.slice(i, j);
}

const EXPORTS = [
  'MONEY', 'LUX_NAME', 'sum', 'shuffle', 'buildDeck', 'isDisgrace', 'cardLabel',
  'createGame', 'beginRound', 'activeCount', 'nextActor', 'findMinRaise', 'canRaise',
  'applyBid', 'applyPass', 'award', 'resolveFaux', 'rawStatus', 'scoreOf', 'finalTable',
  'cpuBudget', 'cpuMove', 'cpuFauxChoice',
  'AGENT_STEPS', 'AGENT_NACT', 'AGENT_NFEAT', 'AGENT_TEMP', 'AGENT_DATA',
  'agentSums', 'agentActions', 'agentFeatures', 'agentNewNet', 'agentForward',
  'agentProbs', 'agentSample', 'agentEval', 'agentNet', 'agentUseNet', 'agentMove',
  'agentOutcome', 'agentReward', 'agentSetShape', 'agentPotential', 'agentSetPot',
  'agentClone', 'agentRollValue', 'agentSearchMove', 'AGENT_ROLLOUTS'
];

let API = null;
function api() {
  if (API) return API;
  const src = fs.readFileSync(HTML, 'utf8');
  const code = section(src, 'ENGINE') + '\n' + section(src, 'AGENT') +
    '\nglobalThis.__hs = {' + EXPORTS.join(',') + '};';
  vm.runInThisContext(code, { filename: 'index.html' });
  API = globalThis.__hs;
  return API;
}

// 決定的に再現できる乱数（xorshift128+）。Math.random を差し替えて使う
function makeRng(seed) {
  let s0 = (seed ^ 0x9e3779b9) >>> 0, s1 = (seed * 0x85ebca6b + 1) >>> 0;
  let s2 = (seed * 0xc2b2ae35 + 7) >>> 0, s3 = (seed ^ 0x27d4eb2f) >>> 0;
  if (!s0) s0 = 1;
  return function () {
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return ((s0 + s3) >>> 0) / 4294967296;
  };
}
function useRng(seed) {
  const r = makeRng(seed);
  Math.random = r;
  return r;
}

const NAMES = ['P0', 'P1', 'P2', 'P3'];
const PERSONAS = [{ rate: 1.0 }, { rate: 0.92 }, { rate: 1.0 }, { rate: 1.12 }];

// 学習の出発点を読む。'embedded' なら index.html に埋め込み済みの重みを使う
// （配布物さえあれば学習を再開できるようにするため）
function loadWeights(spec) {
  if (spec === 'embedded') {
    const n = api().agentNet();
    if (!n) throw new Error('index.html に重みが埋め込まれていない');
    return { h1: n.h1, h2: n.h2, iter: 'embedded', W1: n.W1, B1: n.B1, W2: n.W2, B2: n.B2, W3: n.W3, B3: n.B3 };
  }
  return JSON.parse(fs.readFileSync(spec, 'utf8'));
}

module.exports = { api, section, makeRng, useRng, loadWeights, NAMES, PERSONAS, ROOT, HTML };
