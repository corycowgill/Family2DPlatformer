import { describe, expect, it } from 'vitest';
import {
  barsToSamples, chordNotes, expandProgression, midiToFreq, noteToFreq, noteToMidi, parsePattern, stepToSample,
} from '../../src/game/systems/audio/notes';
import { envelopeAt, renderSfx, renderSong, renderTone, type Song } from '../../src/game/systems/audio/synth';
import { SFX_DEFS } from '../../src/game/systems/audio/sfxDefs';
import { ONE_SHOT_MUSIC, SONGS, chordRhythm, drums, melody } from '../../src/game/systems/audio/songs';

const REQUIRED_SFX = [
  'jump', 'land', 'coin', 'stomp', 'hurt', 'die', 'powerup', 'oneup', 'secret', 'checkpoint', 'goal', 'bump',
  'enemy-hit', 'enemy-defeat', 'enemy-shoot', 'ability-groundpound', 'ability-airjump', 'ability-dash',
  'ability-shoot', 'ability-sniff', 'break', 'boss-roar', 'explosion', 'train-horn', 'menu-move', 'menu-select', 'pause',
];
const REQUIRED_MUSIC = ['title', 'streets', 'elevated', 'riverwalk', 'boss', 'victory', 'map'];

describe('note math', () => {
  it('converts note names to midi and frequency', () => {
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C#5')).toBe(73);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(noteToFreq('A5')).toBeCloseTo(880);
    expect(noteToFreq('C4')).toBeCloseTo(261.63, 1);
    expect(() => noteToMidi('H2')).toThrow();
  });

  it('computes exact bar lengths and step positions', () => {
    expect(barsToSamples(1, 120, 32000)).toBe(64000); // 4 beats * 0.5s
    expect(barsToSamples(16, 144, 32000)).toBe(Math.round((16 * 4 * 60 * 32000) / 144));
    expect(stepToSample(4, 120, 32000)).toBe(16000); // one beat
    expect(stepToSample(16, 120, 32000)).toBe(barsToSamples(1, 120, 32000));
  });

  it('parses patterns with lengths, holds and rests', () => {
    const { events, steps } = parsePattern('C5:2 - . E5 .:3 G5:4', 16, 12);
    expect(steps).toBe(12);
    expect(events).toEqual([
      { step: 16, len: 3, midi: 84 },
      { step: 20, len: 1, midi: 88 },
      { step: 24, len: 4, midi: 91 },
    ]);
  });

  it('builds chords and progressions', () => {
    expect(chordNotes('C', 4)).toEqual([60, 64, 67]);
    expect(chordNotes('Am', 3)).toEqual([57, 60, 64]);
    expect(chordNotes('G7', 3)).toEqual([55, 59, 62, 65]);
    expect(() => chordNotes('Cwhat')).toThrow();
    expect(expandProgression(['C', 'F G'])).toEqual([
      { chord: 'C', step: 0, len: 16 },
      { chord: 'F', step: 16, len: 8 },
      { chord: 'G', step: 24, len: 8 },
    ]);
  });

  it('melody() rejects bars that are not 16 steps', () => {
    expect(() => melody(['C5:4 D5:4'])).toThrow(/Bar 1/);
    expect(melody(['C5:16']).length).toBe(1);
  });

  it('chordRhythm and drums generate events on the grid', () => {
    const bass = chordRhythm(['C'], 'R.5.O-..........', 2);
    expect(bass.map((e) => [e.step, e.midi, e.len])).toEqual([[0, 36, 1], [2, 43, 1], [4, 48, 2]]);
    const d = drums(2, { k: 'x...............', s: ['....X...........', '................'] });
    expect(d.filter((h) => h.kind === 'k').map((h) => h.step)).toEqual([0, 16]);
    expect(d.filter((h) => h.kind === 's')).toEqual([{ step: 4, kind: 's', vel: 1 }]);
  });
});

describe('synth', () => {
  it('envelope rises, sustains and releases to zero', () => {
    const t = { wave: 'pulse' as const, freq: 440, dur: 0.2, attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1 };
    expect(envelopeAt(0, t)).toBe(0);
    expect(envelopeAt(0.01, t)).toBeCloseTo(1);
    expect(envelopeAt(0.15, t)).toBeCloseTo(0.5);
    expect(envelopeAt(0.31, t)).toBe(0);
  });

  it('wraps tails around for loops', () => {
    const buf = new Float32Array(100);
    renderTone(buf, 1000, 90, { wave: 'pulse', freq: 50, dur: 0.05, release: 0.01 }, true);
    expect(buf.slice(0, 40).some((v) => v !== 0)).toBe(true);
  });

  it('renders every required sound effect', () => {
    for (const k of REQUIRED_SFX) expect(SFX_DEFS[k], k).toBeDefined();
    for (const [k, def] of Object.entries(SFX_DEFS)) {
      const pcm = renderSfx(def, 22050);
      expect(pcm.length, k).toBeGreaterThan(100);
      expect(pcm.length, k).toBeLessThan(22050 * 2.5);
      let peak = 0;
      let finite = true;
      for (let i = 0; i < pcm.length; i++) {
        if (!Number.isFinite(pcm[i])) finite = false;
        peak = Math.max(peak, Math.abs(pcm[i]));
      }
      expect(finite, k).toBe(true);
      expect(peak, k).toBeLessThanOrEqual(1);
      expect(peak, k).toBeGreaterThan(0.1);
    }
  });

  it('renders every song; looping songs are exactly N bars long', () => {
    for (const k of REQUIRED_MUSIC) expect(SONGS[k], k).toBeDefined();
    const sr = 16000;
    const t0 = performance.now();
    for (const [k, make] of Object.entries(SONGS)) {
      const song: Song = make();
      expect(song.loop, k).toBe(!ONE_SHOT_MUSIC.has(k));
      const pcm = renderSong(song, sr);
      if (song.loop) expect(pcm.length, k).toBe(barsToSamples(song.bars, song.bpm, sr));
      let peak = 0;
      for (let i = 0; i < pcm.length; i += 7) peak = Math.max(peak, Math.abs(pcm[i]));
      expect(peak, k).toBeGreaterThan(0.2);
      expect(peak, k).toBeLessThanOrEqual(1);
      // All notes must be in a sane audible range.
      for (const tr of song.tracks) for (const e of tr.events) expect(e.midi, k).toBeGreaterThanOrEqual(24);
      for (const tr of song.tracks) for (const e of tr.events) expect(e.midi, k).toBeLessThanOrEqual(100);
    }
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
