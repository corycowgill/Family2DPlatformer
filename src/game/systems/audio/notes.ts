/**
 * Pure music math for the chiptune sequencer (no Phaser / WebAudio imports, unit-tested in Node).
 *
 * Pattern notation (one token per step, a step is a 16th note by default):
 *   `C5`      note C in octave 5 for 1 step        `C#5:4` / `Bb4:3` note lasting 4 / 3 steps
 *   `-`       extend the previous note by 1 step   `.`  rest 1 step     `.:4`  rest 4 steps
 * Tokens are separated by whitespace; `|` bar lines are ignored (they are just for readability).
 */

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'A4' → 69, 'C#5' → 73, 'Bb3' → 58. Throws on malformed input. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note "${name}"`);
  const base = NOTE_OFFSETS[m[1].toUpperCase()];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToFreq(name: string): number {
  return midiToFreq(noteToMidi(name));
}

/** Frequency ratio for a pitch shift in semitones. */
export function semitoneRatio(semis: number): number {
  return Math.pow(2, semis / 12);
}

/** Seconds per step (16th note when stepsPerBeat = 4). */
export function stepSeconds(bpm: number, stepsPerBeat = 4): number {
  return 60 / bpm / stepsPerBeat;
}

/** Exact sample count of `bars` bars — used so music loops land precisely on the bar line. */
export function barsToSamples(bars: number, bpm: number, sampleRate: number, beatsPerBar = 4): number {
  return Math.round((bars * beatsPerBar * 60 * sampleRate) / bpm);
}

/** Sample index where `step` starts (rounded, so long songs never drift). */
export function stepToSample(step: number, bpm: number, sampleRate: number, stepsPerBeat = 4): number {
  return Math.round((step * 60 * sampleRate) / (bpm * stepsPerBeat));
}

export interface NoteEvent {
  /** Start step from the beginning of the song. */
  step: number;
  /** Length in steps. */
  len: number;
  midi: number;
  /** Optional per-note velocity 0..1. */
  vel?: number;
}

/** Parse a pattern string into note events starting at `offset` steps. Returns events and total step count. */
export function parsePattern(src: string, offset = 0, transpose = 0): { events: NoteEvent[]; steps: number } {
  const events: NoteEvent[] = [];
  let step = offset;
  let last: NoteEvent | null = null;
  for (const raw of src.split(/\s+/)) {
    const tok = raw.trim();
    if (!tok || tok === '|') continue;
    const [head, lenStr] = tok.split(':');
    const len = lenStr ? Number(lenStr) : 1;
    if (!Number.isFinite(len) || len <= 0) throw new Error(`Bad length in "${tok}"`);
    if (head === '-') {
      if (last) last.len += len;
      step += len;
    } else if (head === '.') {
      last = null;
      step += len;
    } else {
      last = { step, len, midi: noteToMidi(head) + transpose };
      events.push(last);
      step += len;
    }
  }
  return { events, steps: step - offset };
}

const CHORD_SHAPES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '5': [0, 7],
};

/** 'Am' → [57, 60, 64] (root in octave 3 by default); 'F#7' → 4-note chord. */
export function chordNotes(name: string, octave = 3): number[] {
  const m = /^([A-G][#b]?)(.*)$/.exec(name.trim());
  if (!m) throw new Error(`Bad chord "${name}"`);
  const shape = CHORD_SHAPES[m[2]];
  if (!shape) throw new Error(`Unknown chord quality "${m[2]}" in "${name}"`);
  const root = noteToMidi(`${m[1]}${octave}`);
  return shape.map((s) => root + s);
}

/** Chord root midi note. */
export function chordRoot(name: string, octave = 2): number {
  return chordNotes(name, octave)[0];
}

/**
 * Expand a chord progression into a per-bar list. Each entry is one bar, or `'F Dm'`
 * for a bar split into equal halves. Returns [{chord, step, len}].
 */
export function expandProgression(bars: string[], stepsPerBar = 16): { chord: string; step: number; len: number }[] {
  const out: { chord: string; step: number; len: number }[] = [];
  bars.forEach((bar, i) => {
    const parts = bar.trim().split(/\s+/);
    const len = stepsPerBar / parts.length;
    parts.forEach((chord, j) => out.push({ chord, step: i * stepsPerBar + j * len, len }));
  });
  return out;
}

/** Deterministic PRNG (mulberry32) so generated audio is identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
