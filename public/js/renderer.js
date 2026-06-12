// Procedural pixel-art renderer for Willowbrook.
//
// The static world (terrain, buildings, trees, lamps) is pre-rendered once
// into an offscreen canvas at 16 logical px per tile, then blitted each frame
// with nearest-neighbor scaling for a crisp pixel-art look at any zoom.
// Animated layers (water, fountain, smoke, characters, day/night light,
// labels) are drawn on top every frame.

const U = 16; // logical pixels per tile in the pre-rendered world canvas

function hash2(x, y, s = 0) {
  let h = ((x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 1442695041) | 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function strHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function hexRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

// f <= 1 darkens, f > 1 mixes toward white
function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  if (f <= 1) {
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }
  const t = Math.min(1, f - 1);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

function mixHex(a, b, t) {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

const SKIN_TONES = ['#f6d6b5', '#edc39a', '#dca87c', '#bd8a5e', '#9a6a42'];
const HAIR_COLORS = ['#3a2a1c', '#553a22', '#7a4a26', '#a06a30', '#c89b52', '#8c8c8c', '#b05038', '#46465a'];
const LONG_HAIR_IDS = new Set(['alice', 'carol', 'emma', 'grace', 'ivy', 'kate']);

const ROOF_PALETTE = ['#bc5a41', '#9a6b44', '#a84c3f', '#b08550', '#7d9457', '#8a6f5a'];
const ROOF_OVERRIDES = {
  church: '#76879f', farm: '#8a6b4a', tavern: '#7e5435',
  bakery: '#c9743f', guardpost: '#6e7884'
};

// Day/night tint keyframes: hour -> { color, alpha }
const TINT_STOPS = [
  { t: 0.0,  c: [22, 30, 70],   a: 0.52 },
  { t: 4.5,  c: [22, 30, 70],   a: 0.52 },
  { t: 5.5,  c: [90, 60, 100],  a: 0.34 },
  { t: 6.5,  c: [230, 140, 90], a: 0.20 },
  { t: 8.0,  c: [255, 214, 150],a: 0.05 },
  { t: 9.5,  c: [255, 255, 255],a: 0.00 },
  { t: 16.0, c: [255, 255, 255],a: 0.00 },
  { t: 17.5, c: [255, 196, 120],a: 0.10 },
  { t: 19.0, c: [235, 120, 80], a: 0.24 },
  { t: 20.5, c: [80, 60, 115],  a: 0.40 },
  { t: 22.0, c: [22, 30, 70],   a: 0.52 },
  { t: 24.0, c: [22, 30, 70],   a: 0.52 }
];

class Renderer {
  constructor(bgCanvas, fgCanvas, camera, tileSize) {
    this.bgCanvas = bgCanvas;
    this.fgCanvas = fgCanvas;
    this.bgCtx = bgCanvas.getContext('2d');
    this.fgCtx = fgCanvas.getContext('2d');
    this.camera = camera;
    this.tileSize = tileSize;
    this.ts = camera.ts;
    this.viewW = 0;
    this.viewH = 0;

    this.grid = null;
    this.buildings = {};
    this.world = null;       // offscreen pre-rendered world canvas

    this.windows = [];       // {x,y,w,h,bid,home} in logical px
    this.lamps = [];         // {x,y} logical px (bulb center)
    this.chimneys = [];      // {x,y,bid} logical px (smoke origin)
    this.fountain = null;    // {x,y} logical px
    this.boat = null;        // {x,y} logical px
    this.fireflySpots = [];  // {x,y,ph,s1,s2} tile coords

    this.particles = [];     // emoji particles
    this.smoke = [];         // chimney smoke puffs
    this._facing = {};       // charId -> {x,y,dir}
    this._occ = {};          // buildingId -> occupants[]
    this._darkness = 0;
    this._lastSmokeSpawn = 0;
  }

  // ============================================================
  // Setup
  // ============================================================

  setWorldData(grid, buildings) {
    this.grid = grid;
    this.buildings = buildings;
    this.buildWorldCanvas();
  }

  resize(width, height, dpr = 1) {
    this.viewW = width;
    this.viewH = height;
    for (const canvas of [this.bgCanvas, this.fgCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }
    this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bgCtx.imageSmoothingEnabled = false;
    this.fgCtx.imageSmoothingEnabled = false;
    this.camera.setViewSize(width, height);
  }

  tileAt(x, y) {
    if (!this.grid || y < 0 || y >= this.grid.length || x < 0 || x >= this.grid[0].length) return -1;
    return this.grid[y][x];
  }

  // ============================================================
  // Static world pre-render
  // ============================================================

  buildWorldCanvas() {
    const gh = this.grid.length;
    const gw = this.grid[0].length;
    const c = document.createElement('canvas');
    c.width = gw * U;
    c.height = gh * U;
    const ctx = c.getContext('2d');

    this.windows = [];
    this.lamps = [];
    this.chimneys = [];
    this.fountain = null;
    this.boat = null;
    this.fireflySpots = [];

    const trees = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        this.paintTile(ctx, x, y, this.grid[y][x]);
        if (this.grid[y][x] === 6) trees.push([x, y]);
      }
    }

    this.placeLamps(gw, gh);

    // Buildings (plaza and docks get special treatment)
    const sorted = Object.values(this.buildings).sort((a, b) => a.y - b.y);
    for (const b of sorted) {
      if (b.type === 'recreation') this.paintPlaza(ctx, b);
      else if (b.id === 'docks') this.paintDocks(ctx, b);
      else this.paintBuilding(ctx, b);
    }

    // Trees overlap everything organically
    for (const [x, y] of trees) this.paintTree(ctx, x, y);

    for (const lamp of this.lamps) this.paintLamp(ctx, lamp);

    // Firefly spots: grass tiles near trees or flowers
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = this.grid[y][x];
        if (t !== 0 && t !== 9 && t !== 11) continue;
        let nearTree = t === 9;
        for (let dy = -2; dy <= 2 && !nearTree; dy++) {
          for (let dx = -2; dx <= 2 && !nearTree; dx++) {
            if (this.tileAt(x + dx, y + dy) === 6) nearTree = true;
          }
        }
        if (nearTree && hash2(x, y, 21) < 0.12 && this.fireflySpots.length < 36) {
          this.fireflySpots.push({
            x, y,
            ph: hash2(x, y, 22) * 6.283,
            s1: 0.6 + hash2(x, y, 23) * 0.8,
            s2: 0.7 + hash2(x, y, 24) * 0.9
          });
        }
      }
    }

    this.world = c;
  }

  paintTile(ctx, x, y, t) {
    const px = x * U, py = y * U;

    const grassBase = () => {
      // two overlapping patch grids so tone changes don't form hard squares
      const patch = (hash2(x >> 2, y >> 2, 1) + hash2((x + 2) >> 2, (y + 2) >> 2, 1)) / 2;
      ctx.fillStyle = patch < 0.4 ? '#69aa4d' : patch < 0.6 ? '#6bac4f' : '#68a84c';
      ctx.fillRect(px, py, U, U);
      // dither dots
      for (let i = 0; i < 3; i++) {
        const hx = hash2(x, y, 30 + i), hy = hash2(x, y, 40 + i);
        ctx.fillStyle = hash2(x, y, 50 + i) < 0.5 ? 'rgba(50,110,40,0.35)' : 'rgba(150,205,110,0.3)';
        ctx.fillRect(px + Math.floor(hx * 14), py + Math.floor(hy * 14), 2, 2);
      }
      // grass blades
      if (hash2(x, y, 2) < 0.45) {
        const bx = px + 2 + Math.floor(hash2(x, y, 3) * 11);
        const by = py + 3 + Math.floor(hash2(x, y, 4) * 10);
        ctx.fillStyle = '#4e8c3a';
        ctx.fillRect(bx, by, 1, 3);
        ctx.fillRect(bx + 2, by + 1, 1, 2);
      }
      // rare tiny flower
      const fl = hash2(x, y, 5);
      if (fl < 0.05) {
        const fx = px + 3 + Math.floor(hash2(x, y, 6) * 9);
        const fy = py + 3 + Math.floor(hash2(x, y, 7) * 9);
        ctx.fillStyle = fl < 0.025 ? '#f2e28a' : '#f0f0ea';
        ctx.fillRect(fx, fy, 2, 2);
        ctx.fillStyle = '#e8a83a';
        ctx.fillRect(fx, fy, 1, 1);
      }
      // rare pebble
      if (hash2(x, y, 8) < 0.02) {
        ctx.fillStyle = '#9aa090';
        ctx.fillRect(px + 10, py + 11, 3, 2);
        ctx.fillStyle = '#c0c4b4';
        ctx.fillRect(px + 10, py + 11, 2, 1);
      }
      // occasional small bush to break up open fields
      if (hash2(x, y, 9) < 0.022) {
        const bx2 = px + 4 + Math.floor(hash2(x, y, 10) * 6);
        const by2 = py + 5 + Math.floor(hash2(x, y, 13) * 5);
        ctx.fillStyle = 'rgba(20,40,15,0.18)';
        ctx.beginPath(); ctx.ellipse(bx2, by2 + 3, 4.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#458538';
        ctx.beginPath(); ctx.arc(bx2, by2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#55a045';
        ctx.beginPath(); ctx.arc(bx2 - 1.5, by2 - 1.5, 2.5, 0, Math.PI * 2); ctx.fill();
        if (hash2(x, y, 14) < 0.3) { // berries
          ctx.fillStyle = '#d65a4a';
          ctx.fillRect(bx2 + 1, by2 - 1, 1, 1);
          ctx.fillRect(bx2 - 2, by2 + 1, 1, 1);
        }
      }
    };

    switch (t) {
      case 0: // grass
        grassBase();
        break;

      case 1: case 5: { // path / door step
        ctx.fillStyle = hash2(x, y, 1) < 0.5 ? '#d9bb7f' : '#d2b375';
        ctx.fillRect(px, py, U, U);
        // worn texture stones
        for (let i = 0; i < 3; i++) {
          const hx = Math.floor(hash2(x, y, 60 + i) * 12);
          const hy = Math.floor(hash2(x, y, 70 + i) * 12);
          ctx.fillStyle = hash2(x, y, 80 + i) < 0.5 ? 'rgba(170,135,80,0.45)' : 'rgba(240,222,170,0.5)';
          ctx.fillRect(px + 2 + hx, py + 2 + hy, 2, 2);
        }
        // soft edges where path meets grass
        const isPath = (v) => v === 1 || v === 5 || v === 12;
        ctx.fillStyle = 'rgba(140,110,60,0.35)';
        if (!isPath(this.tileAt(x, y - 1))) ctx.fillRect(px, py, U, 1);
        if (!isPath(this.tileAt(x, y + 1))) ctx.fillRect(px, py + U - 1, U, 1);
        if (!isPath(this.tileAt(x - 1, y))) ctx.fillRect(px, py, 1, U);
        if (!isPath(this.tileAt(x + 1, y))) ctx.fillRect(px + U - 1, py, 1, U);
        if (t === 5) { // stone doorstep
          ctx.fillStyle = '#c2bab0';
          ctx.fillRect(px + 3, py + 2, 10, 6);
          ctx.fillStyle = '#a8a094';
          ctx.fillRect(px + 3, py + 6, 10, 2);
        }
        break;
      }

      case 2: { // water
        const nbrs = [this.tileAt(x, y - 1), this.tileAt(x, y + 1), this.tileAt(x - 1, y), this.tileAt(x + 1, y)];
        const deep = nbrs.every(n => n === 2 || n === 12);
        ctx.fillStyle = deep ? '#3a6fb5' : '#4583c9';
        ctx.fillRect(px, py, U, U);
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = 'rgba(60,120,195,0.5)';
          ctx.fillRect(px + Math.floor(hash2(x, y, 90 + i) * 13), py + Math.floor(hash2(x, y, 95 + i) * 13), 3, 2);
        }
        // shoreline foam
        ctx.fillStyle = '#cfe7f4';
        if (nbrs[0] !== 2 && nbrs[0] !== 12 && nbrs[0] !== -1) ctx.fillRect(px, py, U, 2);
        if (nbrs[1] !== 2 && nbrs[1] !== 12 && nbrs[1] !== -1) ctx.fillRect(px, py + U - 2, U, 2);
        if (nbrs[2] !== 2 && nbrs[2] !== 12 && nbrs[2] !== -1) ctx.fillRect(px, py, 2, U);
        if (nbrs[3] !== 2 && nbrs[3] !== 12 && nbrs[3] !== -1) ctx.fillRect(px + U - 2, py, 2, U);
        // reeds at shore
        if (!deep && hash2(x, y, 11) < 0.18) {
          ctx.fillStyle = '#4f8e3f';
          const rx = px + 4 + Math.floor(hash2(x, y, 12) * 8);
          ctx.fillRect(rx, py + 4, 1, 6);
          ctx.fillRect(rx + 2, py + 6, 1, 4);
          ctx.fillStyle = '#8a6238';
          ctx.fillRect(rx, py + 3, 1, 2);
        }
        break;
      }

      case 3: case 8: case 4: // building interior — covered by structures
        grassBase();
        break;

      case 6: // tree base — grass under canopy
        grassBase();
        break;

      case 7: { // fence
        grassBase();
        ctx.fillStyle = '#8a6238';
        ctx.fillRect(px + 2, py + 4, 3, 10);
        ctx.fillRect(px + 11, py + 4, 3, 10);
        ctx.fillStyle = '#a07a4c';
        ctx.fillRect(px, py + 6, U, 2);
        ctx.fillRect(px, py + 10, U, 2);
        break;
      }

      case 9: { // flowers
        grassBase();
        const colors = ['#e87a90', '#f2d24f', '#f0f0e8', '#b07ad0', '#e89050'];
        for (let i = 0; i < 4; i++) {
          const fx = px + 1 + Math.floor(hash2(x, y, 100 + i) * 12);
          const fy = py + 1 + Math.floor(hash2(x, y, 110 + i) * 12);
          ctx.fillStyle = '#4e8c3a';
          ctx.fillRect(fx + 1, fy + 2, 1, 2);
          ctx.fillStyle = colors[Math.floor(hash2(x, y, 120 + i) * colors.length)];
          ctx.fillRect(fx, fy, 3, 2);
          ctx.fillStyle = '#fff7d0';
          ctx.fillRect(fx + 1, fy, 1, 1);
        }
        break;
      }

      case 10: { // sand
        ctx.fillStyle = hash2(x, y, 1) < 0.5 ? '#ecdca8' : '#e6d49e';
        ctx.fillRect(px, py, U, U);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? 'rgba(200,170,110,0.6)' : 'rgba(255,245,210,0.7)';
          ctx.fillRect(px + Math.floor(hash2(x, y, 130 + i) * 14), py + Math.floor(hash2(x, y, 140 + i) * 14), 2, 1);
        }
        if (hash2(x, y, 15) < 0.05) { // little shell
          ctx.fillStyle = '#e0b8c0';
          ctx.fillRect(px + 7, py + 8, 2, 2);
        }
        break;
      }

      case 11: { // crops
        ctx.fillStyle = '#9b7044';
        ctx.fillRect(px, py, U, U);
        ctx.fillStyle = '#875f38';
        ctx.fillRect(px, py + 3, U, 2);
        ctx.fillRect(px, py + 8, U, 2);
        ctx.fillRect(px, py + 13, U, 2);
        const mature = hash2(x, y, 16) < 0.5;
        for (const ry of [2, 7, 12]) {
          for (let i = 0; i < 3; i++) {
            const cx = px + 2 + i * 5 + Math.floor(hash2(x, y, ry + i) * 2);
            if (mature) {
              ctx.fillStyle = '#c9a84f';
              ctx.fillRect(cx, ry + py - 1, 2, 4);
              ctx.fillStyle = '#e3c46a';
              ctx.fillRect(cx, ry + py - 1, 2, 1);
            } else {
              ctx.fillStyle = '#6fae3f';
              ctx.fillRect(cx, ry + py, 2, 3);
              ctx.fillStyle = '#4f8e2f';
              ctx.fillRect(cx, ry + py + 2, 2, 1);
            }
          }
        }
        break;
      }

      case 12: { // bridge
        ctx.fillStyle = '#9a7752';
        ctx.fillRect(px, py, U, U);
        ctx.fillStyle = '#85643f';
        for (let i = 0; i < U; i += 4) ctx.fillRect(px, py + i, U, 1);
        ctx.fillStyle = '#6b4a2f';
        ctx.fillRect(px, py, 2, U);
        ctx.fillRect(px + U - 2, py, 2, U);
        break;
      }

      default:
        grassBase();
    }
  }

  paintTree(ctx, x, y) {
    const px = x * U + 8, py = y * U + 8; // tile center
    const jx = Math.floor((hash2(x, y, 200) - 0.5) * 5);
    const jy = Math.floor((hash2(x, y, 201) - 0.5) * 5);
    const cx = px + jx, cy = py + jy;
    const pine = hash2(x, y, 202) > 0.7;

    // ground shadow
    ctx.fillStyle = 'rgba(20,40,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (pine) {
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(cx - 1, cy + 2, 3, 5);
      const layers = [
        [9, 4, '#2f6e3d'],
        [7, 0, '#3c8449'],
        [5, -4, '#4f9a55']
      ];
      for (const [w, oy, col] of layers) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx, cy + oy - 7);
        ctx.lineTo(cx - w, cy + oy + 2);
        ctx.lineTo(cx + w, cy + oy + 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cx - 2, cy - 9, 2, 1);
    } else {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(cx - 1, cy + 1, 3, 6);
      ctx.fillStyle = '#5d3e22';
      ctx.fillRect(cx + 1, cy + 1, 1, 6);
      ctx.fillStyle = '#3c7c34';
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4f9a42';
      ctx.beginPath();
      ctx.arc(cx - 1, cy - 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#69b455';
      ctx.beginPath();
      ctx.arc(cx - 2.5, cy - 5.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (hash2(x, y, 203) < 0.25) { // fruit
        ctx.fillStyle = '#d65a4a';
        ctx.fillRect(cx + 3, cy - 3, 2, 2);
        ctx.fillRect(cx - 4, cy + 1, 2, 2);
      }
    }
  }

  placeLamps(gw, gh) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (this.grid[y][x] !== 1) continue;
        if (hash2(x, y, 210) > 0.05) continue;
        const lx = x * U + 8, ly = y * U + 4;
        let tooClose = false;
        for (const l of this.lamps) {
          if (Math.abs(l.x - lx) + Math.abs(l.y - ly) < 7 * U) { tooClose = true; break; }
        }
        if (!tooClose) this.lamps.push({ x: lx, y: ly });
      }
    }
  }

  paintLamp(ctx, lamp) {
    const x = lamp.x, y = lamp.y;
    ctx.fillStyle = 'rgba(20,30,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 3.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3e4048';
    ctx.fillRect(x - 1, y, 2, 12);
    ctx.fillStyle = '#2e3038';
    ctx.fillRect(x - 3, y - 1, 6, 2);
    ctx.fillStyle = '#ffe9b0';
    ctx.fillRect(x - 2, y - 5, 4, 4);
    ctx.fillStyle = '#3e4048';
    ctx.fillRect(x - 3, y - 7, 6, 2);
  }

  roofColor(b) {
    if (ROOF_OVERRIDES[b.id]) return ROOF_OVERRIDES[b.id];
    return ROOF_PALETTE[strHash(b.id) % ROOF_PALETTE.length];
  }

  paintBuilding(ctx, b) {
    const bx = b.x * U, by = b.y * U, bw = b.w * U, bh = b.h * U;
    const isHome = b.type === 'home';
    const wall = isHome ? shade(b.color, 1.12) : mixHex(b.color, '#e8dcc4', 0.25);
    const wallDark = shade(b.color, 0.78);
    const beam = '#5d4226';
    const roofC = this.roofColor(b);
    const roofH = Math.max(10, Math.round(bh * 0.42));
    const facY = by + roofH;
    const facH = bh - roofH;

    // ground shadow
    ctx.fillStyle = 'rgba(25,35,18,0.25)';
    ctx.beginPath();
    ctx.roundRect(bx - 1, by + 4, bw + 4, bh, 3);
    ctx.fill();

    // special wall treatments
    let wallFill = wall;
    if (b.id === 'church') wallFill = '#ece6d8';
    if (b.id === 'guardpost') wallFill = '#9c9c96';
    if (b.id === 'farm') wallFill = '#b85745';

    // facade
    ctx.fillStyle = wallFill;
    ctx.fillRect(bx, facY, bw, facH);
    // base course + corner beams
    ctx.fillStyle = b.id === 'guardpost' ? '#7e7e78' : shade(b.id === 'farm' ? '#b85745' : (b.id === 'church' ? '#ece6d8' : b.color), 0.7);
    ctx.fillRect(bx, by + bh - 2, bw, 2);
    if (b.id !== 'guardpost' && b.id !== 'church') {
      ctx.fillStyle = b.id === 'farm' ? '#e8e0d0' : beam;
      ctx.fillRect(bx, facY, 2, facH);
      ctx.fillRect(bx + bw - 2, facY, 2, facH);
      ctx.fillRect(bx, facY, bw, 2);
    }
    if (b.id === 'guardpost') { // stone texture
      ctx.fillStyle = 'rgba(60,60,58,0.25)';
      for (let i = 0; i < b.w * b.h; i++) {
        ctx.fillRect(bx + 2 + Math.floor(hash2(b.x, i, 220) * (bw - 6)), facY + 2 + Math.floor(hash2(i, b.y, 221) * (facH - 5)), 3, 2);
      }
    }

    // door (door[1] is the tile in front; the door itself sits on the facade)
    const doorCol = Math.max(0, Math.min(b.w - 1, (b.door ? b.door[0] : b.x + 1) - b.x));
    const dX = bx + doorCol * U + 3;
    const dY = by + bh - 13;
    ctx.fillStyle = '#54381f';
    ctx.fillRect(dX - 1, dY - 1, 12, 14);
    ctx.fillStyle = '#7d4e28';
    ctx.fillRect(dX, dY, 10, 13);
    ctx.fillStyle = '#6b3f1f';
    ctx.fillRect(dX + 3, dY, 1, 13);
    ctx.fillRect(dX + 6, dY, 1, 13);
    ctx.fillStyle = '#e2b24c';
    ctx.fillRect(dX + 7, dY + 6, 2, 2);

    // farm barn: big X-braced door
    if (b.id === 'farm') {
      const gx = bx + Math.round(bw / 2) - 9, gy = by + bh - 16;
      ctx.fillStyle = '#8a4534';
      ctx.fillRect(gx, gy, 18, 16);
      ctx.strokeStyle = '#e8e0d0';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, 16, 14);
      ctx.beginPath();
      ctx.moveTo(gx + 2, gy + 2); ctx.lineTo(gx + 16, gy + 14);
      ctx.moveTo(gx + 16, gy + 2); ctx.lineTo(gx + 2, gy + 14);
      ctx.stroke();
    }

    // windows on each tile column except the door column
    for (let col = 0; col < b.w; col++) {
      if (col === doorCol) continue;
      if (b.w > 3 && hash2(b.x + col, b.y, 230) < 0.2) continue;
      const wX = bx + col * U + 4;
      const wY = facY + Math.max(3, Math.round(facH / 2) - 6);
      if (b.id === 'church' && col === Math.floor(b.w / 2)) {
        // round window
        ctx.fillStyle = '#5d4226';
        ctx.beginPath(); ctx.arc(wX + 4, wY + 4, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#aee0f0';
        ctx.beginPath(); ctx.arc(wX + 4, wY + 4, 3.5, 0, Math.PI * 2); ctx.fill();
        this.windows.push({ x: wX, y: wY, w: 8, h: 8, bid: b.id, home: false, round: true });
        continue;
      }
      ctx.fillStyle = '#5d4226';
      ctx.fillRect(wX - 1, wY - 1, 9, 10);
      ctx.fillStyle = '#aee0f0';
      ctx.fillRect(wX, wY, 7, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(wX + 1, wY + 1, 2, 2);
      ctx.fillStyle = '#5d4226';
      ctx.fillRect(wX + 3, wY, 1, 8);
      ctx.fillRect(wX, wY + 4, 7, 1);
      ctx.fillStyle = '#e0d6c4';
      ctx.fillRect(wX - 1, wY + 9, 9, 2);
      if (isHome) { // flower box
        ctx.fillStyle = '#4e8c3a';
        ctx.fillRect(wX, wY + 11, 7, 1);
        ctx.fillStyle = ['#e87a90', '#f2d24f', '#b07ad0'][strHash(b.id + col) % 3];
        ctx.fillRect(wX + 1, wY + 10, 2, 1);
        ctx.fillRect(wX + 4, wY + 10, 2, 1);
      }
      this.windows.push({ x: wX, y: wY, w: 7, h: 8, bid: b.id, home: isHome });
    }

    // awning for shops and the tavern
    if (['shop', 'social'].includes(b.type) || b.id === 'bakery') {
      const aw = Math.min(bw - 4, 26);
      const ax = bx + Math.round((bw - aw) / 2);
      for (let i = 0; i < aw; i += 4) {
        ctx.fillStyle = (i / 4) % 2 ? '#f0e6d2' : (b.id === 'bakery' ? '#c75b4a' : '#4a7a96');
        ctx.fillRect(ax + i, facY + 1, Math.min(4, aw - i), 4);
        ctx.beginPath();
        ctx.arc(ax + i + 2, facY + 5, 2, 0, Math.PI);
        ctx.fill();
      }
    }

    // roof
    ctx.fillStyle = roofC;
    ctx.fillRect(bx - 2, by + 1, bw + 4, roofH);
    ctx.fillStyle = shade(roofC, 1.3);
    ctx.fillRect(bx - 2, by, bw + 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let ry = by + 5; ry < by + roofH; ry += 4) {
      ctx.fillRect(bx - 2, ry, bw + 4, 1);
    }
    ctx.fillStyle = shade(roofC, 0.65);
    ctx.fillRect(bx - 2, by + roofH - 1, bw + 4, 2);
    ctx.fillStyle = shade(roofC, 0.82);
    ctx.fillRect(bx - 2, by, 1, roofH);
    ctx.fillRect(bx + bw + 1, by, 1, roofH);

    // guardpost crenellations
    if (b.id === 'guardpost') {
      ctx.fillStyle = '#7e7e78';
      for (let i = 0; i < bw + 4; i += 6) {
        ctx.fillRect(bx - 2 + i, by - 3, 4, 4);
      }
      ctx.fillStyle = '#3e4048';
      ctx.fillRect(bx + bw - 4, by - 12, 1, 10);
      ctx.fillStyle = '#c0524a';
      ctx.beginPath();
      ctx.moveTo(bx + bw - 3, by - 12);
      ctx.lineTo(bx + bw + 4, by - 10);
      ctx.lineTo(bx + bw - 3, by - 8);
      ctx.closePath();
      ctx.fill();
    }

    // church steeple + cross
    if (b.id === 'church') {
      const sx = bx + Math.round(bw / 2);
      ctx.fillStyle = '#ece6d8';
      ctx.fillRect(sx - 5, by - 12, 10, 14);
      ctx.fillStyle = '#5d4226';
      ctx.fillRect(sx - 2, by - 8, 4, 5); // bell opening
      ctx.fillStyle = '#5f7089';
      ctx.beginPath();
      ctx.moveTo(sx, by - 20);
      ctx.lineTo(sx - 7, by - 11);
      ctx.lineTo(sx + 7, by - 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e7c45f';
      ctx.fillRect(sx - 1, by - 26, 2, 6);
      ctx.fillRect(sx - 3, by - 24, 6, 2);
    }

    // chimney (most buildings except a few)
    if (!['church', 'guardpost'].includes(b.id)) {
      const cX = bx + bw - 11;
      const cY = by - 6;
      ctx.fillStyle = '#8d877e';
      ctx.fillRect(cX, cY, 6, 10);
      ctx.fillStyle = '#6e685f';
      ctx.fillRect(cX - 1, cY - 1, 8, 2);
      ctx.fillStyle = '#3a3530';
      ctx.fillRect(cX + 1, cY - 1, 4, 1);
      this.chimneys.push({ x: cX + 3, y: cY - 1, bid: b.id, home: isHome });
    }
  }

  paintPlaza(ctx, b) {
    const bx = b.x * U, by = b.y * U, bw = b.w * U, bh = b.h * U;
    // cobblestone ground
    ctx.fillStyle = '#b8b0a0';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    for (let i = 0; i < b.w * b.h * 3; i++) {
      const hx = hash2(i, b.x, 240) * (bw - 6);
      const hy = hash2(b.y, i, 241) * (bh - 4);
      ctx.fillStyle = hash2(i, i, 242) < 0.5 ? 'rgba(130,122,108,0.4)' : 'rgba(230,224,210,0.4)';
      ctx.fillRect(bx + 3 + Math.floor(hx), by + 2 + Math.floor(hy), 3, 2);
    }
    ctx.strokeStyle = '#928a7a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, bw - 1, bh - 1, 8);
    ctx.stroke();

    // fountain
    const fx = bx + bw / 2, fy = by + bh / 2;
    ctx.fillStyle = 'rgba(25,35,18,0.2)';
    ctx.beginPath(); ctx.ellipse(fx, fy + 11, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a958a';
    ctx.beginPath(); ctx.arc(fx, fy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7e796e';
    ctx.beginPath(); ctx.arc(fx, fy, 12, 0.2, Math.PI - 0.2); ctx.fill();
    ctx.fillStyle = '#4583c9';
    ctx.beginPath(); ctx.arc(fx, fy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a958a';
    ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b5b0a5';
    ctx.fillRect(fx - 1, fy - 6, 2, 6);
    this.fountain = { x: fx, y: fy };

    // corner flower beds
    const beds = [
      [bx + 4, by + 4], [bx + bw - 16, by + 4],
      [bx + 4, by + bh - 12], [bx + bw - 16, by + bh - 12]
    ];
    const fcolors = ['#e87a90', '#f2d24f', '#b07ad0', '#e89050'];
    for (let bi = 0; bi < beds.length; bi++) {
      const [px, py] = beds[bi];
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(px - 1, py - 1, 14, 10);
      ctx.fillStyle = '#7a5838';
      ctx.fillRect(px, py, 12, 8);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = fcolors[(bi + i) % fcolors.length];
        ctx.fillRect(px + 1 + (i % 3) * 4, py + 1 + Math.floor(i / 3) * 4, 2, 2);
        ctx.fillStyle = '#4e8c3a';
        ctx.fillRect(px + 3 + (i % 3) * 4, py + 2 + Math.floor(i / 3) * 4, 1, 1);
      }
    }

    // benches
    for (const [px, py] of [[bx + 6, by + bh / 2 - 3], [bx + bw - 20, by + bh / 2 - 3]]) {
      ctx.fillStyle = '#54381f';
      ctx.fillRect(px, py + 4, 2, 4);
      ctx.fillRect(px + 12, py + 4, 2, 4);
      ctx.fillStyle = '#8a623c';
      ctx.fillRect(px - 1, py + 2, 16, 3);
      ctx.fillStyle = '#a07a4c';
      ctx.fillRect(px - 1, py + 2, 16, 1);
    }

    // corner lamps
    this.lamps.push(
      { x: bx + 6, y: by + 8 }, { x: bx + bw - 6, y: by + 8 },
      { x: bx + 6, y: by + bh - 8 }, { x: bx + bw - 6, y: by + bh - 8 }
    );
  }

  paintDocks(ctx, b) {
    const bx = b.x * U, by = b.y * U, bw = b.w * U, bh = b.h * U;

    // wooden platform
    ctx.fillStyle = 'rgba(25,35,18,0.22)';
    ctx.fillRect(bx + 2, by + 4, bw, bh);
    ctx.fillStyle = '#a07a50';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#8a6238';
    for (let i = 3; i < bh; i += 4) ctx.fillRect(bx, by + i, bw, 1);
    ctx.fillStyle = '#6b4a2f';
    for (const [px, py] of [[bx, by], [bx + bw - 3, by], [bx, by + bh - 3], [bx + bw - 3, by + bh - 3]]) {
      ctx.fillRect(px, py, 3, 3);
    }

    // pier extending into the lake
    const pierX = bx + Math.round(bw / 2) - 8;
    ctx.fillStyle = '#9a7752';
    ctx.fillRect(pierX, by + bh, 16, 34);
    ctx.fillStyle = '#85643f';
    for (let i = 3; i < 34; i += 4) ctx.fillRect(pierX, by + bh + i, 16, 1);
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(pierX, by + bh + 30, 3, 4);
    ctx.fillRect(pierX + 13, by + bh + 30, 3, 4);
    ctx.fillRect(pierX, by + bh + 14, 3, 3);
    ctx.fillRect(pierX + 13, by + bh + 14, 3, 3);

    // little shack on the platform
    const sx = bx + 2, sy = by - 8;
    ctx.fillStyle = '#8a6f5a';
    ctx.fillRect(sx, sy + 8, 26, 14);
    ctx.fillStyle = '#5d4226';
    ctx.fillRect(sx, sy + 8, 2, 14);
    ctx.fillRect(sx + 24, sy + 8, 2, 14);
    ctx.fillStyle = '#54381f';
    ctx.fillRect(sx + 4, sy + 11, 8, 11);
    ctx.fillStyle = '#7d4e28';
    ctx.fillRect(sx + 5, sy + 12, 6, 10);
    ctx.fillStyle = '#6f7f93';
    ctx.fillRect(sx - 2, sy, 30, 9);
    ctx.fillStyle = shade('#6f7f93', 1.3);
    ctx.fillRect(sx - 2, sy, 30, 2);
    ctx.fillStyle = '#aee0f0';
    ctx.fillRect(sx + 17, sy + 12, 6, 6);
    ctx.fillStyle = '#5d4226';
    ctx.fillRect(sx + 19, sy + 12, 1, 6);
    this.windows.push({ x: sx + 17, y: sy + 12, w: 6, h: 6, bid: b.id, home: false });

    // barrel + crate
    ctx.fillStyle = '#8a623c';
    ctx.beginPath(); ctx.arc(bx + bw - 9, by + 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5d4226';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx + bw - 9, by + 8, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + bw - 9, by + 8, 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a07a4c';
    ctx.fillRect(bx + bw - 18, by + 12, 7, 7);
    ctx.strokeStyle = '#6b4a2f';
    ctx.strokeRect(bx + bw - 17.5, by + 12.5, 6, 6);

    // rowboat in the lake
    this.boat = { x: bx + bw + 14, y: by + bh + 22 };
  }

  // ============================================================
  // Per-frame: world layer
  // ============================================================

  renderWorld(now) {
    const ctx = this.bgCtx;
    const cam = this.camera;
    this.ts = cam.ts;
    const k = this.ts / U;

    ctx.fillStyle = '#22361f';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (!this.world) return;

    let sx = cam.x / k, sy = cam.y / k;
    let dx = 0, dy = 0;
    if (sx < 0) { dx = -sx * k; sx = 0; }
    if (sy < 0) { dy = -sy * k; sy = 0; }
    const sw = Math.min(this.world.width - sx, (this.viewW - dx) / k);
    const sh = Math.min(this.world.height - sy, (this.viewH - dy) / k);
    if (sw > 0 && sh > 0) {
      ctx.drawImage(this.world, sx, sy, sw, sh, dx, dy, sw * k, sh * k);
    }

    this.renderWaterAnim(ctx, now);
    this.renderFountainAnim(ctx, now, k);
    this.renderBoat(ctx, now, k);
    this.renderClouds(ctx, now, k);
  }

  renderWaterAnim(ctx, now) {
    if (!this.grid) return;
    const ts = this.ts;
    const cam = this.camera;
    const startX = Math.max(0, Math.floor(cam.x / ts));
    const startY = Math.max(0, Math.floor(cam.y / ts));
    const endX = Math.min(this.grid[0].length, Math.ceil((cam.x + this.viewW) / ts) + 1);
    const endY = Math.min(this.grid.length, Math.ceil((cam.y + this.viewH) / ts) + 1);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (this.grid[y][x] !== 2) continue;
        const sx = x * ts - cam.x;
        const sy = y * ts - cam.y;
        const ph = hash2(x, y, 7) * 6.283;

        const w1 = Math.sin(now / 850 + x * 0.9 + y * 1.7 + ph);
        if (w1 > 0.55) {
          ctx.fillStyle = `rgba(205,232,248,${((w1 - 0.55) * 0.7).toFixed(3)})`;
          ctx.fillRect(
            sx + ts * (0.1 + hash2(x, y, 17) * 0.35),
            sy + ts * (0.25 + hash2(x, y, 18) * 0.5),
            ts * 0.45, Math.max(1, ts * 0.07)
          );
        }
        const sp = Math.sin(now / 430 + ph * 3.1);
        if (sp > 0.92) {
          ctx.fillStyle = `rgba(255,255,255,${((sp - 0.92) * 8).toFixed(3)})`;
          const gs = Math.max(1.5, ts * 0.09);
          ctx.fillRect(sx + ts * hash2(x, y, 19) * 0.8, sy + ts * hash2(x, y, 20) * 0.8, gs, gs);
        }
      }
    }
  }

  renderFountainAnim(ctx, now, k) {
    if (!this.fountain) return;
    const cx = this.fountain.x * k - this.camera.x;
    const cy = this.fountain.y * k - this.camera.y;
    if (cx < -50 || cx > this.viewW + 50 || cy < -50 || cy > this.viewH + 50) return;
    const ts = this.ts;

    // shimmering pool
    const pulse = 0.5 + 0.5 * Math.sin(now / 600);
    ctx.fillStyle = `rgba(160,210,245,${(0.15 + pulse * 0.15).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // spray droplets arcing from the center spout
    for (let i = 0; i < 8; i++) {
      const t = (now / 900 + i / 8) % 1;
      const ang = i / 8 * Math.PI * 2;
      const r = t * ts * 0.45;
      const drop = Math.sin(t * Math.PI);
      ctx.fillStyle = `rgba(225,245,255,${(0.85 * (1 - t)).toFixed(3)})`;
      const ds = Math.max(1.5, ts * 0.07);
      ctx.fillRect(
        cx + Math.cos(ang) * r - ds / 2,
        cy - ts * 0.38 - drop * ts * 0.22 + t * ts * 0.45 + Math.sin(ang) * r * 0.3,
        ds, ds
      );
    }
  }

  renderBoat(ctx, now, k) {
    if (!this.boat) return;
    const bob = Math.sin(now / 1300) * 1.5;
    const tilt = Math.sin(now / 1700) * 0.05;
    const cx = this.boat.x * k - this.camera.x;
    const cy = this.boat.y * k - this.camera.y + bob * k * 0.5;
    if (cx < -60 || cx > this.viewW + 60 || cy < -60 || cy > this.viewH + 60) return;
    const s = k;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    // wake ripple
    ctx.strokeStyle = 'rgba(210,235,250,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 11 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    // hull
    ctx.fillStyle = '#5d3a1e';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9 * s, 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a5c30';
    ctx.beginPath();
    ctx.ellipse(0, -0.5 * s, 7.5 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5d3a1e';
    ctx.fillRect(-6 * s, -1 * s, 3 * s, 2 * s); // bench
    ctx.fillRect(3 * s, -1 * s, 3 * s, 2 * s);
    ctx.restore();
  }

  renderClouds(ctx, now, k) {
    if (!this.world) return;
    const worldW = this.world.width + 500;
    ctx.fillStyle = 'rgba(25,40,25,0.06)';
    for (let i = 0; i < 3; i++) {
      const speed = 9 + i * 4; // logical px / s
      const wx = ((now / 1000 * speed) + i * 631) % worldW - 250;
      const wy = ((i * 397) % (this.world.height - 100)) + 50 + Math.sin(now / 11000 + i * 2) * 40;
      const cx = wx * k - this.camera.x;
      const cy = wy * k - this.camera.y;
      const r = (60 + i * 18) * k;
      if (cx + r * 2 < 0 || cx - r * 2 > this.viewW) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.6, r * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + r, cy + r * 0.25, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============================================================
  // Per-frame: characters
  // ============================================================

  renderCharacters(characters, interpolator, currentTick) {
    const ctx = this.fgCtx;
    const ts = this.ts;
    const now = Date.now();
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // building occupants
    const occ = {};
    for (const char of characters) {
      if (char.inside && char.location) {
        (occ[char.location] = occ[char.location] || []).push(char);
      }
    }
    this._occ = occ;
    this.drawBuildingOccupants(ctx, ts, occ);

    // outside characters, painter's order
    const outside = characters
      .filter(c => !c.inside && (interpolator.getPosition(c.id) || c.pos))
      .map(c => ({ c, pos: interpolator.getPosition(c.id) || c.pos }))
      .sort((a, b) => a.pos.y - b.pos.y);

    for (const { c: char, pos } of outside) {
      const sx = pos.x * ts - this.camera.x;
      const sy = pos.y * ts - this.camera.y;
      if (sx < -ts * 2 || sx > this.viewW + ts || sy < -ts * 3 || sy > this.viewH + ts) {
        this.trackFacing(char, pos);
        continue;
      }

      if (['chat', 'greet', 'flirt', 'argue', 'confess', 'comfort', 'confront', 'gossip'].includes(char.activity)) {
        this.drawInteractionRing(ctx, sx, sy, ts, char, now);
      }

      this.drawCharacter(ctx, sx, sy, ts, char, pos, now);

      // occasionally spawn ambient emoji particles
      if (char.activity && !['idle', 'goto', 'wander'].includes(char.activity) && Math.random() < 0.015) {
        this.spawnParticles(char.activity, pos.x + 0.5, pos.y - 0.5);
      }
    }
  }

  trackFacing(char, pos) {
    const prev = this._facing[char.id];
    let dir = prev ? prev.dir : 'down';
    if (prev) {
      const dx = pos.x - prev.x, dy = pos.y - prev.y;
      if (Math.abs(dx) > 0.012 || Math.abs(dy) > 0.012) {
        dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
    }
    this._facing[char.id] = { x: pos.x, y: pos.y, dir };
    return dir;
  }

  drawCharacter(ctx, sx, sy, ts, char, pos, now) {
    const p = ts / U; // logical pixel size on screen
    const dir = this.trackFacing(char, pos);
    const phase = (strHash(char.id) % 100) / 100 * 6.283;
    const outfit = char.color || '#a0a0a0';
    const outfitDark = shade(outfit, 0.72);
    const skin = SKIN_TONES[strHash(char.id) % SKIN_TONES.length];
    const hairC = HAIR_COLORS[strHash(char.id + 'h') % HAIR_COLORS.length];
    const longHair = LONG_HAIR_IDS.has(char.id);
    const sleeping = char.activity === 'sleep';

    const walking = !!char.walking;
    const stride = walking ? Math.sin(now / 130 + phase) : 0;
    let bounce = walking ? -Math.abs(Math.sin(now / 130 + phase)) * 1.1 : 0;
    if (char.activity === 'dance') bounce = -Math.abs(Math.sin(now / 160 + phase)) * 2;

    const R = (lx, ly, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(sx + lx * p), Math.round(sy + ly * p), Math.max(1, Math.round(w * p)), Math.max(1, Math.round(h * p)));
    };
    const C = (lx, ly, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx + lx * p, sy + ly * p, r * p, 0, Math.PI * 2);
      ctx.fill();
    };

    // shadow at feet
    ctx.fillStyle = 'rgba(20,30,15,0.28)';
    ctx.beginPath();
    ctx.ellipse(sx + 8 * p, sy + 15.4 * p, 4.6 * p, 1.7 * p, 0, 0, Math.PI * 2);
    ctx.fill();

    const b = bounce;
    const headY = 4.4 + b * 0.7;

    // dark silhouette outline makes the sprite pop
    ctx.fillStyle = 'rgba(38,28,20,0.85)';
    ctx.beginPath();
    ctx.arc(sx + 8 * p, sy + headY * p, 4.5 * p, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(Math.round(sx + 4.3 * p), Math.round(sy + (7.4 + b) * p), Math.round(7.4 * p), Math.round(8.4 * p));

    // legs
    const legC = shade(outfit, 0.5);
    if (walking) {
      const lift = Math.max(0, stride) * 1.4;
      const lift2 = Math.max(0, -stride) * 1.4;
      R(5.6, 13 + b - lift * 0.4, 2, 3 - lift * 0.4 + 0.4, legC);
      R(8.6, 13 + b - lift2 * 0.4, 2, 3 - lift2 * 0.4 + 0.4, legC);
    } else {
      R(5.6, 13 + b, 2, 3, legC);
      R(8.6, 13 + b, 2, 3, legC);
    }

    // torso
    R(5, 8 + b, 6.2, 5.6, outfit);
    R(5, 12.4 + b, 6.2, 1.2, outfitDark);
    R(10, 8.4 + b, 1.2, 5.2, outfitDark);
    if (char.job === 'priest') R(5, 8 + b, 6.2, 1.2, '#f0ece2'); // collar

    // arms
    const swing = walking ? stride * 1.2 : (char.activity === 'celebrate' ? -2.5 : 0);
    R(3.6, 9 + b + swing * 0.5, 1.6, 3.8, outfitDark);
    R(10.9, 9 + b - swing * 0.5, 1.6, 3.8, outfitDark);
    R(3.6, 12.4 + b + swing * 0.5, 1.6, 1.3, skin);
    R(10.9, 12.4 + b - swing * 0.5, 1.6, 1.3, skin);

    // head
    C(8, headY, 4, skin);

    // hair
    ctx.fillStyle = hairC;
    ctx.beginPath();
    if (dir === 'up') {
      ctx.arc(sx + 8 * p, sy + headY * p, 4 * p, 0, Math.PI * 2);
    } else {
      ctx.arc(sx + 8 * p, sy + (headY - 0.4) * p, 4 * p, Math.PI, Math.PI * 2);
    }
    ctx.fill();
    R(4.2, headY - 1.6, 7.6, 1.4, hairC); // fringe
    if (longHair) {
      R(3.9, headY - 1, 1.6, 4.6, hairC);
      R(10.5, headY - 1, 1.6, 4.6, hairC);
    }

    // job hats
    switch (char.job) {
      case 'guard':
        ctx.fillStyle = '#9aa2ac';
        ctx.beginPath();
        ctx.arc(sx + 8 * p, sy + (headY - 0.6) * p, 4.1 * p, Math.PI, Math.PI * 2);
        ctx.fill();
        R(3.9, headY - 0.8, 8.2, 1, '#7e8690');
        break;
      case 'farmer': {
        ctx.fillStyle = '#d9b85e';
        ctx.beginPath();
        ctx.ellipse(sx + 8 * p, sy + (headY - 1.4) * p, 5.6 * p, 1.4 * p, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e6c76e';
        ctx.beginPath();
        ctx.arc(sx + 8 * p, sy + (headY - 1.6) * p, 3 * p, Math.PI, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fisherman':
        ctx.fillStyle = '#4a7a96';
        ctx.beginPath();
        ctx.arc(sx + 8 * p, sy + (headY - 0.8) * p, 3.8 * p, Math.PI, Math.PI * 2);
        ctx.fill();
        R(3.6, headY - 1, 8.8, 1.1, '#3c647c');
        break;
      case 'baker':
        ctx.fillStyle = '#f4f1ea';
        ctx.beginPath();
        ctx.arc(sx + 8 * p, sy + (headY - 1.8) * p, 3.2 * p, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();
        R(4.8, headY - 1.6, 6.4, 1.2, '#f4f1ea');
        break;
      case 'blacksmith':
        R(4.2, headY - 1.8, 7.6, 1.2, '#4a443c');
        break;
    }

    // face
    if (dir !== 'up') {
      const edx = dir === 'left' ? -1.2 : dir === 'right' ? 1.2 : 0;
      const eyeY = headY + 0.5;
      const blink = ((now / 3400 + phase) % 1) < 0.045;
      ctx.fillStyle = '#2a2420';
      if (sleeping || blink) {
        R(5.8 + edx, eyeY + 0.3, 1.6, 0.5, '#2a2420');
        R(8.6 + edx, eyeY + 0.3, 1.6, 0.5, '#2a2420');
      } else {
        R(6 + edx, eyeY - 0.2, 1.1, 1.3, '#2a2420');
        R(8.9 + edx, eyeY - 0.2, 1.1, 1.3, '#2a2420');
      }
      if (char.activity === 'cry') {
        const ty = ((now / 280) % 1) * 3;
        R(6.2 + edx, eyeY + 1 + ty, 0.8, 1.6, 'rgba(110,180,230,0.9)');
      }
      if (['flirt', 'confess'].includes(char.activity)) {
        R(5.2 + edx, eyeY + 1.2, 1.3, 0.8, 'rgba(240,130,140,0.65)');
        R(9.5 + edx, eyeY + 1.2, 1.3, 0.8, 'rgba(240,130,140,0.65)');
      }
    }

    // fishing rod
    if (char.activity === 'fish') {
      ctx.strokeStyle = '#6b4a2f';
      ctx.lineWidth = Math.max(1, p);
      ctx.beginPath();
      ctx.moveTo(sx + 11.5 * p, sy + (12 + b) * p);
      ctx.lineTo(sx + 16.5 * p, sy + (5 + b) * p);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,240,250,0.7)';
      ctx.lineWidth = Math.max(0.5, p * 0.4);
      ctx.beginPath();
      ctx.moveTo(sx + 16.5 * p, sy + (5 + b) * p);
      ctx.lineTo(sx + 17 * p, sy + 14 * p + Math.sin(now / 600) * p);
      ctx.stroke();
    }

    // selection ring
    if (char._selected) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 350);
      ctx.strokeStyle = `rgba(255,200,90,${pulse})`;
      ctx.lineWidth = Math.max(1.5, p * 0.9);
      ctx.beginPath();
      ctx.ellipse(sx + 8 * p, sy + 15.2 * p, 6.5 * p, 2.6 * p, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawInteractionRing(ctx, sx, sy, ts, char, now) {
    const colors = {
      chat: '110,190,110', greet: '110,190,110', gossip: '200,170,90',
      flirt: '235,120,150', confess: '235,120,150',
      argue: '220,90,80', confront: '220,90,80', comfort: '120,190,170'
    };
    const rgb = colors[char.activity] || '255,255,255';
    const pulse = 0.5 + 0.3 * Math.sin(now / 320);
    ctx.strokeStyle = `rgba(${rgb},${pulse.toFixed(2)})`;
    ctx.lineWidth = Math.max(1.5, ts * 0.06);
    ctx.beginPath();
    ctx.ellipse(sx + ts / 2, sy + ts * 0.95, ts * 0.62, ts * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawBuildingOccupants(ctx, ts, occ) {
    for (const [bid, occupants] of Object.entries(occ)) {
      const b = this.buildings[bid];
      if (!b || occupants.length === 0) continue;
      const cx = (b.x + b.w / 2) * ts - this.camera.x;
      const topY = b.y * ts - this.camera.y;
      if (cx < -80 || cx > this.viewW + 80 || topY < -40 || topY > this.viewH + 40) continue;

      const dot = Math.max(3, ts * 0.16);
      const gap = dot + Math.max(2, ts * 0.05);
      const totalW = occupants.length * gap + 8;
      const px = cx - totalW / 2;
      const py = topY - dot - 10;

      ctx.fillStyle = 'rgba(24,20,14,0.5)';
      ctx.beginPath();
      ctx.roundRect(px, py - dot / 2 - 3, totalW, dot + 6, (dot + 6) / 2);
      ctx.fill();

      for (let i = 0; i < occupants.length; i++) {
        ctx.fillStyle = occupants[i].color || '#aaa';
        ctx.beginPath();
        ctx.arc(px + 4 + i * gap + dot / 2, py, dot / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,250,240,0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // ============================================================
  // Per-frame: atmosphere (smoke, tint, lights, fireflies)
  // ============================================================

  tintAt(t) {
    let i = 1;
    while (i < TINT_STOPS.length && TINT_STOPS[i].t < t) i++;
    if (i >= TINT_STOPS.length) i = TINT_STOPS.length - 1;
    const a = TINT_STOPS[i - 1], b = TINT_STOPS[i];
    const f = (t - a.t) / Math.max(0.001, b.t - a.t);
    return {
      r: Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
      g: Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
      b: Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
      a: a.a + (b.a - a.a) * f
    };
  }

  renderAtmosphere(timeOfDay, now) {
    const ctx = this.fgCtx;
    const k = this.ts / U;

    this.updateSmoke(ctx, now, timeOfDay, k);

    const tint = this.tintAt(timeOfDay);
    const dark = Math.min(1, tint.a / 0.52);
    this._darkness = dark;
    if (tint.a > 0.005) {
      ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${tint.a.toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    if (dark < 0.04 && Object.keys(this._occ).length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // window light
    for (const win of this.windows) {
      const wx = win.x * k - this.camera.x;
      const wy = win.y * k - this.camera.y;
      const ww = win.w * k, wh = win.h * k;
      if (wx + ww < -60 || wx > this.viewW + 60 || wy + wh < -60 || wy > this.viewH + 60) continue;

      const occupied = !!this._occ[win.bid];
      // homes glow in the evening/night; workplaces glow when someone is inside
      let lit = 0;
      if (dark > 0.05) lit = win.home ? 1 : (occupied ? 1 : 0.12);
      else if (occupied) lit = 0.45;
      if (lit < 0.05) continue;

      const flicker = 0.88 + 0.12 * Math.sin(now / 320 + win.x * 1.7);
      const strength = lit * Math.max(dark, occupied ? 0.3 : 0) * flicker;
      if (strength < 0.03) continue;

      ctx.fillStyle = `rgba(255,196,100,${(0.75 * strength).toFixed(3)})`;
      if (win.round) {
        ctx.beginPath();
        ctx.arc(wx + ww / 2, wy + wh / 2, ww / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(wx, wy, ww, wh);
      }
      const r = this.ts * 1.15;
      const grad = ctx.createRadialGradient(wx + ww / 2, wy + wh, 0, wx + ww / 2, wy + wh, r);
      grad.addColorStop(0, `rgba(255,180,80,${(0.26 * strength).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(wx + ww / 2 - r, wy + wh - r, r * 2, r * 2);
    }

    // lamp light
    if (dark > 0.06) {
      for (const lamp of this.lamps) {
        const lx = lamp.x * k - this.camera.x;
        const ly = (lamp.y - 3) * k - this.camera.y;
        if (lx < -80 || lx > this.viewW + 80 || ly < -80 || ly > this.viewH + 80) continue;
        const flicker = 0.9 + 0.1 * Math.sin(now / 240 + lamp.x);
        ctx.fillStyle = `rgba(255,225,150,${(0.85 * dark * flicker).toFixed(3)})`;
        ctx.fillRect(lx - 2 * k, ly - 2 * k, 4 * k, 4 * k);
        const r = this.ts * 1.9;
        const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        grad.addColorStop(0, `rgba(255,205,110,${(0.4 * dark * flicker).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,205,110,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
      }
    }

    // fireflies
    if (dark > 0.3) {
      for (const f of this.fireflySpots) {
        const fx = (f.x + 0.5) * this.ts - this.camera.x + Math.sin(now / 1400 * f.s1 + f.ph) * this.ts * 0.8;
        const fy = (f.y + 0.3) * this.ts - this.camera.y + Math.cos(now / 1700 * f.s2 + f.ph * 2) * this.ts * 0.5;
        if (fx < -20 || fx > this.viewW + 20 || fy < -20 || fy > this.viewH + 20) continue;
        const blink = Math.sin(now / 650 * f.s2 + f.ph * 3);
        if (blink <= 0.1) continue;
        const a = blink * dark;
        const r = this.ts * 0.3;
        const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
        grad.addColorStop(0, `rgba(216,240,128,${(0.5 * a).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(216,240,128,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(fx - r, fy - r, r * 2, r * 2);
        ctx.fillStyle = `rgba(240,255,170,${(0.9 * a).toFixed(3)})`;
        ctx.fillRect(fx - 1, fy - 1, 2, 2);
      }
    }

    ctx.restore();
  }

  updateSmoke(ctx, now, timeOfDay, k) {
    // spawn puffs from active chimneys
    if (now - this._lastSmokeSpawn > 240) {
      this._lastSmokeSpawn = now;
      const workHours = timeOfDay >= 6.5 && timeOfDay <= 20;
      for (const ch of this.chimneys) {
        const active = this._occ[ch.bid] ||
          (workHours && ['bakery', 'smithy', 'tavern'].includes(ch.bid));
        if (!active) continue;
        if (Math.random() > 0.4) continue;
        this.smoke.push({
          x: ch.x + (Math.random() - 0.5) * 2,
          y: ch.y,
          vx: (Math.random() - 0.5) * 1.6,
          born: now,
          life: 2800 + Math.random() * 1500,
          dark: ch.bid === 'smithy'
        });
      }
      if (this.smoke.length > 80) this.smoke.splice(0, this.smoke.length - 80);
    }

    this.smoke = this.smoke.filter(s => now - s.born < s.life);
    for (const s of this.smoke) {
      const age = (now - s.born) / s.life;
      const wx = s.x + s.vx * age * 8 + Math.sin(now / 900 + s.born) * 2.5 * age;
      const wy = s.y - age * 14;
      const sx = wx * k - this.camera.x;
      const sy = wy * k - this.camera.y;
      if (sx < -30 || sx > this.viewW + 30 || sy < -30 || sy > this.viewH + 30) continue;
      const r = (1.5 + age * 3.5) * k;
      const a = (1 - age) * 0.3;
      ctx.fillStyle = s.dark
        ? `rgba(120,118,115,${a.toFixed(3)})`
        : `rgba(238,238,242,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============================================================
  // Per-frame: labels, bubbles, particles (above the night tint)
  // ============================================================

  renderLabels(characters, interpolator, currentTick) {
    const ctx = this.fgCtx;
    const ts = this.ts;
    const zoom = this.camera.zoom;
    const now = Date.now();

    // building labels
    ctx.textAlign = 'center';
    const labelFont = Math.min(13, Math.max(9, ts * 0.3));
    for (const b of Object.values(this.buildings)) {
      if (b.type === 'home') continue;
      const bx = (b.x + b.w / 2) * ts - this.camera.x;
      const by = b.y * ts - this.camera.y - 6;
      if (bx < -120 || bx > this.viewW + 120 || by < -30 || by > this.viewH + 30) continue;
      ctx.font = `700 ${labelFont}px Nunito, sans-serif`;
      const tw = ctx.measureText(b.name).width;
      ctx.fillStyle = 'rgba(24,20,14,0.55)';
      ctx.beginPath();
      ctx.roundRect(bx - tw / 2 - 7, by - labelFont - 4, tw + 14, labelFont + 8, (labelFont + 8) / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(250,243,228,0.95)';
      ctx.fillText(b.name, bx, by - 3);
    }

    for (const char of characters) {
      if (char.inside) continue;
      const pos = interpolator.getPosition(char.id) || char.pos;
      if (!pos) continue;
      const sx = pos.x * ts - this.camera.x;
      const sy = pos.y * ts - this.camera.y;
      if (sx < -ts * 3 || sx > this.viewW + ts * 2 || sy < -ts * 4 || sy > this.viewH + ts * 2) continue;

      // destination line for the selected, walking character
      if (char._selected && char.walking && char.activityData && char.activityData.destination) {
        this.drawDestinationLine(ctx, ts, sx, sy, char);
      }

      // name pill
      const nameFont = Math.min(12, Math.max(9, ts * 0.28));
      ctx.font = `700 ${nameFont}px Nunito, sans-serif`;
      const nw = ctx.measureText(char.name).width;
      const pillW = nw + 12;
      const pillH = nameFont + 7;
      const pillX = sx + ts / 2 - pillW / 2;
      const pillY = sy - pillH - ts * 0.32;
      ctx.fillStyle = char._selected ? 'rgba(70,46,14,0.78)' : 'rgba(24,20,14,0.55)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      if (char._selected) {
        ctx.strokeStyle = 'rgba(255,200,90,0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(252,246,232,0.96)';
      ctx.fillText(char.name, sx + ts / 2, pillY + pillH - 4.5);

      // activity label (when zoomed in or selected)
      if (zoom >= 1.9 || char._selected) {
        const label = this.getActivityLabel(char, characters);
        if (label) {
          const aFont = Math.min(10.5, Math.max(8, ts * 0.23));
          ctx.font = `600 ${aFont}px Nunito, sans-serif`;
          const lw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(24,20,14,0.42)';
          ctx.beginPath();
          ctx.roundRect(sx + ts / 2 - lw / 2 - 5, sy + ts + 2, lw + 10, aFont + 6, (aFont + 6) / 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(245,235,215,0.92)';
          ctx.fillText(label, sx + ts / 2, sy + ts + aFont + 4);
        }
      }

      // activity emoji indicator
      this.drawActivityIndicator(ctx, sx, sy, ts, char, now);

      // speech bubble
      if (char.say && currentTick - char.sayTick < 20) {
        const fade = Math.min(1, (20 - (currentTick - char.sayTick)) / 3);
        ctx.globalAlpha = fade;
        this.drawBubble(ctx, sx + ts / 2, sy - pillH - ts * 0.42, char.say);
        ctx.globalAlpha = 1;
      }

      // thought bubble
      if (char.think && currentTick - char.thinkTick < 12 && (!char.say || currentTick - char.sayTick >= 20)) {
        this.drawThoughtBubble(ctx, sx + ts / 2, sy - pillH - ts * 0.5, char.think);
      }
    }

    this.updateParticles(ctx, ts, now);
  }

  getActivityLabel(char, characters) {
    const activity = char.activity;
    if (!activity || activity === 'idle') return null;
    const data = char.activityData || {};

    if (activity === 'goto') {
      const dest = data.destination;
      if (dest && this.buildings[dest]) return 'Going to ' + this.buildings[dest].name;
      return 'Walking';
    }
    if (activity === 'wander') return 'Wandering';

    const simpleLabels = {
      eat: 'Eating', sleep: 'Sleeping', work: 'Working', drink: 'Drinking',
      pray: 'Praying', relax: 'Relaxing', shop: 'Shopping', play: 'Playing',
      think: 'Thinking', cry: 'Crying', laugh: 'Laughing', dance: 'Dancing',
      sing: 'Singing', celebrate: 'Celebrating', craft: 'Crafting',
      fish: 'Fishing', garden: 'Gardening', explore: 'Exploring',
      stargaze: 'Stargazing', perform: 'Performing'
    };
    if (simpleLabels[activity]) return simpleLabels[activity];

    if (['chat', 'greet', 'flirt', 'argue', 'gift', 'confess', 'comfort', 'confront', 'apologize', 'forgive', 'gossip'].includes(activity)) {
      const target = data.target;
      if (target) {
        const targetChar = characters.find(c => c.id === target);
        const targetName = targetChar ? targetChar.name : target;
        const labels = {
          chat: 'Chatting with', greet: 'Greeting', flirt: 'Flirting with',
          argue: 'Arguing with', gift: 'Giving gift to', confess: 'Confessing to',
          comfort: 'Comforting', confront: 'Confronting', apologize: 'Apologizing to',
          forgive: 'Forgiving', gossip: 'Gossiping with'
        };
        return (labels[activity] || activity) + ' ' + targetName;
      }
    }

    return activity.replace(/_/g, ' ');
  }

  drawDestinationLine(ctx, ts, sx, sy, char) {
    const b = this.buildings[char.activityData.destination];
    if (!b) return;
    const destX = (b.x + b.w / 2) * ts - this.camera.x;
    const destY = (b.y + b.h / 2) * ts - this.camera.y;

    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -(Date.now() / 60) % 10;
    ctx.strokeStyle = 'rgba(255,200,90,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + ts / 2, sy + ts / 2);
    ctx.lineTo(destX, destY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    ctx.fillStyle = 'rgba(255,200,90,0.7)';
    ctx.beginPath();
    ctx.moveTo(destX, destY - 5);
    ctx.lineTo(destX + 5, destY);
    ctx.lineTo(destX, destY + 5);
    ctx.lineTo(destX - 5, destY);
    ctx.closePath();
    ctx.fill();
  }

  drawActivityIndicator(ctx, sx, sy, ts, char, now) {
    const emojis = {
      eat: '🍽️', work: '⚒️', chat: '💬',
      drink: '🍺', pray: '🙏', play: '⚽',
      shop: '🛒', think: '💭', greet: '👋',
      flirt: '❤️', argue: '💢', gift: '🎁',
      relax: '😌', confess: '💌', comfort: '🤗',
      confront: '😤', cry: '😢', dance: '💃',
      sing: '🎤', celebrate: '🎉', gossip: '🤫',
      fish: '🎣', stargaze: '⭐', garden: '🌱',
      explore: '🧭', craft: '🔨'
    };

    if (char.activity === 'sleep') {
      ctx.font = `bold ${ts * 0.34}px Nunito, sans-serif`;
      ctx.fillStyle = 'rgba(200,200,235,0.9)';
      const t = (now / 1800) % 1;
      for (let i = 0; i < 3; i++) {
        const zt = (t + i / 3) % 1;
        ctx.globalAlpha = (1 - zt) * 0.9;
        ctx.fillText('z', sx + ts + zt * ts * 0.3, sy - zt * ts * 0.5);
      }
      ctx.globalAlpha = 1;
    } else if (emojis[char.activity]) {
      const bob = Math.sin(now / 500) * ts * 0.04;
      ctx.font = `${ts * 0.4}px sans-serif`;
      ctx.fillText(emojis[char.activity], sx + ts - 2, sy + 2 + bob);
    }
  }

  spawnParticles(activity, worldX, worldY) {
    const now = Date.now();
    const configs = {
      chat:  { emoji: '💬', count: 1, life: 1200 },
      flirt: { emoji: '❤️', count: 2, life: 1500 },
      argue: { emoji: '💢', count: 1, life: 1000 },
      confess: { emoji: '💌', count: 2, life: 1500 },
      shop:  { emoji: '💰', count: 1, life: 1000 },
      drink: { emoji: '🍺', count: 1, life: 1000 },
      eat:   { emoji: '🍽️', count: 1, life: 1000 },
      pray:  { emoji: '🙏', count: 1, life: 1200 },
      play:  { emoji: '⚽', count: 1, life: 1000 },
      work:  { emoji: '⚒️', count: 1, life: 800 },
      gift:  { emoji: '🎁', count: 1, life: 1200 },
      comfort: { emoji: '🤗', count: 1, life: 1200 },
      cry:   { emoji: '😢', count: 1, life: 1000 },
      dance: { emoji: '🎵', count: 1, life: 1200 },
      sing:  { emoji: '🎶', count: 1, life: 1200 },
      celebrate: { emoji: '🎉', count: 2, life: 1200 },
      fish:  { emoji: '🐟', count: 1, life: 1400 }
    };
    const cfg = configs[activity];
    if (!cfg) return;

    for (let i = 0; i < cfg.count; i++) {
      this.particles.push({
        emoji: cfg.emoji,
        x: worldX + (Math.random() - 0.5) * 0.3,
        y: worldY,
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.012 - Math.random() * 0.01,
        born: now,
        life: cfg.life + Math.random() * 400,
        size: 0.38 + Math.random() * 0.18
      });
    }
  }

  updateParticles(ctx, ts, now) {
    this.particles = this.particles.filter(p => now - p.born < p.life);
    ctx.textAlign = 'center';
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      const age = (now - p.born) / p.life;
      const sx = p.x * ts - this.camera.x;
      const sy = p.y * ts - this.camera.y;
      if (sx < -20 || sx > this.viewW + 20 || sy < -20 || sy > this.viewH + 20) continue;
      ctx.globalAlpha = 1 - age * age;
      ctx.font = `${ts * p.size}px sans-serif`;
      ctx.fillText(p.emoji, sx, sy);
      ctx.globalAlpha = 1;
    }
  }

  drawBubble(ctx, x, y, text) {
    const font = Math.min(13, Math.max(10, this.ts * 0.27));
    ctx.font = `600 ${font}px Nunito, sans-serif`;
    const maxWidth = 170;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineHeight = font + 3;
    const padding = 8;
    const totalHeight = lines.length * lineHeight + padding * 2 - 3;
    const totalWidth = Math.min(maxWidth + padding * 2,
      Math.max(...lines.map(l => ctx.measureText(l).width)) + padding * 2);
    const bx = x - totalWidth / 2;
    const by = y - totalHeight - 8;

    ctx.fillStyle = 'rgba(40,30,20,0.25)';
    ctx.beginPath();
    ctx.roundRect(bx + 2, by + 3, totalWidth, totalHeight, 9);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,253,247,0.97)';
    ctx.strokeStyle = 'rgba(120,95,60,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, totalWidth, totalHeight, 9);
    ctx.fill();
    ctx.stroke();

    // tail
    ctx.beginPath();
    ctx.moveTo(x - 5, by + totalHeight - 0.5);
    ctx.lineTo(x, by + totalHeight + 7);
    ctx.lineTo(x + 5, by + totalHeight - 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,253,247,0.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,95,60,0.55)';
    ctx.beginPath();
    ctx.moveTo(x - 5, by + totalHeight);
    ctx.lineTo(x, by + totalHeight + 7);
    ctx.lineTo(x + 5, by + totalHeight);
    ctx.stroke();

    ctx.fillStyle = '#3d3225';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + padding, by + padding + font - 2 + i * lineHeight);
    }
    ctx.textAlign = 'center';
  }

  drawThoughtBubble(ctx, x, y, text) {
    const font = Math.min(11, Math.max(9, this.ts * 0.24));
    ctx.font = `italic 600 ${font}px Nunito, sans-serif`;
    const tw = Math.min(140, ctx.measureText(text).width);
    const w = tw + 16;
    const h = font + 10;

    ctx.fillStyle = 'rgba(238,234,246,0.92)';
    ctx.strokeStyle = 'rgba(130,125,160,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y - h / 2 - 6, w / 2, h / 2 + 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - 5, y + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 9, y + 7, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5b5470';
    ctx.textAlign = 'center';
    ctx.fillText(text.length > 30 ? text.slice(0, 28) + '…' : text, x, y - h / 2 - 2);
  }

  markDirty() { /* kept for API compatibility; world re-blits every frame */ }
}
