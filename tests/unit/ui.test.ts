import { describe, expect, it, vi } from 'vitest';

// UI modules import Phaser for types/runtime objects; the helpers under test are pure.
vi.mock('phaser', () => ({ default: {} }));

import { cycle, formatTime, pad, remaining01, stepVolume, volumeBar } from '../../src/game/ui/format';
import { allGlyphs, CAP_HEIGHT, GLYPH_ROWS, measureLine, sanitizeText, SUPPORTED_CHARS } from '../../src/game/ui/fontGlyphs';
import { pathBetween, pickDirectional } from '../../src/game/ui/mapNav';
import { nextEnabled } from '../../src/game/ui/Menus';
import { stickDirection } from '../../src/game/ui/NavInput';
import { bandCoverage } from '../../src/game/ui/Transitions';
import { musicGain, sfxGain } from '../../src/game/systems/AudioSystem';

describe('format helpers', () => {
  it('formats times as m:ss.cc', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83456)).toBe('1:23.45');
    expect(formatTime(600000)).toBe('10:00.00');
    expect(formatTime(-5)).toBe('0:00.00');
  });
  it('volume bars and steps', () => {
    expect(volumeBar(0.6)).toBe('●●●●●●○○○○');
    expect(volumeBar(0)).toBe('○○○○○○○○○○');
    expect(volumeBar(2)).toBe('●●●●●●●●●●');
    expect(stepVolume(0.7, 1)).toBe(0.8);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0.1, -1)).toBe(0);
    let v = 0;
    for (let i = 0; i < 7; i++) v = stepVolume(v, 1);
    expect(v).toBe(0.7); // no float drift
  });
  it('pad, cycle and remaining01', () => {
    expect(pad(7, 3)).toBe('007');
    expect(pad(1234, 3)).toBe('1234');
    expect(cycle(['auto', 'on', 'off'], 'off')).toBe('auto');
    expect(cycle(['auto', 'on', 'off'], 'auto', -1)).toBe('off');
    expect(remaining01(1000, 2000, 1000)).toBe(1);
    expect(remaining01(1000, 2000, 2000)).toBe(0.5);
    expect(remaining01(1000, 2000, 9000)).toBe(0);
    expect(remaining01(0, 0, 0)).toBe(0);
  });
});

describe('pixel font glyphs', () => {
  it('has every required character with sane dimensions', () => {
    const need = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?\'":;-+=/()%&#*<>♥★▶◀✓×';
    for (const ch of need) expect(SUPPORTED_CHARS.has(ch), ch).toBe(true);
    for (const g of allGlyphs()) {
      expect(g.rows.length).toBe(GLYPH_ROWS);
      expect(g.width, g.ch).toBeGreaterThan(0);
      expect(g.width, g.ch).toBeLessThanOrEqual(7);
      expect(g.rows.some((r) => r.some(Boolean)), `${g.ch} has ink`).toBe(true);
    }
  });
  it('capitals and digits fit in the cap height', () => {
    for (const g of allGlyphs().filter((x) => /[A-Z0-9]/.test(x.ch))) {
      expect(g.rows.slice(CAP_HEIGHT).flat().some(Boolean), g.ch).toBe(false);
    }
  });
  it('sanitises unsupported characters', () => {
    expect(sanitizeText('Hello… “world” — ok')).toBe('Hello... "world" - ok');
    expect(sanitizeText('■□')).toBe('●○');
    expect(sanitizeText('naïve')).toBe('na?ve');
    expect(sanitizeText('line1\nline2')).toBe('line1\nline2');
  });
  it('measures lines', () => {
    expect(measureLine('A')).toBe(5);
    expect(measureLine('AA')).toBe(11);
    expect(measureLine('A A')).toBe(15);
    expect(measureLine('')).toBe(0);
  });
});

describe('menu + map navigation', () => {
  it('nextEnabled skips disabled items and wraps', () => {
    const items = [{}, { disabled: true }, {}, {}];
    expect(nextEnabled(items, 0, 1)).toBe(2);
    expect(nextEnabled(items, 2, -1)).toBe(0);
    expect(nextEnabled(items, 3, 1)).toBe(0);
    expect(nextEnabled(items, 0, -1)).toBe(3);
    expect(nextEnabled([{ disabled: true }], 0, 1)).toBe(0);
  });
  it('pickDirectional follows the Loop rectangle', () => {
    const nodes = [{ x: 268, y: 168 }, { x: 268, y: 112 }, { x: 352, y: 112 }, { x: 352, y: 168 }, { x: 66, y: 92 }];
    expect(pickDirectional(nodes, 0, 'up')).toBe(1);
    expect(pickDirectional(nodes, 1, 'right')).toBe(2);
    expect(pickDirectional(nodes, 2, 'down')).toBe(3);
    expect(pickDirectional(nodes, 3, 'left')).toBe(0);
    expect(pickDirectional(nodes, 1, 'left')).toBe(4);
    expect(pickDirectional(nodes, 4, 'left')).toBe(4); // nothing further west
  });
  it('pathBetween lists intermediate nodes', () => {
    expect(pathBetween(0, 3)).toEqual([1, 2, 3]);
    expect(pathBetween(3, 1)).toEqual([2, 1]);
    expect(pathBetween(2, 2)).toEqual([]);
  });
  it('stick directions respect the dead zone', () => {
    expect(stickDirection(0.1, 0.2)).toBeNull();
    expect(stickDirection(-0.9, 0.2)).toBe('left');
    expect(stickDirection(0.2, 0.8)).toBe('down');
    expect(stickDirection(0.1, -0.7)).toBe('up');
  });
});

// Touch-control geometry is covered in touch-layout.test.ts.

describe('transitions + audio gain', () => {
  it('blind wipe coverage is monotonic and complete', () => {
    for (let i = 0; i < 9; i++) {
      expect(bandCoverage(0, i)).toBe(0);
      expect(bandCoverage(1, i)).toBe(1);
      expect(bandCoverage(0.5, i)).toBeGreaterThanOrEqual(bandCoverage(0.4, i));
    }
    expect(bandCoverage(0.3, 0)).toBeGreaterThan(bandCoverage(0.3, 8));
  });
  it('applies mute and volume settings', () => {
    expect(musicGain({ muted: true, musicVolume: 1 })).toBe(0);
    expect(musicGain({ muted: false, musicVolume: 1 })).toBeCloseTo(0.7);
    expect(musicGain({ muted: false, musicVolume: 1 }, true)).toBeLessThan(0.3);
    expect(sfxGain({ muted: false, sfxVolume: 0.5 }, 0.5)).toBe(0.25);
    expect(sfxGain({ muted: true, sfxVolume: 0.5 })).toBe(0);
  });
});
