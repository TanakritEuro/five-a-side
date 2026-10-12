import { describe, expect, it } from 'vitest';

/** Everything that must run headless and deterministically (CLAUDE.md, Architecture). */
const SOURCES = import.meta.glob<string>(
  [
    '../src/sim/**/*.ts',
    '../src/ball/**/*.ts',
    '../src/team/**/*.ts',
    '../src/ai/**/*.ts',
    '../src/physics.ts',
    '../src/math.ts',
    '../src/constants.ts',
    '../src/config.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]three['"]/, 'imports three'],
  [/\bwindow\b/, 'uses window'],
  [/\bdocument\b/, 'uses document'],
  [/\bperformance\.now\b/, 'reads the wall clock'],
  [/\bDate\.now\b/, 'reads the wall clock'],
  [/\bMath\.random\b/, 'uses Math.random instead of the seeded RNG'],
  [/from\s+['"](?:\.\.?\/)+(?:scene|camera|game|render|ui|input|audio|characters)\b/, 'imports presentation code'],
];

/** Source without comments, so prose like "never Math.random" doesn't trip the check. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('simulation purity', () => {
  const files = Object.keys(SOURCES);

  it('finds the simulation sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s has no presentation, DOM, wall-clock or unseeded randomness', (file) => {
    const src = code(SOURCES[file]);
    const problems = FORBIDDEN.filter(([re]) => re.test(src)).map(([, why]) => why);
    expect(problems).toEqual([]);
  });
});
