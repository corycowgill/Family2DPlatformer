/**
 * Sound-effect recipes (original, synthesised at boot). Keys are what gameplay passes to
 * `audio.sfx(key)`; the cache key is `sfx-<key>`.
 */
import { noteToFreq as n } from './notes';
import type { SfxDef, Tone } from './synth';

const seq = (notes: string[], step: number, base: Omit<Tone, 'freq' | 'at'>): Tone[] =>
  notes.map((note, i) => ({ ...base, at: i * step, freq: n(note) }));

export const SFX_DEFS: Record<string, SfxDef> = {
  jump: {
    gain: 0.55,
    tones: [{ wave: 'pulse', duty: 0.25, freq: 240, freqEnd: 640, slideTime: 0.13, dur: 0.11, decay: 0.08, sustain: 0.6, release: 0.05 }],
  },
  land: {
    gain: 0.4,
    tones: [
      { wave: 'noise', freq: 4000, dur: 0.03, release: 0.05, lpStart: 2500, lpEnd: 600 },
      { wave: 'sine', freq: 140, freqEnd: 60, dur: 0.04, release: 0.03, vol: 0.6 },
    ],
  },
  coin: {
    gain: 0.5,
    tones: [
      { wave: 'pulse', duty: 0.5, freq: n('B5'), dur: 0.05, sustain: 0.8, release: 0.01 },
      { at: 0.055, wave: 'pulse', duty: 0.5, freq: n('E6'), dur: 0.08, decay: 0.2, sustain: 0.4, release: 0.18 },
    ],
  },
  stomp: {
    gain: 0.7,
    tones: [
      { wave: 'pulse', duty: 0.5, freq: 420, freqEnd: 110, dur: 0.09, release: 0.04 },
      { wave: 'noise', freq: 6000, dur: 0.02, release: 0.04, vol: 0.5, lpStart: 3000 },
    ],
  },
  hurt: {
    gain: 0.65,
    tones: [{ wave: 'pulse', duty: 0.5, freq: 560, freqEnd: 170, dur: 0.24, release: 0.06, vibRate: 28, vibDepth: 1.2 }],
  },
  die: {
    gain: 0.65,
    tones: [
      ...seq(['C5', 'G4', 'E4'], 0.11, { wave: 'pulse', duty: 0.5, dur: 0.09, release: 0.02 }),
      { at: 0.33, wave: 'pulse', duty: 0.5, freq: n('C4'), freqEnd: n('C3'), dur: 0.45, release: 0.2, vibRate: 7, vibDepth: 0.4 },
    ],
  },
  powerup: {
    gain: 0.6,
    tones: [
      { wave: 'pulse', duty: 0.25, freq: n('C5'), arp: [0, 4, 7, 12, 16, 19, 24, 28], arpRate: 22, dur: 0.36, sustain: 0.8, release: 0.1 },
      { wave: 'triangle', freq: n('C4'), freqEnd: n('C5'), dur: 0.36, release: 0.1, vol: 0.4 },
    ],
  },
  oneup: {
    gain: 0.6,
    tones: [
      ...seq(['G5', 'C6', 'E6', 'G6', 'C7'], 0.07, { wave: 'pulse', duty: 0.25, dur: 0.06, release: 0.03 }),
      { at: 0.35, wave: 'pulse', duty: 0.125, freq: n('E7'), dur: 0.12, release: 0.2, vibRate: 9, vibDepth: 0.3 },
    ],
  },
  secret: {
    gain: 0.55,
    tones: [0, 0.14, 0.28].flatMap((at, i) => [
      { at, wave: 'pulse' as const, duty: 0.125, freq: n('G6'), arp: [0, 5, 9, 12], arpRate: 32, dur: 0.12, release: 0.08, vol: 0.5 / (i + 1) },
      { at: at + 0.02, wave: 'triangle' as const, freq: n('C6'), dur: 0.1, release: 0.1, vol: 0.3 / (i + 1) },
    ]),
  },
  checkpoint: {
    gain: 0.55,
    tones: [
      { wave: 'pulse', duty: 0.25, freq: n('E6'), dur: 0.08, decay: 0.1, sustain: 0.5, release: 0.15 },
      { at: 0.1, wave: 'pulse', duty: 0.25, freq: n('B6'), dur: 0.12, decay: 0.2, sustain: 0.4, release: 0.35 },
      { at: 0.1, wave: 'sine', freq: n('B5'), dur: 0.12, release: 0.4, vol: 0.4 },
    ],
  },
  goal: {
    gain: 0.6,
    tones: [
      { wave: 'pulse', duty: 0.5, freq: 300, freqEnd: 1300, slideTime: 0.45, dur: 0.45, release: 0.1, vibRate: 14, vibDepth: 0.25 },
      { at: 0.2, wave: 'noise', freq: 15000, dur: 0.25, release: 0.2, vol: 0.15 },
    ],
  },
  bump: {
    gain: 0.6,
    tones: [
      { wave: 'triangle', freq: 150, freqEnd: 85, dur: 0.07, release: 0.04, stepped: false },
      { wave: 'noise', freq: 2500, dur: 0.02, release: 0.03, vol: 0.4, lpStart: 1500 },
    ],
  },
  'enemy-hit': {
    gain: 0.55,
    tones: [
      { wave: 'pulse', duty: 0.25, freq: 950, freqEnd: 380, dur: 0.06, release: 0.03 },
      { wave: 'noise', freq: 9000, dur: 0.02, release: 0.03, vol: 0.4 },
    ],
  },
  'enemy-defeat': {
    gain: 0.6,
    tones: [
      { wave: 'pulse', duty: 0.5, freq: 760, freqEnd: 90, dur: 0.2, release: 0.05 },
      { at: 0.05, wave: 'noise', freq: 8000, dur: 0.12, release: 0.12, vol: 0.4, lpStart: 5000, lpEnd: 600 },
    ],
  },
  'enemy-shoot': {
    gain: 0.45,
    tones: [{ wave: 'pulse', duty: 0.125, freq: 1500, freqEnd: 480, dur: 0.11, release: 0.04 }],
  },
  'ability-groundpound': {
    gain: 0.85,
    tones: [
      { wave: 'sine', freq: 95, freqEnd: 32, dur: 0.28, decay: 0.15, sustain: 0.5, release: 0.15, vol: 1 },
      { wave: 'noise', freq: 7000, dur: 0.18, decay: 0.15, sustain: 0.3, release: 0.25, vol: 0.7, lpStart: 1800, lpEnd: 150 },
    ],
  },
  'ability-airjump': {
    gain: 0.55,
    tones: [
      { wave: 'pulse', duty: 0.25, freq: 520, freqEnd: 1040, slideTime: 0.12, arp: [0, 12, 7, 19], arpRate: 40, dur: 0.14, release: 0.08 },
      { wave: 'noise', freq: 15000, dur: 0.05, release: 0.1, vol: 0.2 },
    ],
  },
  'ability-dash': {
    gain: 0.6,
    tones: [
      { wave: 'noise', freq: 14000, dur: 0.18, attack: 0.03, release: 0.08, lpStart: 700, lpEnd: 5000, vol: 0.8 },
      { wave: 'pulse', duty: 0.125, freq: 180, freqEnd: 520, dur: 0.12, release: 0.04, vol: 0.35 },
    ],
  },
  'ability-shoot': {
    gain: 0.55,
    tones: [
      { wave: 'pulse', duty: 0.25, freq: 1600, freqEnd: 320, dur: 0.12, release: 0.04 },
      { wave: 'saw', freq: 800, freqEnd: 160, dur: 0.1, release: 0.04, vol: 0.3 },
    ],
  },
  'ability-sniff': {
    gain: 0.5,
    tones: [
      { wave: 'noise', freq: 12000, dur: 0.05, attack: 0.02, release: 0.04, lpStart: 3500, lpEnd: 1500 },
      { at: 0.12, wave: 'noise', freq: 12000, dur: 0.05, attack: 0.02, release: 0.04, lpStart: 3500, lpEnd: 1500 },
      { at: 0.26, wave: 'pulse', duty: 0.125, freq: n('A6'), dur: 0.05, release: 0.15, vol: 0.4 },
    ],
  },
  break: {
    gain: 0.7,
    tones: [
      { wave: 'noise', freq: 9000, dur: 0.15, decay: 0.1, sustain: 0.3, release: 0.15, lpStart: 6000, lpEnd: 500 },
      { wave: 'triangle', freq: 320, freqEnd: 80, dur: 0.1, release: 0.05, vol: 0.5, stepped: false },
      { at: 0.07, wave: 'noise', freq: 5000, dur: 0.04, release: 0.05, vol: 0.4 },
    ],
  },
  'boss-roar': {
    gain: 0.85,
    tones: [
      { wave: 'saw', freq: 150, freqEnd: 58, dur: 0.85, attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.25, tremRate: 17, tremDepth: 0.55, lpStart: 2400, lpEnd: 700 },
      { wave: 'pulse', duty: 0.3, freq: 103, freqEnd: 44, dur: 0.85, attack: 0.08, release: 0.25, vol: 0.4, vibRate: 6, vibDepth: 0.5 },
      { wave: 'noise', freq: 6000, dur: 0.8, attack: 0.1, release: 0.3, vol: 0.45, lpStart: 1500, lpEnd: 300 },
    ],
  },
  explosion: {
    gain: 0.85,
    tones: [
      { wave: 'noise', freq: 7000, dur: 0.15, decay: 0.3, sustain: 0.35, release: 0.5, lpStart: 6000, lpEnd: 120, vol: 1 },
      { wave: 'sine', freq: 90, freqEnd: 28, dur: 0.3, release: 0.3, vol: 0.8 },
    ],
  },
  'train-horn': {
    gain: 0.5,
    tones: [0, 0.6].flatMap((at, i) =>
      [233, 294, 349].map((f) => ({
        at, wave: 'saw' as const, freq: f, dur: i ? 0.75 : 0.42, attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.15,
        lpStart: 1600, lpEnd: 1200, vibRate: 5, vibDepth: 0.06, vol: 0.4,
      })),
    ),
  },
  'menu-move': {
    gain: 0.3,
    tones: [{ wave: 'pulse', duty: 0.5, freq: 880, dur: 0.022, release: 0.02 }],
  },
  'menu-select': {
    gain: 0.45,
    tones: seq(['A5', 'E6'], 0.055, { wave: 'pulse', duty: 0.25, dur: 0.05, release: 0.06 }),
  },
  'menu-back': {
    gain: 0.4,
    tones: seq(['E6', 'A5'], 0.055, { wave: 'pulse', duty: 0.25, dur: 0.05, release: 0.05 }),
  },
  'menu-error': {
    gain: 0.35,
    tones: [{ wave: 'pulse', duty: 0.5, freq: 140, dur: 0.12, release: 0.03, vibRate: 30, vibDepth: 0.6 }],
  },
  pause: {
    gain: 0.45,
    tones: seq(['E6', 'B5', 'E6', 'B5'], 0.06, { wave: 'pulse', duty: 0.5, dur: 0.045, release: 0.02 }),
  },
  confirm: {
    gain: 0.6,
    tones: [
      ...seq(['C5', 'E5', 'G5', 'C6'], 0.06, { wave: 'pulse', duty: 0.25, dur: 0.05, release: 0.02 }),
      { at: 0.24, wave: 'pulse', duty: 0.25, freq: n('E6'), dur: 0.22, release: 0.2, vibRate: 7, vibDepth: 0.25 },
      { at: 0.24, wave: 'triangle', freq: n('C4'), dur: 0.22, release: 0.2, vol: 0.5 },
    ],
  },
  // Overseer tractor beam / laser: a warbling rising hum.
  beam: {
    gain: 0.55,
    tones: [
      { wave: 'pulse', duty: 0.125, freq: 220, freqEnd: 440, slideTime: 0.6, dur: 0.6, attack: 0.04, release: 0.2, vol: 0.5, vibRate: 14, vibDepth: 0.6 },
      { wave: 'sine', freq: 660, freqEnd: 880, slideTime: 0.6, dur: 0.6, attack: 0.04, release: 0.2, vol: 0.35, tremRate: 18, tremDepth: 0.6 },
    ],
  },
  // Heavy body landing on the ground (Overseer slam, falling girders).
  'boss-slam': {
    gain: 0.8,
    tones: [
      { wave: 'sine', freq: 120, freqEnd: 34, dur: 0.25, release: 0.25, vol: 1 },
      { wave: 'noise', freq: 3000, dur: 0.08, decay: 0.2, sustain: 0.3, release: 0.25, lpStart: 2200, lpEnd: 200, vol: 0.7 },
    ],
  },
  // A boss takes a stomp.
  'boss-hit': {
    gain: 0.7,
    tones: [
      { wave: 'pulse', duty: 0.5, freq: 520, freqEnd: 160, dur: 0.14, release: 0.06, vol: 0.6 },
      { wave: 'noise', freq: 9000, dur: 0.05, release: 0.08, lpStart: 5000, lpEnd: 1500, vol: 0.4 },
    ],
  },
  count: {
    gain: 0.3,
    tones: [{ wave: 'pulse', duty: 0.125, freq: n('C7'), dur: 0.015, release: 0.02 }],
  },
};

/** Random pitch spread (cents) applied each time an effect plays, so repeats don't fatigue. */
export const SFX_DETUNE: Record<string, number> = {
  jump: 120,
  land: 150,
  stomp: 80,
  'enemy-hit': 100,
  'enemy-shoot': 120,
  bump: 100,
  break: 150,
  'ability-shoot': 80,
  'ability-dash': 80,
  'menu-move': 0,
};
