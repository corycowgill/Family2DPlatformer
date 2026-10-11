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
  duckable?: boolean;
  onHitPlayer?: () => void;
  onHitWall?: () => void;
};

/** After a stomp, the stomped enemy can't hurt the player for this long (ms). */
const STOMP_GRACE_MS = 180;
/** Damage a kicked cone shell deals to enemies it slides into. */
const SHELL_DAMAGE = 3;

type Collider = Phaser.Physics.Arcade.Collider;

/**
 * Wires all overlap/collision rules between the players, enemies, projectiles,
 * pickups, triggers, platforms and tile layers.
 *
 * Fairness rules:
 * - Stomps are generous (see `isStomp`) and take priority over contact damage.
 * - In the frame a stomp happens (and for STOMP_GRACE_MS on the stomped enemy) no
 *   contact damage is dealt, so stomping clustered enemies never hurts.
 * - Player invulnerability (`Player.isInvulnerable`) blocks contact and projectile damage.
 *
 * Co-op: every player gets the same colliders (`ctx.eachPlayer`), so Player 2 can drop in
 * at any time; leaving destroys theirs. Player 1's colliders are created in exactly the
 * single-player order (Arcade resolves colliders in creation order).
 */
export class CombatSystem {
  /** Level time of the most recent stomp — no contact damage in the same frame. */
  private lastStompAt = -1;

  constructor(private ctx: LevelContext) {
    const { scene, groups, ground, oneway } = ctx;
    const player = ctx.player;
    const physics = scene.physics;
    const p1: Collider[] = [];

    // Terrain
    p1.push(physics.add.collider(player, ground));
    physics.add.collider(groups.enemies, ground);
    physics.add.collider(groups.pickups, ground);
    if (oneway) {
      // One-way tiles only collide on their top face (set up in LevelScene).
      // Player can drop through them (down + jump) — see Player.isDroppingThrough.
      p1.push(this.onewayCollider(player));
      physics.add.collider(groups.enemies, oneway);
      physics.add.collider(groups.pickups, oneway);
    }
    p1.push(this.platformCollider(player));
    physics.add.collider(groups.enemies, groups.platforms);
    p1.push(...this.tileHazards(player));

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
    p1.push(this.enemyOverlap(player));

    // Enemies vs enemies: kicked cone shells knock out whatever they hit.
    physics.add.overlap(groups.enemies, groups.enemies, (a, b) => this.enemyVsEnemy(a as Enemy, b as Enemy));

    // Player projectiles vs enemies (damage scales with the shooter's attack power).
    physics.add.overlap(groups.playerProjectiles, groups.enemies, (proj, e) => {
      const enemy = e as Enemy;
      const p = proj as unknown as PlayerProjectile & Phaser.GameObjects.GameObject & { owner?: { attackPower: number } };
      if (enemy.dead || !enemy.active || !p.active) return;
      const power = (p.owner ?? ctx.player).attackPower;
      enemy.takeHit({ amount: p.damage * power, fromX: (proj as Phaser.Physics.Arcade.Sprite).x, kind: 'projectile' });
      p.onHitEnemy();
    });

    // Enemy projectiles, pickups & triggers
    p1.push(...this.contactOverlaps(player));

    // Later players (co-op drop-in) get the same per-player colliders.
    ctx.eachPlayer((p) => {
      const made = p === player ? p1 : this.addPlayer(p);
      return () => {
        for (const c of made) if (c.world) c.destroy();
      };
    });
  }

  /** All per-player colliders for a player who joined after the level was built. */
  private addPlayer(player: Player): Collider[] {
    const { scene, ground, oneway } = this.ctx;
    const out: Collider[] = [scene.physics.add.collider(player, ground)];
    if (oneway) out.push(this.onewayCollider(player));
    out.push(this.platformCollider(player));
    out.push(...this.tileHazards(player));
    out.push(this.enemyOverlap(player));
    out.push(...this.contactOverlaps(player));
    return out;
  }

  private onewayCollider(player: Player): Collider {
    return this.ctx.scene.physics.add.collider(player, this.ctx.oneway!, undefined, () => !player.isDroppingThrough());
  }

  private platformCollider(player: Player): Collider {
    return this.ctx.scene.physics.add.collider(
      player,
      this.ctx.groups.platforms,
      (_p, plat) => player.setGroundPlatform((plat as Phaser.GameObjects.GameObject).body as Phaser.Physics.Arcade.Body),
      (_p, plat) => this.platformProcess(player, plat as Phaser.GameObjects.GameObject),
    );
  }

  private tileHazards(player: Player): Collider[] {
    const { scene, hazards, water } = this.ctx;
    const physics = scene.physics;
    const out: Collider[] = [];
    if (hazards) {
      out.push(
        physics.add.overlap(player, hazards, undefined, (_p, tile) => {
          const t = tile as Phaser.Tilemaps.Tile;
          if (t.index > 0) player.hurt({ amount: 1, fromX: t.getCenterX(), kind: 'hazard' });
          return false;
        }),
      );
    }
    if (water) {
      out.push(
        physics.add.overlap(player, water, undefined, (_p, tile) => {
          const t = tile as Phaser.Tilemaps.Tile;
          // Only die once the player's body is mostly submerged.
          if (t.index > 0 && player.body.bottom > t.getTop() + 6) player.die('pit');
          return false;
        }),
      );
    }
    return out;
  }

  private enemyOverlap(player: Player): Collider {
    return this.ctx.scene.physics.add.overlap(player, this.ctx.groups.enemies, (_p, e) => this.playerVsEnemy(player, e as Enemy));
  }

  private contactOverlaps(player: Player): Collider[] {
    const ctx = this.ctx;
    const { scene, groups } = ctx;
    const physics = scene.physics;
    return [
      physics.add.overlap(player, groups.enemyProjectiles, (_p, proj) => {
        const s = proj as EnemyShot;
        if (!s.active || s.harmful === false) return;
        if (!player.isAlive()) return;
        if (player.isInvulnerable()) return;
        if (s.duckable && this.isDucking(player, s.body as Phaser.Physics.Arcade.Body)) return;
        player.hurt({ amount: s.damage ?? 1, fromX: s.x, kind: 'projectile' });
        if (s.onHitPlayer) s.onHitPlayer();
        else s.destroy();
      }),
      physics.add.overlap(player, groups.pickups, (_p, c) => {
        if (player.isAlive()) (c as unknown as Collectible).collect(ctx, player);
      }),
      physics.add.overlap(player, groups.triggers, (_p, t) => (t as unknown as Trigger).onPlayerOverlap(ctx, player)),
    ];
  }

  /**
   * Ducking under a high attack: holding down while (nearly) on the ground counts as crouched,
   * even on frames where the crouch hitbox hasn't been applied yet.
   */
  private isDucking(p: Player, shot: Phaser.Physics.Arcade.Body): boolean {
    if (!p.lastInput.down || Math.abs(p.body.velocity.y) > 40) return false;
    const crouchTop = p.body.bottom - p.def.body.crouchHeight;
    return shot.bottom <= crouchTop + 1;
  }

  /** One-way moving platforms: only collide from above. Platforms opt in via `oneWay` data. */
  private platformProcess(p: Player, plat: Phaser.GameObjects.GameObject): boolean {
    if (!p.isAlive()) return false;
    const body = plat.body as Phaser.Physics.Arcade.Body;
    if (plat.getData('oneWay')) {
      if (p.isDroppingThrough()) return false;
      // Relative velocity so riders of rising platforms stay on.
      return p.body.velocity.y >= body.velocity.y && p.body.prev.y + p.body.height <= body.prev.y + 6;
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

  private playerVsEnemy(player: Player, enemy: Enemy): void {
    if (enemy.dead || !enemy.active || !player.isAlive()) return;
    // Enemy hooks (onStomp, onPlayerContact, takeHit…) read `enemy.player` → this player.
    const prev = enemy.contactPlayer;
    enemy.contactPlayer = player;
    try {
      this.contactRules(player, enemy);
    } finally {
      enemy.contactPlayer = prev;
    }
  }

  private contactRules(player: Player, enemy: Enemy): void {
    // Star power, Brennan's dash, Dad's ground pound…
    if (player.onEnemyContact(enemy)) return;
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
