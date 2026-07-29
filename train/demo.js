'use strict';
/* 学習AI同士の1局を棋譜として出力する（挙動の目視確認用）
     node train/demo.js [seed] */

const H = require('./harness');
const api = H.api();
const rnd = H.useRng(Number(process.argv[2] || 7));
const net = api.agentNet();
if (!net) { console.log('index.html に重みが埋め込まれていない'); process.exit(1); }

const G = api.createGame(['甲', '乙', '丙', '丁'], H.PERSONAS);
let guard = 0;
while (G.phase !== 'over') {
  if (++guard > 4000) break;
  if (G.phase === 'faux') { api.resolveFaux(G, api.cpuFauxChoice(G.players[G.pending.player])); continue; }
  const p = G.players[G.actor];
  const mv = api.agentMove(G);
  if (mv.pass) api.applyPass(G, p); else api.applyBid(G, p, mv.idxs);
}

for (const l of G.log.slice().reverse()) console.log((l.cls === 'mark' ? '* ' : '  ') + l.text);
const t = api.finalTable(G);
console.log('\n' + '名'.padEnd(4) + ' 高級品         得点  残金');
for (const r of t.rows) {
  const p = r.p;
  console.log(p.name.padEnd(4) + ' [' + p.lux.slice().sort((a, b) => a - b).join(',').padEnd(12) + '] ' +
    String(r.score).padStart(5) + ' ' + String(r.money).padStart(5) + (r.castOut ? '  ←残金最少で脱落' : '') +
    (p.prestige ? '  ×' + Math.pow(2, p.prestige) : '') + (p.scandal ? '  ÷2' : '') + (p.passe ? '  −5' : ''));
}
console.log('\n' + (t.winner ? t.winner.name + ' の勝ち' : t.allOut ? '全員脱落' : '引き分け'));
