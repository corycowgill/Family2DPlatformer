/**
 * TILESET CONTRACT — shared between the Art team (draws the tileset image) and the
 * Level team (places tiles). The tileset image is `public/assets/tilesets/chicago-tiles.png`,
 * 16x16 tiles, 16 columns. Tile `index` is the 0-based position in that image
 * (Tiled gid = index + 1). Collision is decided by which map LAYER a tile is on
 * (see LAYERS), not by the tile itself, so any tile can be decor or solid.
 */

export const TILESET_NAME = 'chicago-tiles';
export const TILESET_KEY = 'tiles';
export const TILESET_COLUMNS = 16;

export const LAYERS = {
  /** Decorative tiles behind everything gameplay-related (no collision). */
  background: 'background',
  /** Fully solid tiles. */
  ground: 'ground',
  /** One-way platforms: solid only from above. */
  oneway: 'oneway',
  /** Touching any tile on this layer damages the player (spikes, electric rail). */
  hazards: 'hazards',
  /** Instant-death liquid (river water) — respawn at checkpoint. */
  water: 'water',
  /** Decor drawn in front of the player. */
  foreground: 'foreground',
  /** Object layer with entity spawns. */
  entities: 'entities',
} as const;

/** Named tile indices. Order == position in the tileset image. */
export const TILE = {
  // Row 0 — street level
  SIDEWALK_L: 0,
  SIDEWALK: 1,
  SIDEWALK_R: 2,
  CONCRETE: 3,
  CONCRETE_CRACKED: 4,
  ASPHALT_TOP: 5,
  ASPHALT: 6,
  CURB: 7,
  MANHOLE: 8,
  GRATE: 9,
  PLANTER_L: 10,
  PLANTER: 11,
  PLANTER_R: 12,
  DIRT: 13,
  SOIL_TOP: 14,
  SUBWAY_TILE: 15,
  // Row 1 — buildings
  LIMESTONE_TOP: 16,
  LIMESTONE: 17,
  LIMESTONE_WINDOW: 18,
  LIMESTONE_ARCH: 19,
  BRICK_TOP: 20,
  BRICK: 21,
  BRICK_WINDOW: 22,
  GLASS: 23,
  GLASS_FRAME: 24,
  ROOF_TOP: 25,
  ROOF: 26,
  ROOF_EDGE_L: 27,
  ROOF_EDGE_R: 28,
  AWNING_L: 29,
  AWNING: 30,
  AWNING_R: 31,
  // Row 2 — elevated train / steel
  GIRDER_TOP: 32,
  GIRDER: 33,
  GIRDER_X: 34,
  GIRDER_POST: 35,
  RAIL_TIE: 36,
  RAIL: 37,
  RIVET_PLATE: 38,
  SCAFFOLD_PLANK: 39,
  SCAFFOLD_FRAME: 40,
  STEEL_BLOCK: 41,
  WARNING_STRIPE: 42,
  ELECTRIC_RAIL: 43,
  SPIKES: 44,
  CHAIN_FENCE: 45,
  VENT: 46,
  PIPE_H: 47,
  // Row 3 — river & bridges
  RIVERWALK_TOP: 48,
  RIVERWALK: 49,
  WOOD_PLANK: 50,
  WOOD_POST: 51,
  BRIDGE_DECK: 52,
  BRIDGE_TRUSS: 53,
  BRIDGE_RAIL: 54,
  WATER_TOP: 55,
  WATER: 56,
  STONE_WALL: 57,
  STONE_WALL_TOP: 58,
  LOWER_WACKER: 59,
  PILLAR: 60,
  PILLAR_CAP: 61,
  RAILING: 62,
  BUSH: 63,
} as const;

export type TileName = keyof typeof TILE;
export const TILE_COUNT = 64;
