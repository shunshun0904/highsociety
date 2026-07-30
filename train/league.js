'use strict';
/* リーグ戦による継続学習。
     node train/league.js --hours=3 --init=train/weights.json
     node train/league.js --mode=exploit --target=train/champion.json --hours=0.5

   通常モード:
     挑戦者を「現在の自分・歴代王者・既存CPU」の混成リーグで鍛え、一定間隔で
     王者と直接対決させる。勝ち越したら王座を交代し、旧王者はプールに残す。
     負けが続いたら王者の重みに引き戻す（迷走の防止）。
     時間の許すかぎり、これを延々と繰り返す。

   exploit モード:
     指定した相手だけを倒すための「専用エージェント」を鍛える。
     これがどれだけ勝てるかが、その相手の付け入る隙（exploitability）の大きさ。
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./harness');
const { Runner } = require('./runner');
const { match, duelField } = require('./evaluate');
const api = H.api();

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) argv[m[1]] = m[2];
}
const num = (k, d) => (argv[k] === undefined ? d : Number(argv[k]));

const CFG = {
  mode: argv.mode || 'league',
  h1: num('h1', 96), h2: num('h2', 64),
  hours: num('hours', 3),
  games: num('games', 768),
  gate: num('gate', 15),             // 何反復ごとに王者と直接対決するか
  workers: num('workers', Math.max(1, Math.min(4, os.cpus().length - 1))),
  epochs: num('epochs', 3),
  mb: num('mb', 1024),
  lr: num('lr', 2.5e-4),             // 終わりのない学習なので減衰させない
  clip: num('clip', 0.2),
  ent: num('ent', 0.008),
  vf: num('vf', 0.5),
  gamma: num('gamma', 1.0),
  lam: num('lam', 0.95),
  pot: num('pot', 0.5), potM: num('potM', 0.4),
  shape: num('shape', 0.0),          // 継続学習では立ち上がりは済んでいるので既定 0
  temp: num('temp', 1.0),
  pCpu: num('pCpu', 0.08),
  pPool: num('pPool', 0.34),         // 歴代王者と当たる割合
  poolMax: num('poolMax', 10),
  gateGames: num('gateGames', 4000),  // 対戦は学習より桁違いに軽いので厚くした（1ゲート約20秒）
  gateTemp: num('gateTemp', 0.6),
  margin: num('margin', 0.008),      // 王座交代に必要な差（対応のある比較にしたので下げた）
  gateSigma: num('gateSigma', 1.5),  // 差が標準誤差の何倍を超えたら交代とみなすか
  patience: num('patience', 4),      // 連敗がこれに達したら王者に引き戻す
  seed: num('seed', 424242),
  init: argv.init || path.join(__dirname, 'weights.json'),
  target: argv.target || null,
  out: argv.out || path.join(__dirname, 'champion.json'),
  log: argv.log || path.join(__dirname, 'league-log.json')
};
console.log('設定 ' + JSON.stringify(CFG));

api.agentSetShape(CFG.shape); api.agentSetPot(CFG.pot, CFG.potM);
const run = new Runner(CFG);
const base = H.loadWeights(CFG.init);
run.load(base);
console.log('出発点: ' + CFG.init);

// 比較の基準として据え置く「出発点のネット」と既存CPU
const gen0 = run.netOf(base);

let champion = run.weights();           // 現王者の重み
let championNet = run.netOf(champion);
let generation = 0, fails = 0;
const history = [];

/* --- exploit モード：相手を固定して、それだけを倒す方策を鍛える --- */
if (CFG.mode === 'exploit') {
  const tw = H.loadWeights(CFG.target || CFG.init);
  const targetNet = run.netOf(tw);
  run.pool = [tw];
  CFG.pCpu = 0; CFG.pPool = 1;          // 相手席は必ず対象エージェント
  console.log('対象: ' + (CFG.target || CFG.init) + ' ── これだけを倒す方策を鍛える');
  (async () => {
    const t0 = Date.now(), until = t0 + CFG.hours * 3600e3;
    let it = 0;
    while (Date.now() < until) {
      it++;
      const st = await run.iterate({ lr: CFG.lr, ent: CFG.ent, temp: CFG.temp, pCpu: 0, pPool: 1,
        shape: CFG.shape, pot: [CFG.pot, CFG.potM] });
      if (it % CFG.gate === 0 || Date.now() >= until) {
        const me = run.net();
        const a = match({ kind: 'net', net: me, temp: CFG.gateTemp }, { kind: 'net', net: targetNet, temp: CFG.gateTemp }, CFG.gateGames, 31337);
        console.log('#' + String(it).padStart(4) + '  専用AI1人 vs 対象3人 → 勝率 ' + a.win.toFixed(3) +
          ' ±' + a.se.toFixed(3) + '（互角なら 0.250）  自己勝率 ' + st.selfWin.toFixed(3) +
          '  エントロピー ' + st.ent.toFixed(3));
        history.push({ it, exploit: a.win });
        fs.writeFileSync(CFG.log.replace(/\.json$/, '-exploit.json'), JSON.stringify(history));
        run.save(CFG.out.replace(/\.json$/, '.exploiter.json'), { it, exploit: a.win });
      }
    }
    console.log('終了');
    run.close();
  })();
} else {
  /* --- リーグ戦モード --- */
  run.pool = [champion];
  (async () => {
    const t0 = Date.now(), until = t0 + CFG.hours * 3600e3;
    let it = 0;
    while (Date.now() < until) {
      it++;
      const st = await run.iterate({ lr: CFG.lr, ent: CFG.ent, temp: CFG.temp, pCpu: CFG.pCpu, pPool: CFG.pPool,
        shape: CFG.shape, pot: [CFG.pot, CFG.potM] });
      process.stdout.write('#' + String(it).padStart(4) + '  局 ' + st.games + '  自己勝率 ' + st.selfWin.toFixed(3) +
        '  価値損失 ' + st.vl.toFixed(4) + '  エントロピー ' + st.ent.toFixed(3) +
        '  [' + st.msR + '/' + st.msU + 'ms]\n');

      if (it % CFG.gate !== 0) continue;

      // 挑戦者 vs 王者。王者だらけの卓の1席だけを入れ替え、同一シード＝同じ配牌で判定する
      // （配牌と相手の顔ぶれが共通になるので、差のノイズが従来の 1/1.4 に落ちる）
      const me = run.net(), T = CFG.gateTemp, N = CFG.gateGames;
      const g = duelField({ kind: 'net', net: me, temp: T }, { kind: 'net', net: championNet, temp: T }, N, 900 + it);
      const diff = g.diff;
      const promoted = diff > CFG.margin && diff > CFG.gateSigma * g.se;

      let line = '  ── 王者の卓で 挑戦者 ' + g.a.toFixed(3) + ' / 王者 ' + g.b.toFixed(3) +
        '（差 ' + (diff >= 0 ? '+' : '') + diff.toFixed(3) + ' ±' + g.se.toFixed(3) +
        ' = ' + (diff / (g.se || 1e-9)).toFixed(1) + 'σ）';
      if (promoted) {
        generation++; fails = 0;
        champion = run.weights(); championNet = run.netOf(champion);
        run.pool.push(champion);
        if (run.pool.length > CFG.poolMax) run.pool.shift();
        // 出発点および既存CPUに対する現在地
        const vs0 = match({ kind: 'net', net: championNet, temp: T }, { kind: 'net', net: gen0, temp: T }, N, 555);
        const vsCpu = match({ kind: 'net', net: championNet, temp: T }, { kind: 'cpu' }, N, 777);
        line += '  → 第' + generation + '世代へ交代　[初代相手 ' + vs0.win.toFixed(3) +
          ' / 既存CPU相手 ' + vsCpu.win.toFixed(3) + ' ±' + vsCpu.se.toFixed(3) + ']';
        history.push({ it, generation, diff, se: g.se, vsGen0: vs0.win, vsCpu: vsCpu.win, minutes: (Date.now() - t0) / 60000 });
        run.save(CFG.out, { generation, it, vsGen0: vs0.win, vsCpu: vsCpu.win,
          shape: CFG.shape, pot: [CFG.pot, CFG.potM], history });
      } else {
        fails++;
        line += '  → 据え置き（連敗 ' + fails + '/' + CFG.patience + '）';
        if (fails >= CFG.patience) {
          run.load(champion); fails = 0;
          line += ' → 王者の重みに引き戻し';
        }
        history.push({ it, generation, diff, se: g.se, minutes: (Date.now() - t0) / 60000 });
      }
      console.log(line);
      fs.writeFileSync(CFG.log, JSON.stringify(history));
    }
    console.log('終了。第' + generation + '世代まで到達　保存: ' + CFG.out);
    run.close();
  })();
}
