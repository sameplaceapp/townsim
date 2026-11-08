const townConfig = require('../../config/town.json');
const charsConfig = require('../../config/characters.json');
const { Character } = require('./character');

class World {
  constructor(config) {
    this.config = config;
    this.tick = 0;
    this.time = { day: 1, hour: 6, minute: 0 };
    this.phase = 'dawn';
    this.gridWidth = config.world.gridWidth;
    this.gridHeight = config.world.gridHeight;
    this.grid = [];
    this.buildings = {};
    this.characters = [];
    this.activityLog = [];
    this.maxLogEntries = config.simulation.maxLogEntries;

    this.buildGrid();
    this.loadBuildings();
    this.loadCharacters();
  }

  buildGrid() {
    // Initialize with grass
    this.grid = Array.from({ length: this.gridHeight }, () =>
      Array.from({ length: this.gridWidth }, () => 0)
    );

    // Place water features
    for (const water of townConfig.waterFeatures || []) {
      for (let y = water.y; y < Math.min(water.y + water.h, this.gridHeight); y++) {
        for (let x = water.x; x < Math.min(water.x + water.w, this.gridWidth); x++) {
          this.grid[y][x] = 2;
        }
      }
    }

    // Place trees
    for (const zone of townConfig.treeZones || []) {
      for (let y = zone.y; y < Math.min(zone.y + zone.h, this.gridHeight); y++) {
        for (let x = zone.x; x < Math.min(zone.x + zone.w, this.gridWidth); x++) {
          if (Math.random() < zone.density) {
            this.grid[y][x] = 6;
          }
        }
      }
    }

    // Place paths
    for (const p of townConfig.paths || []) {
      this.drawPath(p.from[0], p.from[1], p.to[0], p.to[1]);
    }

    // Place buildings
    for (const b of townConfig.buildings) {
      // Walls
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          if (y < this.gridHeight && x < this.gridWidth) {
            this.grid[y][x] = y === b.y ? 8 : 3; // roof on top row, walls elsewhere
          }
        }
      }
      // Door
      if (b.door) {
        const [dx, dy] = b.door;
        if (dy < this.gridHeight && dx < this.gridWidth) {
          this.grid[dy][dx] = 5;
        }
      }
    }

    // Place flowers near park
    const park = townConfig.buildings.find(b => b.id === 'park');
    if (park) {
      for (let y = park.y; y < park.y + park.h; y++) {
        for (let x = park.x; x < park.x + park.w; x++) {
          if (y < this.gridHeight && x < this.gridWidth && this.grid[y][x] === 0) {
            if (Math.random() < 0.3) this.grid[y][x] = 9;
          }
        }
      }
    }

    // Place crops near farm
    const farm = townConfig.buildings.find(b => b.id === 'farm');
    if (farm) {
      for (let y = farm.y + farm.h; y < Math.min(farm.y + farm.h + 3, this.gridHeight); y++) {
        for (let x = farm.x; x < Math.min(farm.x + farm.w, this.gridWidth); x++) {
          if (this.grid[y][x] === 0) this.grid[y][x] = 11;
        }
      }
    }

    // Sand near docks/water
    const docks = townConfig.buildings.find(b => b.id === 'docks');
    if (docks) {
      for (let y = docks.y - 1; y < Math.min(docks.y + docks.h + 1, this.gridHeight); y++) {
        for (let x = docks.x - 1; x < Math.min(docks.x + docks.w + 1, this.gridWidth); x++) {
          if (y >= 0 && x >= 0 && this.grid[y][x] === 0) {
            this.grid[y][x] = 10;
          }
        }
      }
    }
  }

  drawPath(x1, y1, x2, y2) {
    // Draw L-shaped path
    const midX = x2;
    // Horizontal segment
    const startX = Math.min(x1, midX);
    const endX = Math.max(x1, midX);
    for (let x = startX; x <= endX; x++) {
      if (y1 >= 0 && y1 < this.gridHeight && x >= 0 && x < this.gridWidth) {
        if (this.grid[y1][x] === 0 || this.grid[y1][x] === 9) {
          this.grid[y1][x] = 1;
        }
      }
    }
    // Vertical segment
    const startY = Math.min(y1, y2);
    const endY = Math.max(y1, y2);
    for (let y = startY; y <= endY; y++) {
      if (y >= 0 && y < this.gridHeight && x2 >= 0 && x2 < this.gridWidth) {
        if (this.grid[y][x2] === 0 || this.grid[y][x2] === 9) {
          this.grid[y][x2] = 1;
        }
      }
    }
  }

  loadBuildings() {
    for (const b of townConfig.buildings) {
      this.buildings[b.id] = { ...b };
    }
  }

  loadCharacters() {
    for (const charDef of charsConfig.characters) {
      const building = this.buildings[charDef.home];
      const spawnPos = building ? { x: building.door[0], y: building.door[1] } : { x: 28, y: 20 };
      const char = new Character(charDef, spawnPos);
      this.characters.push(char);
    }

    // Load initial relationships with enhanced multi-dimensional format
    for (const rel of charsConfig.initialRelationships) {
      const charA = this.characters.find(c => c.id === rel.a);
      const charB = this.characters.find(c => c.id === rel.b);
      if (charA && charB) {
        const level = rel.level;
        charA.relationships[rel.b] = {
          affection: level,
          trust: Math.max(3, level - 1),
          attraction: rel.attraction || 1,
          respect: 5,
          tag: rel.tag,
          level: level,
          interactionCount: 0
        };
        charB.relationships[rel.a] = {
          affection: level,
          trust: Math.max(3, level - 1),
          attraction: rel.attraction || 1,
          respect: 5,
          tag: rel.tag,
          level: level,
          interactionCount: 0
        };
      }
    }
  }

  advanceClock(timePerTick) {
    this.time.minute += timePerTick;
    while (this.time.minute >= 60) {
      this.time.minute -= 60;
      this.time.hour++;
    }
    while (this.time.hour >= 24) {
      this.time.hour -= 24;
      this.time.day++;
    }
    this.phase = this.getPhase();
  }

  getPhase() {
    const h = this.time.hour;
    if (h >= 5 && h < 7) return 'dawn';
    if (h >= 7 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 20) return 'evening';
    return 'night';
  }

  getTimeString() {
    const h = this.time.hour.toString().padStart(2, '0');
    const m = this.time.minute.toString().padStart(2, '0');
    return `Day ${this.time.day} ${h}:${m}`;
  }

  addLog(entry) {
    this.activityLog.push({
      tick: this.tick,
      time: this.getTimeString(),
      ...entry
    });
    if (this.activityLog.length > this.maxLogEntries) {
      this.activityLog.shift();
    }
  }

  isWalkable(x, y) {
    if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) return false;
    const tile = this.grid[y][x];
    const tileType = townConfig.tileTypes[tile.toString()];
    return tileType ? tileType.walkable : false;
  }

  getBuildingAt(x, y) {
    for (const [id, b] of Object.entries(this.buildings)) {
      if (b.door && b.door[0] === x && b.door[1] === y) return id;
    }
    return null;
  }

  getCharactersNear(x, y, radius = 2) {
    return this.characters.filter(c =>
      Math.abs(c.pos.x - x) <= radius && Math.abs(c.pos.y - y) <= radius
    );
  }

  toJSON() {
    return {
      tick: this.tick,
      time: { ...this.time },
      phase: this.phase,
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      grid: this.grid,
      buildings: this.buildings,
      characters: this.characters.map(c => c.toDetail()),
      activityLog: this.activityLog.slice(-50)
    };
  }
}

module.exports = { World };
