import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu } from '../ui/Menus';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { px } from '../ui/PixelFont';
import { Skyline } from '../ui/Skyline';
import { COLORS } from '../ui/Widgets';
import { transitionIn, transitionTo } from '../ui/Transitions';
import { prompt } from '../ui/Prompts';

/** Title → EXTRAS: rewatch the opening story / the World 1 ending (once seen) and the credits. */
export class ExtrasScene extends Phaser.Scene {
  private sky!: Skyline;

  constructor() {
    super('Extras');
  }

  create(): void {
    this.sky = new Skyline(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.35).setOrigin(0);
    px(this, GAME_WIDTH / 2, 32, 'EXTRAS', { scale: 3, color: COLORS.gold });
    const save = saveSystem.get();
    // Older saves that started before the story existed can watch it too.
    const introOk = save.seenIntro || saveSystem.hasProgress();
    const back = () => transitionTo(this, 'Menu');
    createMenu(
      this,
      [
        {
          label: introOk ? 'WATCH: OPENING STORY' : 'OPENING STORY - ???',
          disabled: !introOk,
          onSelect: () => transitionTo(this, 'Story', { next: 'Extras' }),
        },
        {
          label: save.seenEnding ? 'WATCH: WORLD 1 ENDING' : 'ENDING - SAVE THE LOOP FIRST',
          disabled: !save.seenEnding,
          onSelect: () => transitionTo(this, 'Ending', { replay: true }),
        },
        {
          label: saveSystem.hasSeenStory('world2-intro') ? 'WATCH: WORLD 2 STORY' : 'WORLD 2 STORY - ???',
          disabled: !saveSystem.hasSeenStory('world2-intro'),
          onSelect: () => transitionTo(this, 'Story', { story: 'world2', next: 'Extras' }),
        },
        {
          label: saveSystem.hasSeenStory('world2-ending') ? 'WATCH: WORLD 2 ENDING' : 'WORLD 2 ENDING - ???',
          disabled: !saveSystem.hasSeenStory('world2-ending'),
          onSelect: () => transitionTo(this, 'Ending', { replay: true, world: 2 }),
        },
        { label: 'CREDITS', onSelect: () => transitionTo(this, 'Credits', { back: 'Extras' }) },
        { label: 'BACK', onSelect: back, sound: 'menu-back' },
      ],
      GAME_WIDTH / 2,
      84,
      19,
      { width: 230, panel: true, onBack: back, depth: 20 },
    );
    prompt(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, (d) => (d === 'touch' ? 'TAP TO CHOOSE' : '{NAV} MOVE  {CONFIRM} CHOOSE  {BACK} BACK'), {
      color: COLORS.sub,
      depth: 20,
    });
    audio.music('title');
    transitionIn(this);
  }

  update(_t: number, delta: number): void {
    this.sky.update(delta);
  }
}
