# Milestone 7 plan: online play (optional)

Goal: two people on two devices play each other, one team each, over the internet. Ported
from `../penalty-shootout/src/online/`: rooms with a four-letter code over PeerJS, and the
host runs the match. The guest sends its inputs and draws what the host sends.

## Status: done

Checked for real through the public PeerJS server, in two Chrome tabs:

- the host opened a room and the guest joined with its code;
- the guest's controls moved its player in the host's match (running at full jog);
- a pause from the guest paused both, and a resume from the host resumed both;
- when the guest quit, the host carried on with the AI running the guest's team;
- a wrong code said "No room with that code".

No console errors on either side. Across two devices on different networks is still to try.

Where the build differs from the plan below:

- **The menu and the game integration came in one commit,** not two. The menu's online
  row was needed to try the integration at all.
- **The recorder and replays work from snapshot ticks** now, not snapshot counts, because
  a guest's frames come every other step. Offline play is unchanged by it.
- **The host hangs up half a second after its last message** ("reject", "bye"). Closing
  at once could drop it, and the in-memory test link showed exactly that.
- **R (replay the last few seconds) isn't offered to the host,** since it would freeze
  the guest's match too. The guest can use it: it's local, and the guest catches up after.
- **Not done:**
  - a rematch button (both go back to the menu at full time);
  - prediction for the guest's own player;
  - a TURN relay for networks where peer-to-peer can't connect.

## Scope decisions

Decided with you: host-authoritative with no prediction; draws stand; a separate online
record; the public PeerJS server.

- **Host-authoritative, no prediction.** The host's simulation is the only one; the
  guest's keys reach it a network trip later. The guest sees everything about 100–200 ms
  behind: half a round trip, plus a short buffer that smooths out jitter. That's playable
  for a casual match, but the guest will feel it in quick exchanges. The alternative is
  predicting the guest's own player on the guest's device. It's much more work, and
  corrections show as the player snapping back.
- **Online friendlies only:** the host picks their team and the half length; the guest
  picks theirs. The host is the home team. No cup online.
- **Draws** stand in an online friendly (no shootout), as in offline friendlies.
- **Replays and pauses are shared.** Both see the goal replays (the host starts them;
  either player can skip). Either player can pause, which pauses both.
- **Stats:** online results go into the lifetime record as well, marked separately
  ("online: W 2 D 0 L 1").
- **Signalling** uses the free public PeerJS server, as the penalty game does: it only
  introduces the two browsers; the game itself is peer to peer. If it's down, online play
  is unavailable (the rest of the game is unaffected).

## How it works

### Link (`src/online/link.ts`, ported)

Rooms are `five-a-side-1-XXXX` on the PeerJS server. There are two data channels, a
heartbeat, and clear messages when the server or the other player can't be reached.
`PROTOCOL` refuses mismatched versions.

### Messages (`src/online/protocol.ts`)

- **Guest → host:**
  - `hello` (version, team);
  - `input` (the guest's raw `Command`, every frame it changes, plus a heartbeat of the
    current one every 100 ms);
  - `skip` (a replay), `pause`, `resume`.
- **Host → guest:**
  - `welcome` (both teams, half length, seed);
  - `snapshot` (about 30 a second, unreliable channel): the packed `Snapshot` plus the
    team on the ball, for the guest's replays;
  - `events` (reliable): each step's `SimEvent`s, for the guest's sound, HUD, camera
    cuts and replays;
  - `replay` (start the goal replay for tick T, or stop), `pause` / `resume`, `bye`.
- **Validation:** every message is checked before use (as in the penalty game).

### Snapshots on the wire (`src/online/snapshots.ts`)

One `Float32Array` per snapshot: the tick, the ball (position and rotation), and for each
player position, facing, keeper pose, speed, charge and tackle, flags (sprinting,
holding), the action (kind, tick) and mood. About 500 bytes, 30 a second (15 KB/s).

### Host (`src/online/host.ts`)

The host runs the match as now, with a second `HumanControl` driving the guest's team
from the latest `input`. It sends a snapshot every other step and the events every step.
Replays and pauses happen on the host and are announced. If the link drops, the match
pauses with a message, and the host can carry on against the AI or leave.

### Guest (`src/online/guest.ts`)

The guest has no simulation. It keeps the snapshots it receives in a short buffer and
draws about 100 ms behind the newest, interpolating between the two either side. That
goes through the same `interpolate`, figures, director, nets, trail and sound as the host
(events drive the cues). Its recorder fills from those snapshots, so goal replays play
locally when the host says.

The camera, the marker and the HUD (score, clock, stamina) work from the snapshots and
events. The guest's controlled player and stamina come in each snapshot.

### Menu

An Online row: Host (shows a room code and waits) or Join (type a code), with your team
picked above. A connecting state, then a cancel button. Errors are explained.

## Files

| File | Contents |
| --- | --- |
| `package.json` | `peerjs` (as in the penalty game) |
| `src/online/link.ts` | Ported (prefix and messages changed) |
| `src/online/protocol.ts` | Messages and their validation |
| `src/online/snapshots.ts` | Packing and unpacking snapshots |
| `src/online/host.ts`, `guest.ts` | The two ends |
| `src/game.ts` | Online runs: the host's match with a remote team; the guest's view-only run |
| `src/ui/menu.ts` | The online row |
| `src/match/stats.ts` | Online results counted separately |

## Tests

| File | Asserts |
| --- | --- |
| `snapshots.test.ts` | A packed and unpacked snapshot equals the original (within float precision) for every field, over a seeded match |
| `protocol.test.ts` | Valid messages parse; malformed ones (wrong types, missing fields, out-of-range) are dropped |
| `online.test.ts` | A host and guest joined by an in-memory link: the guest's inputs move its team's player in the host's sim; the guest's buffered view follows the host's within a few steps; goal events reach the guest; a version mismatch is refused; a dropped link is reported |

Checking it for real needs two browsers. I can open two tabs in Chrome and play one
against the other, but I'll ask you to try it across two devices on different networks.

## Commits, in order

1. Plan (this file).
2. PeerJS, link, protocol, snapshot packing. Tests.
3. Host and guest over an in-memory link; game integration. Tests.
4. Menu, errors and disconnects; two-tab check in Chrome.
5. Docs, CLAUDE.md, playtest questions.

## Risks

- **Latency for the guest:** see the first decision. If it's too much, prediction for the
  guest's own player is the next step.
- **NAT traversal:** PeerJS uses public STUN only (no TURN relay). Some networks
  (corporate, some mobile carriers) won't connect; the error says so.
