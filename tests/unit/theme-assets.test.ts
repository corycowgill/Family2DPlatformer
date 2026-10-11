import { describe, expect, it } from 'vitest';
import { bgTheme, isLazyBgKey, EAGER_THEMES } from '../../src/game/systems/ThemeAssets';

describe('ThemeAssets', () => {
  it('parses the theme from background keys', () => {
    expect(bgTheme('bg-park-far')).toBe('park');
    expect(bgTheme('bg-sunset-clouds')).toBe('sunset');
    expect(bgTheme('tiles')).toBeNull();
    expect(bgTheme('portrait-dad')).toBeNull();
  });
  it('loads World 1 themes at boot and World 2 themes on demand', () => {
    for (const t of EAGER_THEMES) expect(isLazyBgKey(`bg-${t}-sky`)).toBe(false);
    for (const t of ['park', 'lakefront', 'night', 'stadium']) expect(isLazyBgKey(`bg-${t}-mid`)).toBe(true);
    expect(isLazyBgKey('logo')).toBe(false);
  });
});
