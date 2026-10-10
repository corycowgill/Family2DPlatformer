import Phaser from 'phaser';
import type { LevelContext, Collectible, Trigger, PlayerProjectile } from '../world/LevelContext';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { isStomp } from '../enemies/ai';

export { isStomp } from '../enemies/ai';

type EnemyShot = Phaser.Physics.Arcade.Sprite & {
  damage?: number;
  harmful?: boolean;
  ignoreTerrain?: boolean;
  onHitPlayer?: () => void;
  onHitWall?: () => void;
};

/** After a stomp, the stomped enemy can't hurt the player for this long (ms). */
const STOMP_GRACE_MS = 180;
/** Damage a kicked cone shell deals to enemies it slides into. */
const SHELL_DAMAGE = 3;

/**
 * Wires all overlap/collision rules between the player, enemies, projectiles,
 * pickups, triggers, platforms and tile layers.
 *
 * Fairness rules:
 * - Stomps are generous (see `isStomp`) and take priority over contact damage.
 * - In the frame a stomp happens (and for STOMP_GRACE_MS on the stomped enemy) no
 *   contact damage is dealt, so stomping clustered enemies never hurts.
 * - Player invulnerability (`Player.isInvulnerable`) blocks contact and projectile damage.
 */
export class CombatSystem {
  /** Level time of the most recent stomp — no contact damage in the same frame. */
  private lastStompAt = -1;

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
      physics.add.collider(player, oneway);
      physics.add.collider(groups.enemies, oneway);
      physics.add.collider(groups.pickups, oneway);
    }
    physics.add.collider(player, groups.platforms, undefined, (_p, plat) => this.platformProcess(plat as Phaser.GameObjects.GameObject));
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
    physics.add.collider(
      groups.enemyProjectiles,
      ground,
      (proj) => {
        const s = proj as EnemyShot;
        if (s.onHitWall) s.onHitWall();
        else s.destroy();
      },
      (proj) => !(proj as EnemyShot).ignoreTerrain,
    );

    // Player vs enemies
    physics.add.overlap(player, groups.enemies, (_p, e) => this.playerVsEnemy(e as Enemy));

    // Enemies vs enemies: kicked cone shells knock out whatever they hit.
    physics.add.overlap(groups.enemies, groups.enemies, (a, b) => this.enemyVsEnemy(a as Enemy, b as Enemy));

    // Player projectiles vs enemies
    physics.add.overlap(groups.playerProjectiles, groups.enemies, (proj, e) => {
      const enemy = e as Enemy;
      const p = proj as unknown as PlayerProjectile & Phaser.GameObjects.GameObject;
      if (enemy.dead || !enemy.active || !p.active) return;
      enemy.takeHit({ amount: p.damage * player.attackPower, fromX: (proj as Phaser.Physics.Arcade.Sprite).x, kind: 'projectile' });
      p.onHitEnemy();
    });

    // Enemy projectiles vs player
    physics.add.overlap(player, groups.enemyProjectiles, (_p, proj) => {
      const s = proj as EnemyShot;
      if (!s.active || s.harmful === false) return;
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
      return p.body.velocity.y >= 0 && p.body.prev.y + p.body.height <= body.top + 6;
    }
    return true;
  }

  private enemyVsEnemy(a: Enemy, b: Enemy): void {
    if (a === b || a.dead || b.dead || !a.active || !b.active) return;
    const ha = a.harmsEnemies();
    const hb = b.harmsEnemies();
    // 'contact' hits ignore shields; 3 damage defeats any regular enemy (bosses just take a chunk).
    if (ha) b.takeHit({ amount: SHELL_DAMAGE, fromX: a.x, kind: 'contact' });
    if (hb) a.takeHit({ amount: SHELL_DAMAGE, fromX: b.x, kind: 'contact' });
  }

  private playerVsEnemy(enemy: Enemy): void {
    const player: Player = this.ctx.player;
    if (enemy.dead || !enemy.active || !player.isAlive()) return;
    const now = this.ctx.now();
    const pb = player.body;
    const eb = enemy.body;
    const stomp = isStomp(
      { bottom: pb.bottom, prevBottom: pb.prev.y + pb.height, vy: pb.velocity.y },
      { top: eb.top, prevTop: eb.prev.y, height: eb.height },
    );
    if (stomp) {
      const outcome = enemy.stompOutcome();
      if (outcome === 'damage' || outcome === 'bounce') {
        this.lastStompAt = now;
        enemy.playerGraceUntil = now + STOMP_GRACE_MS;
        if (outcome === 'damage') enemy.onStomp();
        else this.ctx.sfx('bump');
        player.bounce(player.lastInput.jump);
        // Keep the player's feet above the enemy so the next frame doesn't re-overlap from the side.
        if (pb.bottom > eb.top) pb.y = eb.top - pb.height;
        return;
      }
    }
    if (player.attacking) {
      // Attacks (dash, ground pound…) win contact; a blocked attack (shield) is harmless both ways.
      enemy.takeHit({ amount: player.attackPower, fromX: player.x, kind: 'melee' });
      return;
    }
    if (enemy.onPlayerContact()) return;
    if (now === this.lastStompAt) return; // never hurt in the same frame as a stomp
    if (enemy.hurtsOnContact()) {
      player.hurt({ amount: enemy.contactDamage, fromX: enemy.x, kind: 'contact' });
    }
  }
}
