// Match statistics for tuning the AI: `npm run stats`. Not part of `npm test`.
// SEEDS=1,2,3 picks the matches; WATCH=chase:10 prints the situation whenever a player
// has been in that state for that many seconds (handy for finding where the AI sticks).
import { it } from 'vitest';
import type { LevelName } from '../../src/config';
import { Sim } from '../../src/sim/sim';
import { fullLineup } from '../../src/team/lineup';

// Vitest runs this under Node; the project doesn't pull in Node's types for one line.
declare const process: { env: Record<string, string | undefined> };

const SEEDS = (process.env.SEEDS ?? '1,2,3,4').split(',').map(Number);
const WATCH = process.env.WATCH;
/** LEVELS=hard,easy sets the home and away levels. */
const LEVELS = (process.env.LEVELS ?? 'normal,normal').split(',') as [LevelName, LevelName];

it('prints match statistics', async () => {
  for (const seed of SEEDS) {
    const sim = await Sim.create({ seed, players: fullLineup(), ai: true, kickoff: true, levels: LEVELS });
    const perTeam = [0, 1].map(() => ({ shots: 0, wild: 0, passes: 0, saves: 0, goals: 0 }));
    const wildBy: Record<string, number> = {};
    const goalFrom: Record<string, number> = {};
    let lastKick = 'none';
    const counts: Record<string, number> = {};
    const longest: Record<string, number> = {};
    let lastTeam: 0 | 1 | null = null;
    let turnovers = 0;
    let printed = 0;
    for (let i = 0; i < 60 * 60 * 10 && !sim.match.over; i++) {
      for (const e of sim.step([])) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
        if (e.type === 'kick') perTeam[sim.players[e.player].team][e.kind === 'shoot' ? (e.atGoal ? 'shots' : 'wild') : 'passes']++;
        if (e.type === 'save') perTeam[sim.players[e.player].team].saves++;
        if (e.type === 'kick' && e.kind === 'shoot' && !e.atGoal) {
          const role = sim.players[e.player].spec.role;
          wildBy[role] = (wildBy[role] ?? 0) + 1;
        }
        if (e.type === 'kick') lastKick = `${e.kind}${e.atGoal ? '' : e.kind === 'shoot' ? '(wild)' : ''} by ${sim.players[e.player].team === 0 ? 'home' : 'away'} ${sim.players[e.player].spec.role}`;
        if (e.type === 'goal') {
          perTeam[e.team].goals++;
          const key = `${e.team === 0 ? 'home' : 'away'} goal after ${lastKick}`;
          goalFrom[key] = (goalFrom[key] ?? 0) + 1;
        }
      }
      const o = sim.possession.owner;
      if (o !== null) {
        if (lastTeam !== null && sim.players[o].team !== lastTeam) turnovers++;
        lastTeam = sim.players[o].team;
      }
      sim.ai!.states.forEach((s, id) => {
        const held = (sim.tick - sim.ai!.since[id]) / 60;
        if (s.kind !== 'hold' && s.kind !== 'keeper') longest[s.kind] = Math.max(longest[s.kind] ?? 0, held);
        if (!WATCH || printed >= 4) return;
        const [kind, seconds] = WATCH.split(':');
        if (s.kind !== kind || Math.abs(held - Number(seconds)) > 0.01) return;
        printed++;
        const p = sim.players[id];
        const b = sim.ball.translation();
        const v = sim.ball.linvel();
        console.log(
          `seed ${seed} t=${(sim.tick / 60).toFixed(1)} player ${id} (${p.spec.role}, team ${p.team}) at (${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)})`,
          `state ${JSON.stringify(s)} ball (${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)}) v (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) owner ${sim.possession.owner}`,
        );
        console.log('   ' + sim.players.map((q) => `${q.id}:${sim.ai!.states[q.id].kind}(${q.pos.x.toFixed(1)},${q.pos.z.toFixed(1)})`).join(' '));
      });
    }
    const round = Object.fromEntries(Object.entries(longest).map(([k, v]) => [k, +v.toFixed(1)]));
    console.log(`seed ${seed} (${LEVELS.join(" v ")}): score ${sim.match.score.join("-")}, ${(sim.tick / 3600).toFixed(1)} min, ${turnovers} turnovers, per team ${JSON.stringify(perTeam)}, wild shots by role ${JSON.stringify(wildBy)}, goals ${JSON.stringify(goalFrom)}`, JSON.stringify(counts), "longest", JSON.stringify(round));
  }
});
