import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/game/data/levels';
import { measureLine } from '../../src/game/ui/fontGlyphs';
import {
  ENDING_CREDITS,
  FAMILY,
  INTRO_PANELS,
  bossCard,
  levelTagline,
  storyAllowed,
  typewriterLength,
  typewriterSlice,
  wrapText,
} from '../../src/game/story/storyData';

describe('wrapText', () => {
  const mono = (s: string) => s.length; // 1 px per char for predictable tests

  it('wraps greedily at word boundaries', () => {
    expect(wrapText('aaa bbb ccc', 7, mono)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('aaa bbb ccc', 100, mono)).toEqual(['aaa bbb ccc']);
  });

  it('keeps an over-long word on its own line and honours explicit newlines', () => {
    expect(wrapText('a verylongword b', 5, mono)).toEqual(['a', 'verylongword', 'b']);
    expect(wrapText('one\ntwo three', 100, mono)).toEqual(['one', 'two three']);
  });

  it('every intro caption fits the caption box in at most 3 lines of the pixel font', () => {
    for (const p of INTRO_PANELS) {
      const lines = wrapText(p.caption, 452 - 16);
      expect(lines.length, p.id).toBeLessThanOrEqual(3);
      for (const l of lines) expect(measureLine(l)).toBeLessThanOrEqual(452 - 16);
    }
  });
});

describe('typewriter', () => {
  const lines = ['HELLO', 'WORLD'];
  it('reveals characters across lines without counting the break', () => {
    expect(typewriterLength(lines)).toBe(10);
    expect(typewriterSlice(lines, 0)).toBe('');
    expect(typewriterSlice(lines, 3)).toBe('HEL');
    expect(typewriterSlice(lines, 5)).toBe('HELLO');
    expect(typewriterSlice(lines, 6)).toBe('HELLO\nW');
    expect(typewriterSlice(lines, 99)).toBe('HELLO\nWORLD');
  });
});

describe('storyAllowed (cutscene auto-play rule)', () => {
  it('plays for real players', () => {
    expect(storyAllowed('', false)).toBe(true);
    expect(storyAllowed('?foo=1', false)).toBe(true);
  });
  it('is suppressed for automated browsers and dev/test entry points', () => {
    expect(storyAllowed('', true)).toBe(false);
    for (const q of ['?test', '?debug', '?level=loop-1', '?nointro', '?screen=Menu']) expect(storyAllowed(q, false), q).toBe(false);
  });
  it('?story forces it on, even under automation', () => {
    expect(storyAllowed('?test&story', true)).toBe(true);
    expect(storyAllowed('?story', true)).toBe(true);
  });
});

describe('story data', () => {
  it('has 4-6 intro panels ending on the rally cry', () => {
    expect(INTRO_PANELS.length).toBeGreaterThanOrEqual(4);
    expect(INTRO_PANELS.length).toBeLessThanOrEqual(6);
    expect(INTRO_PANELS[INTRO_PANELS.length - 1].speech?.text).toMatch(/SAVE THE LOOP/);
    expect(new Set(INTRO_PANELS.map((p) => p.id)).size).toBe(INTRO_PANELS.length);
  });

  it('every World 1 level has a tagline that fits the level card', () => {
    for (const l of LEVELS) {
      const t = levelTagline(l.id);
      expect(t, l.id).not.toBe('');
      expect(measureLine(t.toUpperCase())).toBeLessThanOrEqual(300);
    }
    expect(levelTagline('nope')).toBe('');
  });

  it('boss cards: the EL-iminator gets its station sign, unknown bosses a generic card', () => {
    const c = bossCard('The EL-iminator');
    expect(c.title).toBe('THE EL-IMINATOR');
    expect(c.subtitle).toMatch(/OUT OF SERVICE/);
    expect(bossCard('Mega Pigeon')).toMatchObject({ title: 'MEGA PIGEON', subtitle: '' });
  });

  it('the ending stars the whole family and credits the studio', () => {
    expect([...FAMILY].sort()).toEqual(['brennan', 'dad', 'lupin', 'mom', 'parker']);
    const text = ENDING_CREDITS.map(([t]) => t).join('\n');
    expect(text).toMatch(/HALLUCINATED GAMES/);
    expect(ENDING_CREDITS.some(([, k]) => k === 'family')).toBe(true);
  });
});

describe('World 2 story data', () => {
  it('World 2 beat: 2-3 panels, captions fit the caption box, ends on a rally cry', async () => {
    const { WORLD2_PANELS, storyPanels, ENDING2_CAPTION, TEASER2_CAPTION } = await import('../../src/game/story/storyData');
    expect(WORLD2_PANELS.length).toBeGreaterThanOrEqual(2);
    expect(WORLD2_PANELS.length).toBeLessThanOrEqual(3);
    expect(storyPanels('world2')).toBe(WORLD2_PANELS);
    expect(storyPanels('intro')).toBe(INTRO_PANELS);
    expect(WORLD2_PANELS[WORLD2_PANELS.length - 1].speech?.who).toBe('all');
    for (const p of WORLD2_PANELS) {
      const lines = wrapText(p.caption, 452 - 16);
      expect(lines.length, p.id).toBeLessThanOrEqual(3);
    }
    // Ending captions use the ending's 30 px caption box (2 lines).
    for (const c of [ENDING2_CAPTION, TEASER2_CAPTION]) expect(wrapText(c, 360 - 16).length).toBeLessThanOrEqual(2);
  });

  it('the Overseer gets its own boss card', () => {
    const c = bossCard('The Overseer');
    expect(c.title).toBe('THE OVERSEER');
    expect(c.subtitle).not.toBe('');
  });
});
