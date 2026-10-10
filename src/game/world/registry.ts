import type { Spawner } from './LevelContext';

/**
 * Spawner registry: maps a Tiled object `type` (e.g. "enemy", "coin", "movingPlatform")
 * to a factory. Each team registers its own spawners from its own module (see
 * registerAll.ts) so no single file becomes a merge hotspot.
 */
const spawners = new Map<string, Spawner>();

export function registerSpawner(type: string, fn: Spawner): void {
  spawners.set(type, fn);
}

export function getSpawner(type: string): Spawner | undefined {
  return spawners.get(type);
}

export function registeredTypes(): string[] {
  return [...spawners.keys()];
}
