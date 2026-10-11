import { measureLine } from '../ui/fontGlyphs';

/**
 * Story & presentation data + pure helpers (no Phaser — unit-tested in Node).
 * Scenes: StoryScene (opening comic), EndingScene (World 1 ending + credits + teaser),
 * level intro cards (HUD) and the boss intro beat (story/BossIntro.ts).
 */

// ------------------------------------------------------------------ text helpers

/**
 * Greedy word-wrap for the pixel font: returns lines no wider than `maxWidth` font pixels
 * (a single over-long word gets its own line). Explicit '\n' starts a new paragraph.
 * Pre-wrapping lets the typewriter reveal text without words jumping between lines.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number = measureLine): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Visible slice of a typewriter reveal: `chars` characters of the wrapped text (newlines are free). */
export function typewriterSlice(lines: string[], chars: number): string {
  const full = lines.join('\n');
  let shown = 0;
  let i = 0;
  for (; i < full.length && shown < chars; i++) if (full[i] !== '\n') shown++;
  return full.slice(0, i);
}

/** Number of revealable characters (excluding line breaks). */
export function typewriterLength(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length, 0);
}

/**
 * Should cutscenes auto-play? Not for dev/test entry points and automated browsers
 * (same rule as the studio ident in index.html), unless `?story` forces them on.
 */
export function storyAllowed(search: string, webdriver: boolean): boolean {
  const q = new URLSearchParams(search);
  if (q.has('story')) return true;
  if (webdriver) return false;
  return !['nointro', 'test', 'debug', 'level', 'screen'].some((k) => q.has(k));
}

export function browserStoryAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  return storyAllowed(window.location.search, typeof navigator !== 'undefined' && !!navigator.webdriver);
}

// ------------------------------------------------------------------ opening story

export type IntroPanelId = 'hotdogs' | 'rumble' | 'eliminator' | 'haywire' | 'pod' | 'rally' | 'picnic' | 'abduct' | 'playball';

export interface IntroPanel {
  id: IntroPanelId;
  /** Small header in the panel's corner ("SATURDAY, 11:58 AM"). */
  tag: string;
  caption: string;
  /** Optional speech bubble: who says it (character id or 'all') and the line. */
  speech?: { who: string; text: string };
}

export const INTRO_PANELS: readonly IntroPanel[] = [
  {
    id: 'hotdogs',
    tag: 'SATURDAY · THE LOOP',
    caption: 'A sunny Saturday in Chicago. The whole family is out for the best hot dogs in the Loop!',
    speech: { who: 'dad', text: 'EXTRA PICKLES! NO KETCHUP!' },
  },
  {
    id: 'rumble',
    tag: '12:01 PM',
    caption: 'Then, high on the elevated tracks, the L began to rumble... and rumble... and RUMBLE.',
    speech: { who: 'parker', text: "UH... IS THE TRAIN SUPPOSED TO DO THAT?" },
  },
  {
    id: 'eliminator',
    tag: 'CTA LOOP LINE',
    caption: "The CTA's brand-new robot train, the EL-iminator, blew a fuse and went right off the rails!",
  },
  {
    id: 'haywire',
    tag: 'MEANWHILE...',
    caption: 'Security drones, sewer rats, even the pigeons went haywire. The Loop was in chaos!',
  },
  {
    id: 'pod',
    tag: '???',
    caption: 'And far above the skyline, something strange was watching...',
  },
  {
    id: 'rally',
    tag: '',
    caption: "Lunch can wait. Grab your hot dog - it's time to go!",
    speech: { who: 'all', text: "LET'S SAVE THE LOOP!" },
  },
];

// ------------------------------------------------------------------ World 2 story

/** Shown once, the first time the family heads into World 2 (from the world map). */
export const WORLD2_PANELS: readonly IntroPanel[] = [
  {
    id: 'picnic',
    tag: 'SUNDAY · LINCOLN PARK',
    caption: 'With the Loop saved, the family celebrates with a picnic in Lincoln Park. Lupin brought his favourite ball!',
    speech: { who: 'lupin', text: 'WOOF! WOOF! (THROW IT!)' },
  },
  {
    id: 'abduct',
    tag: '12:34 PM',
    caption: "SHLOOP! A green beam swept down from the sky and slurped up Lupin's ball... and every letter off the Wrigley Field sign!",
    speech: { who: 'parker', text: 'HEY! THOSE ARE NOT YOURS!' },
  },
  {
    id: 'playball',
    tag: '',
    caption: 'The Overseer is heading north to Wrigley Field. Grab your mitts - Lupin wants his ball back!',
    speech: { who: 'all', text: 'PLAY BALL, NORTH SIDE!' },
  },
];

export type StoryId = 'intro' | 'world2';

export function storyPanels(id: StoryId): readonly IntroPanel[] {
  return id === 'world2' ? WORLD2_PANELS : INTRO_PANELS;
}

// ------------------------------------------------------------------ level intro cards

/** One-line flavour subtitles for the level intro card. */
export const LEVEL_TAGLINES: Record<string, string> = {
  'loop-1': 'Hot dogs first. Heroics second.',
  'loop-2': 'Mind the gap - and the robots.',
  'loop-3': "Don't fall in. The river is VERY green.",
  'loop-boss': 'End of the line, EL-iminator!',
  'north-1': 'Something is bugging the zoo...',
  'north-2': 'Sun, sand and saucers.',
  'north-3': 'The bright lights of Clark and Addison.',
  'north-4': "Bottom of the ninth. Let's win this one!",
  test: 'Testing, testing... one, two, three.',
};

export function levelTagline(levelId: string): string {
  return LEVEL_TAGLINES[levelId] ?? '';
}

// ------------------------------------------------------------------ boss intro cards

export interface BossCard {
  /** Display name (big). */
  title: string;
  /** Station-sign subtitle. */
  subtitle: string;
  /** Colour of the "line" stripe on the sign. */
  line: number;
}

const BOSS_CARDS: Record<string, BossCard> = {
  'the el-iminator': { title: 'THE EL-IMINATOR', subtitle: 'CTA LOOP LINE - OUT OF SERVICE', line: 0x8b5a2b },
  'alien warlord': { title: 'ALIEN WARLORD', subtitle: 'ORIGIN: UNKNOWN', line: 0x7a3fb0 },
  'the overseer': { title: 'THE OVERSEER', subtitle: 'ALIEN MOTHERSHIP POD - NOW BATTING', line: 0x2fd06a },
};

export function bossCard(name: string): BossCard {
  return BOSS_CARDS[name.trim().toLowerCase()] ?? { title: name.toUpperCase(), subtitle: '', line: 0xe8414e };
}

// ------------------------------------------------------------------ ending

/** The family, in the order they line up in the ending (always all five, whatever is unlocked). */
export const FAMILY = ['dad', 'mom', 'parker', 'brennan', 'lupin'] as const;

export type CreditLine = [text: string, kind: 'h' | 's' | 't' | 'gap' | 'family'];

export const ENDING_CREDITS: readonly CreditLine[] = [
  ['CHICAGO FAMILY ADVENTURE', 'h'],
  ['', 'gap'],
  ['STARRING', 's'],
  ['', 'family'],
  ['', 'gap'],
  ['A HALLUCINATED GAMES PRODUCTION', 's'],
  ['MADE WITH LOVE FOR THE WHOLE FAMILY', 't'],
  ['', 'gap'],
  ['GAME DESIGN · ART · MUSIC · CODE', 's'],
  ['THE HALLUCINATED GAMES TEAM', 't'],
  ['WITH CLAUDE CODE', 't'],
  ['', 'gap'],
  ['BUILT WITH', 's'],
  ['PHASER 3 · TYPESCRIPT · VITE', 't'],
  ['CHIPTUNES SYNTHESISED LIVE IN YOUR BROWSER', 't'],
  ['', 'gap'],
  ['SPECIAL THANKS', 's'],
  ['THE CTA, FOR THE RIDE', 't'],
  ['THE PIGEONS OF THE LOOP', 't'],
  ['EVERY HOT DOG STAND (NO KETCHUP!)', 't'],
  ['AND YOU, FOR PLAYING!', 't'],
];

export const ENDING_CAPTION = 'The EL-iminator was towed back to the rail yard, and the Loop was safe once more.';
export const TEASER_CAPTION = 'But that night, high above Lincoln Park...';

/** World 2 ending (EndingScene with world 2). */
export const ENDING2_CAPTION = "The Overseer fled into space, the sign got its letters back - and Lupin got his ball!";
export const TEASER2_CAPTION = 'Meanwhile, out at Navy Pier, the Ferris wheel started spinning... backwards.';
