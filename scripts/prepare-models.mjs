// Turns Quaternius' Universal Animation Library .glb into the game's trimmed character
// asset: the Mannequin mesh and skeleton plus only the animations the game uses.
//
// Usage (after downloading "Universal Animation Library[Standard].zip" from
// https://quaternius.itch.io/universal-animation-library and extracting UAL1_Standard.glb):
//   node scripts/prepare-models.mjs path/to/UAL1_Standard.glb
// Writes public/models/mannequin.glb. See ASSETS.md for the licence (CC0).
//
// Ported from ../penalty-shootout. It needs glTF Transform, which this project doesn't
// install until it's wanted: npm install -D @gltf-transform/core @gltf-transform/functions

import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';

const KEEP = ['Idle_Loop', 'Jog_Fwd_Loop', 'Dance_Loop'];

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/prepare-models.mjs path/to/UAL1_Standard.glb');
  process.exit(1);
}
const output = 'public/models/mannequin.glb';

const io = new NodeIO();
const doc = await io.read(input);
for (const animation of doc.getRoot().listAnimations()) {
  if (KEEP.includes(animation.getName())) continue;
  // Disposing an animation leaves its channels and samplers (and their data) behind.
  for (const channel of animation.listChannels()) channel.dispose();
  for (const sampler of animation.listSamplers()) sampler.dispose();
  animation.dispose();
}
const kept = doc.getRoot().listAnimations().map((a) => a.getName());
const missing = KEEP.filter((name) => !kept.includes(name));
if (missing.length) throw new Error(`Animations not found in ${input}: ${missing.join(', ')}`);

// Thin out redundant keyframes, then drop everything no longer referenced and merge duplicates.
await doc.transform(resample(), prune(), dedup());
// Anything still referenced only by the root is unused data.
for (const accessor of doc.getRoot().listAccessors()) {
  if (accessor.listParents().length === 1) accessor.dispose();
}

mkdirSync('public/models', { recursive: true });
await io.write(output, doc);
console.log(`${output}: ${(statSync(output).size / 1024).toFixed(0)} KB, animations: ${kept.join(', ')}`);
