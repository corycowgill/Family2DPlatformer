import Phaser from 'phaser';
import type { LevelContext, Collectible, Trigger, PlayerProjectile } from '../world/LevelContext';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';

/** Pure stomp test, exported for unit tests. */
export function isStomp(
  player: { bottom: number; prevBottom: number; vy: number },
  enemy: { top: number },
  tolerance = 8,
): boolean {
  // Player is falling and its feet were above (or near) the enemy's top last frame.
  return player.vy > 0 && player.prevBottom <= enemy.top + tolerance;
}

/**
 * Wires all overlap/collision rules between the player, enemies, projectiles,
 * pickups, triggers, platforms and tile layers.
 */
export class CombatSystem {
  constructor(private ctx: LevelContext) {
    const { scene, groups, ground, oneway, hazards, water } = ctx;
    const player = ctx.player;
    const physics = scene.physics;

    // Terrain
    physics.add.collider(player, ground);
    physics.add.collider(groups.enemies, ground);
    physics.add.collider(groups.pickups, ground);
    if (oneway) {
      // One-way tiles only collide on their top face (set up in LevelScene).
      // Player can drop through them (down + jump) — see Player.isDroppingThrough.
      physics.add.collider(player, oneway, undefined, () => !player.isDroppingThrough());
      physics.add.collider(groups.enemies, oneway);
      physics.add.collider(groups.pickups, oneway);
    }
    physics.add.collider(
      player,
      groups.platforms,
      (_p, plat) => player.setGroundPlatform((plat as Phaser.GameObjects.GameObject).body as Phaser.Physics.Arcade.Body),
      (_p, plat) => this.platformProcess(plat as Phaser.GameObjects.GameObject),
    );
    physics.add.collider(groups.enemies, groups.platforms);

    if (hazards) {
      physics.add.overlap(player, hazards, undefined, (_p, tile) => {
        const t = tile as Phaser.Tilemaps.Tile;
        if (t.index > 0) player.hurt({ amount: 1, fromX: t.getCenterX(), kind: 'hazard' });
        return false;
      });
    }
    if (water) {
      physics.add.overlap(player, water, undefined, (_p, tile) => {
        const t = tile as Phaser.Tilemaps.Tile;
        // Only die once the player's body is mostly submerged.
        if (t.index > 0 && player.body.bottom > t.getTop() + 6) player.die('pit');
        return false;
      });
    }
    // Projectiles hitting walls
    physics.add.collider(groups.playerProjectiles, ground, (proj) => (proj as Phaser.GameObjects.GameObject).destroy());
    physics.add.collider(groups.enemyProjectiles, ground, (proj) => (proj as Phaser.GameObjects.GameObject).destroy());

    // Player vs enemies
    physics.add.overlap(player, groups.enemies, (_p, e) => this.playerVsEnemy(e as Enemy));

    // Player projectiles vs enemies
    physics.add.overlap(groups.playerProjectiles, groups.enemies, (proj, e) => {
      const enemy = e as Enemy;
      const p = proj as unknown as PlayerProjectile & Phaser.GameObjects.GameObject;
      if (enemy.dead) return;
      enemy.takeHit({ amount: p.damage * player.attackPower, fromX: (proj as Phaser.Physics.Arcade.Sprite).x, kind: 'projectile' });
      p.onHitEnemy();
    });

    // Enemy projectiles vs player
    physics.add.overlap(player, groups.enemyProjectiles, (_p, proj) => {
      const s = proj as Phaser.Physics.Arcade.Sprite & { damage?: number; onHitPlayer?: () => void };
      if (!player.isAlive()) return;
      if (player.isInvulnerable()) return;
      player.hurt({ amount: s.damage ?? 1, fromX: s.x, kind: 'projectile' });
      if (s.onHitPlayer) s.onHitPlayer();
      else s.destroy();
    });

    // Pickups & triggers
    physics.add.overlap(player, groups.pickups, (_p, c) => {
      if (player.isAlive()) (c as unknown as Collectible).collect(ctx);
    });
    physics.add.overlap(player, groups.triggers, (_p, t) => (t as unknown as Trigger).onPlayerOverlap(ctx));
  }

  /** One-way moving platforms: only collide from above. Platforms opt in via `oneWay` data. */
  private platformProcess(plat: Phaser.GameObjects.GameObject): boolean {
    const p = this.ctx.player;
    if (!p.isAlive()) return false;
    const body = plat.body as Phaser.Physics.Arcade.Body;
    if (plat.getData('oneWay')) {
      if (p.isDroppingThrough()) return false;
      // Relative velocity so riders of rising platforms stay on.
      return p.body.velocity.y >= body.velocity.y && p.body.prev.y + p.body.height <= body.prev.y + 6;
    }
    return true;
  }

  private playerVsEnemy(enemy: Enemy): void {
    const player: Player = this.ctx.player;
    if (enemy.dead || !enemy.active || !player.isAlive()) return;
    // Star power, Brennan's dash, Dad's ground pound…
    if (player.onEnemyContact(enemy)) return;
    const pb = player.body;
    const eb = enemy.body;
    const stomp = isStomp(
      { bottom: pb.bottom, prevBottom: pb.prev.y + pb.height, vy: pb.velocity.y },
      { top: eb.top },
    );
    if (stomp && enemy.cfg.stompable) {
      enemy.onStomp();
      player.bounce(player.lastInput.jump);
      return;
    }
    if (player.attacking) {
      enemy.takeHit({ amount: player.attackPower, fromX: player.x, kind: 'melee' });
      return;
    }
    if (enemy.cfg.contactDamage > 0) {
      player.hurt({ amount: enemy.cfg.contactDamage, fromX: enemy.x, kind: 'contact' });
    }
  }
}
