import Phaser from 'phaser';

export const UI_FONT = 'monospace';

export function text(scene: Phaser.Scene, x: number, y: number, s: string, size = 10, color = '#ffffff'): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, s, { fontFamily: UI_FONT, fontSize: `${size}px`, color, stroke: '#0b1730', strokeThickness: 3, resolution: 2 })
    .setOrigin(0.5);
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * Vertical menu navigable by keyboard (arrows/WASD + Enter/Space/J), gamepad (d-pad + A)
 * and touch/mouse (tap an item). Returns a destroy function.
 */
export function createMenu(scene: Phaser.Scene, items: MenuItem[], x: number, y: number, spacing = 18): { destroy: () => void; texts: Phaser.GameObjects.Text[] } {
  let index = items.findIndex((i) => !i.disabled);
  const texts = items.map((it, i) => {
    const t = text(scene, x, y + i * spacing, it.label, 12, it.disabled ? '#5b6b88' : '#ffffff');
    t.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (it.disabled) return;
      index = i;
      refresh();
      it.onSelect();
    });
    return t;
  });
  const cursor = text(scene, 0, 0, '▶', 10, '#ffd25a');
  const refresh = () => {
    texts.forEach((t, i) => t.setColor(items[i].disabled ? '#5b6b88' : i === index ? '#ffd25a' : '#ffffff'));
    const t = texts[index];
    if (t) cursor.setPosition(t.x - t.width / 2 - 10, t.y);
  };
  const move = (d: number) => {
    if (items.every((i) => i.disabled)) return;
    do index = (index + d + items.length) % items.length;
    while (items[index].disabled);
    refresh();
  };
  const kb = scene.input.keyboard;
  const onKey = (e: KeyboardEvent) => {
    if (['ArrowUp', 'KeyW'].includes(e.code)) move(-1);
    else if (['ArrowDown', 'KeyS'].includes(e.code)) move(1);
    else if (['Enter', 'Space', 'KeyJ', 'KeyZ'].includes(e.code)) items[index]?.onSelect();
  };
  kb?.on('keydown', onKey);
  const pad = scene.input.gamepad;
  const onPad = (_p: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    if (button.index === 12) move(-1);
    else if (button.index === 13) move(1);
    else if (button.index === 0 || button.index === 9) items[index]?.onSelect();
  };
  pad?.on('down', onPad);
  refresh();
  const destroy = () => {
    kb?.off('keydown', onKey);
    pad?.off('down', onPad);
    texts.forEach((t) => t.destroy());
    cursor.destroy();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  return { destroy, texts };
}
