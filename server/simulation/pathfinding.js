class PathFinder {
  constructor(world) {
    this.world = world;
  }

  findPath(startX, startY, endX, endY) {
    if (startX === endX && startY === endY) return [];
    if (!this.world.isWalkable(endX, endY)) {
      // Try adjacent walkable tiles
      const adj = this.getAdjacentWalkable(endX, endY);
      if (adj.length === 0) return [];
      // Pick closest adjacent tile
      let best = adj[0];
      let bestDist = Math.abs(adj[0].x - startX) + Math.abs(adj[0].y - startY);
      for (let i = 1; i < adj.length; i++) {
        const d = Math.abs(adj[i].x - startX) + Math.abs(adj[i].y - startY);
        if (d < bestDist) { bestDist = d; best = adj[i]; }
      }
      endX = best.x;
      endY = best.y;
    }

    const open = new Map();
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${startX},${startY}`;
    const endKey = `${endX},${endY}`;

    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristic(startX, startY, endX, endY));
    open.set(startKey, { x: startX, y: startY });

    let iterations = 0;
    const maxIterations = 2000;

    while (open.size > 0 && iterations < maxIterations) {
      iterations++;

      // Find node with lowest fScore
      let currentKey = null;
      let currentF = Infinity;
      for (const [key] of open) {
        const f = fScore.get(key) || Infinity;
        if (f < currentF) { currentF = f; currentKey = key; }
      }

      if (currentKey === endKey) {
        return this.reconstructPath(cameFrom, currentKey);
      }

      const current = open.get(currentKey);
      open.delete(currentKey);
      closed.add(currentKey);

      const neighbors = this.getNeighbors(current.x, current.y);
      for (const n of neighbors) {
        const nKey = `${n.x},${n.y}`;
        if (closed.has(nKey)) continue;

        const tentativeG = (gScore.get(currentKey) || 0) + 1;
        const existingG = gScore.get(nKey);

        if (existingG === undefined || tentativeG < existingG) {
          cameFrom.set(nKey, currentKey);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + this.heuristic(n.x, n.y, endX, endY));
          if (!open.has(nKey)) {
            open.set(nKey, n);
          }
        }
      }
    }

    // No path found - return partial path toward target
    return this.fallbackPath(startX, startY, endX, endY);
  }

  heuristic(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  getNeighbors(x, y) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const result = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.world.isWalkable(nx, ny)) {
        result.push({ x: nx, y: ny });
      }
    }
    return result;
  }

  getAdjacentWalkable(x, y) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const result = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.world.isWalkable(nx, ny)) {
        result.push({ x: nx, y: ny });
      }
    }
    return result;
  }

  reconstructPath(cameFrom, currentKey) {
    const path = [];
    let key = currentKey;
    while (cameFrom.has(key)) {
      const [x, y] = key.split(',').map(Number);
      path.unshift({ x, y });
      key = cameFrom.get(key);
    }
    return path;
  }

  fallbackPath(startX, startY, endX, endY) {
    // Simple greedy walk toward target, up to 5 steps
    const path = [];
    let x = startX;
    let y = startY;
    for (let i = 0; i < 5; i++) {
      const dx = endX - x;
      const dy = endY - y;
      if (dx === 0 && dy === 0) break;

      let nx, ny;
      if (Math.abs(dx) > Math.abs(dy)) {
        nx = x + Math.sign(dx);
        ny = y;
      } else {
        nx = x;
        ny = y + Math.sign(dy);
      }

      if (this.world.isWalkable(nx, ny)) {
        path.push({ x: nx, y: ny });
        x = nx;
        y = ny;
      } else {
        break;
      }
    }
    return path;
  }
}

module.exports = { PathFinder };
