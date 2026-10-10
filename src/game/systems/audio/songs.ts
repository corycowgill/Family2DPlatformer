/**
 * Original chiptune compositions for Chicago Family Adventure.
 * Written with the tiny pattern notation in notes.ts; each looping song is an exact
 * number of bars so it loops seamlessly.
 */
import { chordNotes, expandProgression, parsePattern, type NoteEvent } from './notes';
import type { DrumHit, DrumKind, Instrument, Song, SongTrack } from './synth';

// ------------------------------------------------------------------ instruments

export const INST = {
  /** Brass-like lead: 25% pulse, quick scoop into the note, delayed vibrato. */
  brass: { wave: 'pulse', duty: 0.25, attack: 0.008, decay: 0.12, sustain: 0.72, release: 0.06, vol: 0.34, vibRate: 5.5, vibDepth: 0.18, vibDelay: 0.12, scoop: 1, gate: 0.9 },
  lead: { wave: 'pulse', duty: 0.5, attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.05, vol: 0.24, vibRate: 5, vibDepth: 0.15, vibDelay: 0.15, gate: 0.88 },
  pad: { wave: 'pulse', duty: 0.125, attack: 0.08, decay: 0.3, sustain: 0.6, release: 0.2, vol: 0.18, vibRate: 4, vibDepth: 0.12, gate: 0.97 },
  flute: { wave: 'triangle', stepped: false, attack: 0.03, decay: 0.15, sustain: 0.8, release: 0.12, vol: 0.55, vibRate: 5, vibDepth: 0.22, vibDelay: 0.1, gate: 0.9 },
  echo: { wave: 'pulse', duty: 0.125, attack: 0.01, decay: 0.12, sustain: 0.5, release: 0.1, vol: 0.1, gate: 0.85 },
  bass: { wave: 'triangle', attack: 0.003, decay: 0.06, sustain: 0.9, release: 0.03, vol: 0.62, gate: 0.85 },
  pulseBass: { wave: 'pulse', duty: 0.5, attack: 0.003, decay: 0.05, sustain: 0.7, release: 0.02, vol: 0.2, lpStart: 1100, gateSteps: 0.75 },
  arp: { wave: 'pulse', duty: 0.125, attack: 0.002, decay: 0.05, sustain: 0.35, release: 0.03, vol: 0.12, gateSteps: 0.8 },
  stab: { wave: 'pulse', duty: 0.5, attack: 0.002, decay: 0.06, sustain: 0.35, release: 0.03, vol: 0.09, gateSteps: 0.9 },
} satisfies Record<string, Instrument>;

// ------------------------------------------------------------------ builders

/** Melody from one pattern string per bar; throws if a bar isn't exactly 16 steps. */
export function melody(bars: string[], transpose = 0, startBar = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  bars.forEach((b, i) => {
    const { events, steps } = parsePattern(b, (startBar + i) * 16, transpose);
    if (steps !== 16) throw new Error(`Bar ${startBar + i + 1} has ${steps} steps: "${b}"`);
    out.push(...events);
  });
  return out;
}

/**
 * Rhythm string per chord segment: R root, 3 third, 5 fifth, 7 seventh/top, O octave,
 * '-' hold previous, '.' rest. Only the first `len` characters are used for half-bar chords.
 */
export function chordRhythm(progression: string[], rhythm: string, octave: number, mode: 'bass' | 'arp' | 'stab' = 'bass'): NoteEvent[] {
  const out: NoteEvent[] = [];
  let arpIdx = 0;
  for (const seg of expandProgression(progression)) {
    const tones = chordNotes(seg.chord, octave);
    const pick = (c: string): number[] => {
      switch (c) {
        case 'R': return [tones[0]];
        case '3': return [tones[1]];
        case '5': return [tones[2]];
        case '7': return [tones[3] ?? tones[0] + 12];
        case 'O': return [tones[0] + 12];
        default: return [];
      }
    };
    let last: NoteEvent[] = [];
    for (let i = 0; i < seg.len; i++) {
      const c = rhythm[i % rhythm.length];
      const step = seg.step + i;
      if (c === '-') {
        last.forEach((e) => e.len++);
        continue;
      }
      if (c === '.') {
        last = [];
        continue;
      }
      let notes: number[];
      if (mode === 'arp') {
        const up = [...tones, tones[0] + 12, tones[1] + 12];
        notes = [up[arpIdx++ % up.length]];
      } else if (mode === 'stab') {
        notes = tones.slice(0, 3).map((t) => t + 12);
      } else {
        notes = pick(c);
      }
      last = notes.map((midi) => ({ step, len: 1, midi }));
      out.push(...last);
    }
  }
  return out;
}

type Lane = string | string[];
/**
 * Drum lanes, one 16-char string per bar (or an array cycled per bar).
 * 'X' accent, 'x' normal, 'g' ghost, anything else = silence.
 */
export function drums(bars: number, lanes: Partial<Record<DrumKind, Lane>>): DrumHit[] {
  const out: DrumHit[] = [];
  for (const [kind, lane] of Object.entries(lanes) as [DrumKind, Lane][]) {
    const list = Array.isArray(lane) ? lane : [lane];
    for (let b = 0; b < bars; b++) {
      const pat = list[b % list.length];
      if (pat.length !== 16) throw new Error(`Drum lane ${kind} must be 16 chars: "${pat}"`);
      for (let s = 0; s < 16; s++) {
        const c = pat[s];
        const vel = c === 'X' ? 1 : c === 'x' ? 0.75 : c === 'g' ? 0.35 : 0;
        if (vel) out.push({ step: b * 16 + s, kind, vel });
      }
    }
  }
  return out;
}

/** Copy events shifted by `steps` (wrapping inside `total` steps) at a lower velocity — an echo. */
export function delayed(events: NoteEvent[], steps: number, total: number, vel = 0.6): NoteEvent[] {
  return events.map((e) => ({ ...e, step: (e.step + steps) % total, vel }));
}

const track = (inst: Instrument, events: NoteEvent[]): SongTrack => ({ inst, events });

// ------------------------------------------------------------------ songs

function title(): Song {
  const prog = ['C', 'G', 'Am', 'F', 'C', 'G', 'F G', 'C'];
  return {
    bpm: 120, bars: 8, loop: true,
    tracks: [
      track(INST.brass, melody([
        'E5:2 G5:2 C6:4 B5:2 A5:2 G5:4',
        'D5:2 G5:2 B5:4 A5:2 G5:2 D5:4',
        'C5:2 E5:2 A5:4 G5:2 E5:2 C5:2 E5:2',
        'F5:4 A5:4 G5:2 F5:2 E5:2 D5:2',
        'E5:2 G5:2 C6:4 D6:2 C6:2 G5:4',
        'B5:2 D6:2 G6:4 F6:2 D6:2 B5:4',
        'A5:2 C6:2 A5:2 F5:2 G5:2 B5:2 D6:2 B5:2',
        'C6:8 G5:2 E5:2 C5:4',
      ])),
      track(INST.bass, chordRhythm(prog, 'R.O.R.O.R.O.5.O.', 2)),
      track(INST.arp, chordRhythm(prog, 'x.x.x.x.x.x.x.x.', 4, 'arp')),
    ],
    drums: drums(8, {
      k: 'x.....x.x.......',
      s: ['....x.......x...', '....x.......x...', '....x.......x...', '....x.......x.xx'],
      h: 'x.x.x.x.x.x.x.x.',
    }),
  };
}

function streets(): Song {
  const prog = ['F', 'F', 'Bb', 'C', 'F', 'Dm', 'Gm C', 'F', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F Dm', 'Gm C'];
  return {
    bpm: 144, bars: 16, loop: true,
    tracks: [
      track(INST.brass, melody([
        'C5:2 F5:2 A5:2 C6:4 A5:2 C6:2 .:2',
        'Bb5:2 A5:2 G5:2 F5:2 G5:4 .:4',
        'D5:2 F5:2 Bb5:2 D6:4 C6:2 Bb5:2 .:2',
        'A5:2 G5:2 E5:2 C5:2 E5:2 G5:2 C6:4',
        'C6:2 .:1 C6:1 A5:2 F5:2 C6:4 D6:2 C6:2',
        'F5:2 A5:2 D6:4 C6:2 A5:2 F5:4',
        'G5:2 Bb5:2 D6:2 Bb5:2 C6:2 E5:2 G5:2 Bb5:2',
        'A5:4 F5:2 C5:2 F5:6 .:2',
        'D6:3 C6:1 Bb5:2 F5:2 D5:2 F5:2 Bb5:4',
        'C6:3 Bb5:1 A5:2 G5:2 E5:2 G5:2 C6:4',
        'A5:2 C6:2 E6:4 D6:2 C6:2 A5:4',
        'F5:2 A5:2 D6:4 E6:2 F6:2 D6:4',
        'Bb5:2 D6:2 G6:4 F6:2 D6:2 Bb5:4',
        'C6:2 E6:2 G6:4 F6:2 E6:2 C6:4',
        'A5:2 C6:2 F6:4 D6:2 A5:2 F5:4',
        'G5:4 Bb5:2 D6:2 C6:4 E5:2 G5:2',
      ])),
      track(INST.stab, chordRhythm(prog, '..x...x...x...x.', 3, 'stab')),
      track(INST.bass, chordRhythm(prog, 'R.R.5.O.R.R.5.O.', 2)),
    ],
    drums: drums(16, {
      k: 'x.....x...x.....',
      s: ['....x.......x..g', '....x.......x..g', '....x.......x..g', '....x.......x.xx'],
      h: 'x.x.x.x.x.x.x.x.',
      c: ['x...............', '................', '................', '................', '................', '................', '................', '................'],
    }),
  };
}

function elevated(): Song {
  const half = ['Em', 'C', 'D', 'Bm', 'Em', 'C', 'D', 'B7'];
  const prog = [...half, ...half];
  return {
    bpm: 156, bars: 16, loop: true,
    tracks: [
      track(INST.pad, melody(['B4:16', 'C5:16', 'D5:16', 'D5:16', 'B4:16', 'E5:16', 'F#5:16', 'D#5:16'])),
      track(INST.brass, melody([
        'E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 G5:2 B5:2',
        'C6:4 B5:2 G5:2 E5:4 G5:4',
        'F#5:2 A5:2 D6:2 F#6:2 E6:2 D6:2 A5:2 F#5:2',
        'B5:6 A5:2 F#5:4 D5:4',
        'E5:2 E5:1 E5:1 G5:2 B5:2 E6:4 D6:4',
        'E6:2 D6:2 C6:2 B5:2 G5:4 E5:4',
        'F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:4',
        'D#6:4 F#5:4 B5:4 A5:4',
      ], 0, 8)),
      track(INST.pulseBass, chordRhythm(prog, 'RRORRRORRRORRROR', 2)),
      track(INST.bass, chordRhythm(prog, 'R.......R.......', 1)),
      track(INST.arp, chordRhythm(prog, 'xxxxxxxxxxxxxxxx', 4, 'arp')),
    ],
    drums: drums(16, {
      k: 'x...x...x...x...',
      s: ['....x.......x...', '....x.......x...', '....x.......x...', '....x.......x...', '....x.......x...', '....x.......x...', '....x.......x...', '....x...x.xxXXXX'],
      h: 'xgxgxgxgxgxgxgxg',
    }),
  };
}

function riverwalk(): Song {
  const prog = ['Gmaj7', 'Em7', 'Cmaj7', 'D', 'Gmaj7', 'Em7', 'Am7', 'D7', 'Cmaj7', 'Bm7', 'Am7', 'D', 'Gmaj7', 'Em7', 'Am7 D7', 'G'];
  const lead = melody([
    'B5:4 D6:2 F#6:2 D6:4 B5:4',
    'G5:6 A5:2 B5:4 E5:4',
    'E6:4 D6:2 B5:2 G5:4 E5:4',
    'F#5:6 E5:2 D5:4 A5:4',
    'B5:4 D6:2 G6:2 F#6:4 D6:4',
    'E6:6 D6:2 B5:4 G5:4',
    'A5:4 C6:2 E6:2 D6:4 C6:4',
    'A5:8 F#5:4 .:4',
    'G5:2 B5:2 E6:4 D6:2 B5:2 G5:4',
    'F#5:2 A5:2 D6:4 B5:2 A5:2 F#5:4',
    'E5:2 A5:2 C6:4 B5:2 A5:2 E5:4',
    'F#5:4 A5:4 D6:4 C6:4',
    'B5:6 A5:2 G5:4 D5:4',
    'E5:4 G5:4 B5:4 D6:4',
    'C6:4 A5:4 F#5:4 A5:4',
    'G5:12 .:4',
  ]);
  return {
    bpm: 116, bars: 16, loop: true,
    tracks: [
      track(INST.flute, lead),
      track(INST.echo, delayed(lead, 3, 16 * 16, 0.8)),
      track(INST.bass, chordRhythm(prog, 'R..5..R.R..5..O.', 2)),
      track(INST.arp, chordRhythm(prog, 'x..x..x.x..x..x.', 4, 'arp')),
    ],
    drums: drums(16, {
      k: 'x..x....x..x....',
      s: '....g.......g...',
      h: 'gxgxgxgxgxgxgxgx',
    }),
    gain: 0.75,
  };
}

function boss(): Song {
  const prog = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Gm', 'Bb', 'A7'];
  return {
    bpm: 168, bars: 8, loop: true,
    tracks: [
      track({ ...INST.brass, duty: 0.5, vol: 0.28 }, melody([
        'D5:2 F5:2 A5:2 D5:2 F5:2 A5:2 C#6:2 A5:2',
        'D6:4 C6:2 A5:2 Bb5:4 A5:4',
        'Bb5:2 D6:2 F6:2 D6:2 Bb5:2 F5:2 D5:2 F5:2',
        'E5:4 A5:4 C#6:4 E6:4',
        'F6:2 E6:2 D6:2 A5:2 F6:2 E6:2 D6:2 A5:2',
        'G5:2 Bb5:2 D6:2 G6:2 F6:2 D6:2 Bb5:2 G5:2',
        'F6:4 D6:4 Bb5:4 F5:4',
        'E6:2 C#6:2 A5:2 E5:2 G5:4 C#6:4',
      ])),
      track(INST.pulseBass, chordRhythm(prog, 'RRORRRORRRORRROR', 2)),
      track(INST.bass, chordRhythm(prog, 'R...R...R...R...', 1)),
      track({ ...INST.arp, vol: 0.08 }, chordRhythm(prog, 'x.xxx.xxx.xxx.xx', 4, 'arp')),
    ],
    drums: drums(8, {
      k: 'x..x..x.x..x..x.',
      s: '....x.......x...',
      h: 'x.x.x.x.x.x.x.x.',
      t: ['................', '................', '................', '............xxxx'],
    }),
  };
}

function map(): Song {
  const prog = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm G', 'C'];
  return {
    bpm: 100, bars: 8, loop: true,
    tracks: [
      track({ ...INST.lead, vol: 0.22 }, melody([
        'G5:4 E5:2 G5:2 C6:4 G5:4',
        'A5:4 C6:2 A5:2 E5:8',
        'F5:2 A5:2 C6:4 A5:4 F5:4',
        'G5:4 B5:2 D6:2 G5:8',
        'E6:4 D6:2 C6:2 G5:4 E5:4',
        'A5:2 B5:2 C6:4 E6:4 C6:4',
        'D6:4 A5:4 B5:4 D6:4',
        'C6:12 .:4',
      ])),
      track(INST.bass, chordRhythm(prog, 'R...3...5...3...', 2)),
      track({ ...INST.arp, vol: 0.08 }, chordRhythm(prog, '..x...x...x...x.', 4, 'arp')),
    ],
    drums: drums(8, { k: 'x.......x.......', s: '....g.......g...', h: '..x...x...x...x.' }),
    gain: 0.7,
  };
}

function victory(): Song {
  return {
    bpm: 150, bars: 2, loop: false,
    tracks: [
      track(INST.brass, melody(['C5:1 E5:1 G5:1 C6:3 G5:1 C6:1 E6:8', 'F6:2 E6:2 D6:2 E6:2 C6:8'])),
      track({ ...INST.lead, vol: 0.16 }, melody(['.:3 G5:3 E5:2 G5:8', 'A5:2 G5:2 F5:2 G5:2 E5:8'])),
      track(INST.bass, melody(['C3:6 G2:2 C3:8', 'F2:4 G2:4 C3:8'])),
    ],
    drums: drums(2, { k: ['x.....x.........', 'x.......x.......'], s: ['................', 'x.x.x.x.........'], c: ['x...............', '........x.......'] }),
  };
}

function gameover(): Song {
  return {
    bpm: 92, bars: 2, loop: false,
    tracks: [
      track({ ...INST.lead, vol: 0.3 }, melody(['G5:3 F#5:3 F5:3 E5:7', 'D5:3 E5:1 C5:12'])),
      track(INST.bass, melody(['C3:8 Ab2:8', 'G2:8 C2:8'])),
    ],
  };
}

function worldclear(): Song {
  const prog = ['C', 'G', 'C F', 'C'];
  return {
    bpm: 140, bars: 4, loop: false,
    tracks: [
      track(INST.brass, melody([
        'G5:2 G5:1 G5:1 C6:4 E6:4 G6:4',
        'F6:2 E6:2 D6:2 C6:2 D6:8',
        'E6:2 F6:2 G6:4 A6:2 G6:2 F6:4',
        'G6:12 .:4',
      ])),
      track({ ...INST.lead, vol: 0.15 }, melody([
        'E5:2 E5:1 E5:1 G5:4 C6:4 E6:4',
        'D6:2 C6:2 B5:2 G5:2 B5:8',
        'C6:2 C6:2 E6:4 F6:2 E6:2 C6:4',
        'E6:12 .:4',
      ])),
      track(INST.bass, chordRhythm(prog, 'R.O.R.O.5.O.R.O.', 2)),
      track(INST.arp, chordRhythm(prog, 'xxxxxxxxxxxxxxxx', 4, 'arp')),
    ],
    drums: drums(4, { k: 'x...x...x...x...', s: ['....x.......x...', '....x.......x...', '....x.......xxxx', 'X...............'], h: 'x.x.x.x.x.x.x.x.', c: ['x...............', '................', '................', 'x...............'] }),
  };
}

/** Song factories by music key (built lazily). */
export const SONGS: Record<string, () => Song> = {
  title, streets, elevated, riverwalk, boss, map, victory, gameover, worldclear,
};

/** Music keys that should not loop. */
export const ONE_SHOT_MUSIC = new Set(['victory', 'gameover', 'worldclear']);
