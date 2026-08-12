'use strict';
/* 打ち手同士の直接対決を並列に行う道具。
   先読み同士の対戦は重いので、候補案を数多く試すにはこれが要る。

   使い方（ライブラリとして）:
     const { Arena } = require('./arena');
     const ar = new Arena();
     const r = await ar.duel(a, b, 1200);     // a を1人・b を3人（両向きの差も返る）
     ar.close();

   席の指定:
     {kind:'cpu'} / {kind:'random'}
     {kind:'net',    w, temp}
     {kind:'search', w, temp, rollouts, depth, opt:{...}}   opt は先読みの追加設定
*/

const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const H = require('./harness');

let keyCounter = 0;
// 重みはワーカーへ毎回送るので、同じものは同じ鍵で覚えさせて再構築を省く
function packWeights(w) {
  if (!w) return null;
  if (!w.__key) Object.defineProperty(w, '__key', { value: 'w' + (++keyCounter), enumerable: false });
  const o = { key: w.__key, h1: w.h1, h2: w.h2 };
  for (const k of ['W1', 'B1', 'W2', 'B2', 'W3', 'B3']) o[k] = w[k];
  return o;
}
function packSeat(s) {
  const o = { kind: s.kind, temp: s.temp, rollouts: s.rollouts, depth: s.depth, opt: s.opt };
  if (s.w) o.w = packWeights(s.w);
  return o;
}

class Arena {
  constructor(n) {
    this.n = n || Math.max(1, Math.min(4, os.cpus().length));
    this.workers = [];
    for (let i = 0; i < this.n; i++) {
      this.workers.push(new Worker(path.join(__dirname, 'arenaWorker.js'), { workerData: { seed: 1000 + i } }));
    }
  }
  // a を1人、b を3人にして games 局
  async match(a, b, games, seed) {
    const per = Math.ceil(games / this.n / 4) * 4;      // 席の回転がそろうよう4の倍数で配る
    const jobs = [];
    let sent = 0;
    for (let i = 0; i < this.n && sent < games; i++) {
      const cnt = Math.min(per, games - sent);
      const off = sent;
      sent += cnt;
      jobs.push(new Promise((res, rej) => {
        const wk = this.workers[i];
        const onMsg = m => { wk.off('error', onErr); res(m); };
        const onErr = e => { wk.off('message', onMsg); rej(e); };
        wk.once('message', onMsg); wk.once('error', onErr);
        wk.postMessage({ a: packSeat(a), b: packSeat(b), games: cnt, offset: off, seed: (seed || 1) + i * 7919 });
      }));
    }
    const parts = await Promise.all(jobs);
    let win = 0, reward = 0, n = 0;
    for (const p of parts) { win += p.win; reward += p.reward; n += p.games; }
    return { win: win / n, reward: reward / n, games: n };
  }
  /* a と b を両向きに戦わせ、勝ち分の差を返す。
     差 > 0 なら a のほうが強い。標準誤差もつける。 */
  async duel(a, b, games, seed) {
    const ab = await this.match(a, b, games, seed || 4242);
    const ba = await this.match(b, a, games, (seed || 4242) + 1);
    const diff = ab.win - ba.win;
    const se = Math.sqrt(0.25 * 0.75 / ab.games + 0.25 * 0.75 / ba.games);
    return { a: ab.win, b: ba.win, diff, se, games: ab.games + ba.games };
  }
  close() { for (const w of this.workers) w.terminate(); }
}

module.exports = { Arena, H };

/* 直接実行したときは、埋め込み済みネットの先読み vs 素の方策 を測って動作確認する */
if (require.main === module) {
  (async () => {
    const api = H.api();
    const net = api.agentNet();
    const w = { h1: net.h1, h2: net.h2, W1: net.W1, B1: net.B1, W2: net.W2, B2: net.B2, W3: net.W3, B3: net.B3 };
    const ar = new Arena();
    const t = Date.now();
    const r = await ar.match({ kind: 'search', w, temp: 0.85 }, { kind: 'cpu' }, 600, 4250);
    console.log('先読み1人 vs 既存CPU3人 → ' + r.win.toFixed(3) + '（互角 0.250、' + r.games + '局、' +
      ((Date.now() - t) / 1000).toFixed(0) + '秒、ワーカー' + ar.n + '本）');
    ar.close();
  })();
}
