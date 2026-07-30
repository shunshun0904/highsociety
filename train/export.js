'use strict';
/* 学習済みの重みを int8 に量子化して index.html に埋め込む。
     node train/export.js [weights.json]
   量子化は出力ニューロンごとのスケール（対称量子化）。 */

const fs = require('fs');
const path = require('path');
const H = require('./harness');

const src = process.argv[2] || path.join(__dirname, 'weights.json');
const w = JSON.parse(fs.readFileSync(src, 'utf8'));
const api = H.api();
const nIn = api.AGENT_NFEAT, nOut = api.AGENT_NACT + 1;

const shapes = [['W1', w.h1, nIn], ['W2', w.h2, w.h1], ['W3', nOut, w.h2]];
const bytes = [];
const scales = [];
for (const [k, rows, cols] of shapes) {
  const a = w[k], sc = [];
  if (a.length !== rows * cols) throw new Error(k + ' の形が合わない');
  for (let r = 0; r < rows; r++) {
    let mx = 0;
    for (let i = 0; i < cols; i++) mx = Math.max(mx, Math.abs(a[r * cols + i]));
    const s = mx / 127 || 1e-8;
    sc.push(Number(s.toPrecision(5)));
    for (let i = 0; i < cols; i++) {
      let q = Math.round(a[r * cols + i] / s);
      bytes.push(Math.max(-127, Math.min(127, q)));
    }
  }
  scales.push(sc);
}
const buf = Buffer.from(Int8Array.from(bytes).buffer);
const b64 = buf.toString('base64');
const bias = ['B1', 'B2', 'B3'].map(k => w[k].map(v => Number(v.toPrecision(5))));

// 価値関数の意味は「順位の配分」と「ポテンシャルの重み」で決まるので、重みと一緒に埋める。
// これが欠けると先読みが読む価値の意味がずれる
const shape = w.shape === undefined ? 0.15 : w.shape;
const pot = w.pot || [0, 0];
const data = 'const AGENT_DATA={h:[' + w.h1 + ',' + w.h2 + '],' +
  'sh:' + Number(shape.toPrecision(4)) + ',p:' + JSON.stringify(pot.map(v => Number(v.toPrecision(4)))) + ',' +
  's:' + JSON.stringify(scales) + ',b:' + JSON.stringify(bias) + ',w:"' + b64 + '"};   /* WEIGHTS */';

const html = fs.readFileSync(H.HTML, 'utf8');
const re = /const AGENT_DATA=.*\/\* WEIGHTS \*\//;
if (!re.test(html)) throw new Error('index.html に埋め込み位置（/* WEIGHTS */）が見つからない');
fs.writeFileSync(H.HTML, html.replace(re, () => data));

// 量子化誤差の目安
let se = 0, n = 0, k = 0;
for (const [key, rows, cols] of shapes) {
  const a = w[key];
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
    const d = a[r * cols + i] - bytes[k++] * scales[shapes.findIndex(s => s[0] === key)][r];
    se += d * d; n++;
  }
}
console.log('埋め込み完了: ' + src + ' → index.html');
console.log('  報酬の定義: 順位の配分 ' + shape + ' / ポテンシャル [' + pot.join(', ') + ']');
console.log('  重み ' + n + '個 / int8 ' + buf.length + 'バイト → Base64 ' + b64.length + '文字');
console.log('  埋め込み総サイズ ' + (data.length / 1024).toFixed(1) + ' KB');
console.log('  量子化の二乗平均誤差 ' + Math.sqrt(se / n).toExponential(2));
