/**
 * Tiny offline chiptune synthesiser. Pure TypeScript (no WebAudio), so it is fast,
 * deterministic and unit-testable: it renders mono Float32Array PCM which the Phaser
 * glue (AudioAssets.ts) copies into AudioBuffers.
 */
import { midiToFreq, mulberry32, semitoneRatio, stepToSample, barsToSamples, type NoteEvent } from './notes';

export type Wave = 'pulse' | 'triangle' | 'saw' | 'sine' | 'noise';

/** One synthesised voice: oscillator + ADSR + optional pitch slide/vibrato/arpeggio/lowpass. */
export interface Tone {
  /** Start time in seconds (used by sound effects). */
  at?: number;
  wave: Wave;
  /** Pulse duty cycle (0..1, default 0.5 = square). */
  duty?: number;
  /** Frequency in Hz (for noise: the sample-and-hold rate). */
  freq: number;
  /** Slide target frequency. */
  freqEnd?: number;
  /** Seconds the slide takes (default: dur). */
  slideTime?: number;
  /** Gate length in seconds (release starts after this). */
  dur: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  vol?: number;
  /** Vibrato rate (Hz) / depth (semitones) / delay (s). */
  vibRate?: number;
  vibDepth?: number;
  vibDelay?: number;
  /** Arpeggio semitone offsets cycled at arpRate Hz. */
  arp?: number[];
  arpRate?: number;
  /** One-pole lowpass cutoff sweep (Hz). */
  lpStart?: number;
  lpEnd?: number;
  /** Tremolo: rate Hz and depth 0..1. */
  tremRate?: number;
  tremDepth?: number;
  /** Start this many semitones flat and scoop up over 40ms (brass-like attack). */
  scoop?: number;
  /** Quantise the triangle wave to 16 levels like the NES (default true). */
  stepped?: boolean;
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function gateLevel(x: number, a: number, d: number, s: number): number {
  if (x < a) return x / a;
  if (x < a + d) {
    const k = 1 - (x - a) / d;
    return s + (1 - s) * k * k;
  }
  return s;
}

/** Envelope level at time t (seconds since note start). */
export function envelopeAt(t: number, tone: Tone): number {
  const a = Math.max(0.002, tone.attack ?? 0.004);
  const d = tone.decay ?? 0.08;
  const s = tone.sustain ?? 0.7;
  const r = Math.max(0.004, tone.release ?? 0.05);
  if (t < tone.dur) return gateLevel(t, a, d, s);
  const lvl = gateLevel(tone.dur, a, d, s);
  const k = 1 - (t - tone.dur) / r;
  return k <= 0 ? 0 : lvl * k * k;
}

/** Total length (seconds) a tone occupies including release. */
export function toneLength(t: Tone): number {
  return t.dur + Math.max(0.004, t.release ?? 0.05);
}

/**
 * Additively render `tone` into `out` starting at `start`. With `wrap`, samples past the end
 * wrap around to the beginning (this is what makes music loops seamless: release tails of the
 * last bar ring into the first one).
 */
export function renderTone(out: Float32Array, sampleRate: number, start: number, tone: Tone, wrap = false, seed = 1): void {
  const total = Math.ceil(toneLength(tone) * sampleRate);
  const len = out.length;
  const vol = tone.vol ?? 0.5;
  const duty = tone.duty ?? 0.5;
  const rng = mulberry32(seed);
  const slideT = tone.slideTime ?? tone.dur;
  const stepped = tone.stepped ?? true;
  const wave = tone.wave;
  const lpOn = tone.lpStart !== undefined;
  const lpEnd = tone.lpEnd ?? tone.lpStart ?? 0;
  const lpDur = toneLength(tone);
  const twoPi = 2 * Math.PI;
  let phase = 0;
  let noise = rng() * 2 - 1;
  let lp = 0;
  // Pitch, envelope, tremolo and filter coefficients are computed at control rate
  // (every CR samples) — inaudible at these block sizes and ~10x faster.
  const CR = 32;
  let dt = 0;
  let gain = 0;
  let gainStep = 0;
  let alpha = 1;
  for (let i = 0; i < total; i++) {
    if (i % CR === 0) {
      const time = i / sampleRate;
      let f = tone.freq;
      if (tone.freqEnd !== undefined) f *= Math.pow(tone.freqEnd / tone.freq, Math.min(1, time / slideT));
      if (tone.scoop && time < 0.04) f *= semitoneRatio(-tone.scoop * (1 - time / 0.04));
      if (tone.arp && tone.arp.length) f *= semitoneRatio(tone.arp[Math.floor(time * (tone.arpRate ?? 30)) % tone.arp.length]);
      if (tone.vibRate && tone.vibDepth && time > (tone.vibDelay ?? 0)) {
        f *= semitoneRatio(tone.vibDepth * Math.sin(twoPi * tone.vibRate * time));
      }
      dt = f / sampleRate;
      let g = envelopeAt(time, tone) * vol;
      let gNext = envelopeAt(time + CR / sampleRate, tone) * vol;
      if (tone.tremRate && tone.tremDepth) {
        const tr = 1 - tone.tremDepth * (0.5 + 0.5 * Math.sin(twoPi * tone.tremRate * time));
        g *= tr;
        gNext *= tr;
      }
      gain = g;
      gainStep = (gNext - g) / CR;
      if (lpOn) {
        const cutoff = tone.lpStart! * Math.pow(lpEnd / tone.lpStart!, Math.min(1, time / lpDur));
        alpha = 1 - Math.exp((-twoPi * cutoff) / sampleRate);
      }
    }
    let idx = start + i;
    if (idx >= len) {
      if (!wrap) break;
      idx %= len;
    }
    let v: number;
    if (wave === 'pulse') {
      v = phase < duty ? 1 : -1;
      v += polyBlep(phase, dt);
      let p2 = phase - duty;
      if (p2 < 0) p2 += 1;
      v -= polyBlep(p2, dt);
    } else if (wave === 'triangle') {
      const tri = 1 - 4 * Math.abs(phase - 0.5);
      v = stepped ? Math.round(tri * 7.5) / 7.5 : tri;
    } else if (wave === 'saw') {
      v = 2 * phase - 1 - polyBlep(phase, dt);
    } else if (wave === 'sine') {
      v = Math.sin(twoPi * phase);
    } else {
      v = noise;
    }
    phase += dt;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      if (wave === 'noise') noise = rng() * 2 - 1;
    }
    if (lpOn) {
      lp += alpha * (v - lp);
      v = lp;
    }
    if (idx >= 0) out[idx] += v * gain;
    gain += gainStep;
  }
}

function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Scale so the loudest sample is `target`. */
export function normalize(buf: Float32Array, target = 0.85): Float32Array {
  const p = peak(buf);
  if (p > 0) {
    const g = target / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

export interface SfxDef {
  tones: Tone[];
  /** Peak level 0..1 after normalisation (relative loudness between effects). */
  gain?: number;
}

/** Render a one-shot effect. */
export function renderSfx(def: SfxDef, sampleRate: number): Float32Array {
  const end = Math.max(...def.tones.map((t) => (t.at ?? 0) + toneLength(t)));
  const out = new Float32Array(Math.ceil(end * sampleRate) + 1);
  def.tones.forEach((t, i) => renderTone(out, sampleRate, Math.round((t.at ?? 0) * sampleRate), t, false, 1 + i * 7919));
  return normalize(out, def.gain ?? 0.8);
}

// ---------------------------------------------------------------- songs

export type Instrument = Omit<Tone, 'freq' | 'dur' | 'at' | 'freqEnd'> & {
  /** Fraction of the note length the gate stays open (default 0.92). */
  gate?: number;
  /** Fixed gate in steps (overrides gate fraction) — for plucky stabs. */
  gateSteps?: number;
};

export interface SongTrack {
  inst: Instrument;
  events: NoteEvent[];
}

export type DrumKind = 'k' | 's' | 'h' | 'o' | 'c' | 't';
export interface DrumHit {
  step: number;
  kind: DrumKind;
  vel: number;
}

export interface Song {
  bpm: number;
  /** Length in bars (4/4, 16 steps per bar). */
  bars: number;
  /** Looping songs wrap their tails around; one-shot jingles get extra tail time instead. */
  loop: boolean;
  tracks: SongTrack[];
  drums?: DrumHit[];
  /** Peak level after normalisation. */
  gain?: number;
}

export const DRUM_TONES: Record<DrumKind, Tone[]> = {
  k: [
    { wave: 'sine', freq: 170, freqEnd: 42, slideTime: 0.09, dur: 0.09, release: 0.06, sustain: 0.6, decay: 0.05, vol: 1 },
    { wave: 'noise', freq: 9000, dur: 0.006, release: 0.01, vol: 0.25 },
  ],
  s: [
    { wave: 'noise', freq: 12000, dur: 0.06, decay: 0.05, sustain: 0.35, release: 0.08, vol: 0.55, lpStart: 7000, lpEnd: 3000 },
    { wave: 'triangle', freq: 230, freqEnd: 160, dur: 0.05, release: 0.03, vol: 0.45, stepped: false },
  ],
  h: [{ wave: 'noise', freq: 16000, dur: 0.012, release: 0.025, vol: 0.22 }],
  o: [{ wave: 'noise', freq: 16000, dur: 0.07, release: 0.08, sustain: 0.5, vol: 0.2 }],
  c: [{ wave: 'noise', freq: 14000, dur: 0.05, decay: 0.3, sustain: 0.3, release: 0.5, vol: 0.3, lpStart: 12000, lpEnd: 5000 }],
  t: [{ wave: 'triangle', freq: 200, freqEnd: 90, dur: 0.12, release: 0.06, vol: 0.7, stepped: false }],
};

/** Total step count of a song. */
export function songSteps(song: Song): number {
  return song.bars * 16;
}

/** Render a song to PCM. Looping songs are exactly `bars` long so Phaser's loop is seamless. */
export function renderSong(song: Song, sampleRate: number): Float32Array {
  const loopLen = barsToSamples(song.bars, song.bpm, sampleRate);
  const len = song.loop ? loopLen : loopLen + Math.round(sampleRate * 1.2);
  const out = new Float32Array(len);
  const stepSec = 60 / song.bpm / 4;
  let seed = 1;
  for (const track of song.tracks) {
    const inst = track.inst;
    for (const ev of track.events) {
      const gateSteps = inst.gateSteps ?? ev.len * (inst.gate ?? 0.92);
      const tone: Tone = { ...inst, freq: midiToFreq(ev.midi), dur: Math.max(0.01, gateSteps * stepSec) };
      if (ev.vel !== undefined) tone.vol = (tone.vol ?? 0.5) * ev.vel;
      renderTone(out, sampleRate, stepToSample(ev.step, song.bpm, sampleRate), tone, song.loop, seed++);
    }
  }
  for (const hit of song.drums ?? []) {
    for (const t of DRUM_TONES[hit.kind]) {
      renderTone(out, sampleRate, stepToSample(hit.step, song.bpm, sampleRate), { ...t, vol: (t.vol ?? 0.5) * hit.vel }, song.loop, seed++);
    }
  }
  // Gentle master lowpass to tame aliasing harshness. Two passes over a loop so the
  // filter state at the loop point is continuous.
  const alpha = 1 - Math.exp((-2 * Math.PI * 9000) / sampleRate);
  let state = 0;
  const passes = song.loop ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    const write = p === passes - 1;
    for (let i = 0; i < len; i++) {
      state += alpha * (out[i] - state);
      if (write) out[i] = state;
    }
  }
  return normalize(out, song.gain ?? 0.8);
}
