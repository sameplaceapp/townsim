class Renderer {
  constructor(bgCanvas, fgCanvas, camera, tileSize, scale) {
    this.bgCanvas = bgCanvas;
    this.fgCanvas = fgCanvas;
    this.bgCtx = bgCanvas.getContext('2d');
    this.fgCtx = fgCanvas.getContext('2d');
    this.camera = camera;
    this.tileSize = tileSize;
    this.scale = scale;
    this.ts = tileSize * scale;
    this.grid = null;
    this.buildings = {};
    this.tileColors = {};
    this.bgDirty = true;
    this.particles = [];
    this.selectedCharId = null;

    this.bgCtx.imageSmoothingEnabled = false;
    this.fgCtx.imageSmoothingEnabled = false;
  }

  setWorldData(grid, buildings, tileTypes) {
    this.grid = grid;
    this.buildings = buildings;
    this.tileColors = {};
    for (const [id, type] of Object.entries(tileTypes)) {
      this.tileColors[id] = type.color;
    }
    this.bgDirty = true;
  }

  resize(width, height) {
    this.bgCanvas.width = width;
    this.bgCanvas.height = height;
    this.fgCanvas.width = width;
    this.fgCanvas.height = height;
    this.bgCtx.imageSmoothingEnabled = false;
    this.fgCtx.imageSmoothingEnabled = false;
    this.camera.setViewSize(width, height);
    this.bgDirty = true;
  }

  renderBackground() {
    if (!this.grid || !this.bgDirty) return;
    this.bgDirty = false;

    const ctx = this.bgCtx;
    const ts = this.ts;
    ctx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);

    const startX = Math.max(0, Math.floor(this.camera.x / ts));
    const startY = Math.max(0, Math.floor(this.camera.y / ts));
    const endX = Math.min(this.grid[0].length, Math.ceil((this.camera.x + this.bgCanvas.width) / ts) + 1);
    const endY = Math.min(this.grid.length, Math.ceil((this.camera.y + this.bgCanvas.height) / ts) + 1);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = this.grid[y][x];
        const color = this.tileColors[tile] || '#333';
        const sx = x * ts - this.camera.x;
        const sy = y * ts - this.camera.y;

        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, ts, ts);

        // Subtle grid line
        ctx.strokeStyle = 'rgba(0,0,0,0.04)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx, sy, ts, ts);

        // Tile variation
        if (tile === 0 || tile === 11) {
          const seed = (x * 31 + y * 17) % 7;
          if (seed < 2) {
            ctx.fillStyle = tile === 0 ? '#3d7a34' : '#5fa035';
            ctx.fillRect(sx + 4, sy + 4, 4, 4);
          }
          if (seed === 3) {
            ctx.fillStyle = tile === 0 ? '#55a04a' : '#7cc055';
            ctx.fillRect(sx + ts - 8, sy + ts - 8, 3, 3);
          }
        }

        // Path worn-center effect
        if (tile === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(sx + 4, sy + 4, ts - 8, ts - 8);
        }

        // Water animation
        if (tile === 2) {
          const wave = ((x + y) % 3 === 0);
          if (wave) {
            ctx.fillStyle = '#4a90e8';
            ctx.fillRect(sx + 2, sy + 6, ts - 4, 4);
          }
          // Subtle shimmer
          const shimmer = Math.sin((Date.now() / 2000 + x * 0.5 + y * 0.3)) * 0.1;
          if (shimmer > 0) {
            ctx.fillStyle = `rgba(255,255,255,${shimmer})`;
            ctx.fillRect(sx, sy, ts, ts);
          }
        }
      }
    }

    // Building labels - warm parchment style
    ctx.textAlign = 'center';
    for (const [id, b] of Object.entries(this.buildings)) {
      if (b.type === 'home') continue;
      const bx = (b.x + b.w / 2) * ts - this.camera.x;
      const by = b.y * ts - this.camera.y - 4;
      if (bx > -100 && bx < this.bgCanvas.width + 100 && by > -20 && by < this.bgCanvas.height + 20) {
        ctx.font = `600 ${Math.max(10, ts * 0.38)}px Nunito, sans-serif`;
        const textWidth = ctx.measureText(b.name).width;
        // Parchment pill background
        ctx.fillStyle = 'rgba(250, 246, 240, 0.85)';
        ctx.beginPath();
        ctx.roundRect(bx - textWidth / 2 - 6, by - 12, textWidth + 12, 18, 4);
        ctx.fill();
        // Text
        ctx.fillStyle = '#3d3225';
        ctx.fillText(b.name, bx, by);
      }
    }
  }

  renderCharacters(characters, interpolator, currentTick) {
    const ctx = this.fgCtx;
    const ts = this.ts;
    ctx.clearRect(0, 0, this.fgCanvas.width, this.fgCanvas.height);

    // Building occupants
    const buildingOccupants = {};
    for (const char of characters) {
      if (char.inside && char.location) {
        if (!buildingOccupants[char.location]) buildingOccupants[char.location] = [];
        buildingOccupants[char.location].push(char);
      }
    }

    this.drawBuildingGlows(ctx, ts, buildingOccupants);
    this.drawBuildingOccupants(ctx, ts, buildingOccupants);

    // Draw outside characters
    for (const char of characters) {
      if (char.inside) continue;

      const pos = interpolator.getPosition(char.id) || char.pos;
      const sx = pos.x * ts - this.camera.x;
      const sy = pos.y * ts - this.camera.y;

      if (sx < -ts * 2 || sx > this.fgCanvas.width + ts ||
          sy < -ts * 2 || sy > this.fgCanvas.height + ts) continue;

      // Destination line for selected character
      if (char._selected && char.walking && char.activityData && char.activityData.destination) {
        this.drawDestinationLine(ctx, ts, sx, sy, char);
      }

      // Interaction glow
      if (['chat', 'greet', 'flirt', 'argue', 'confess', 'comfort', 'confront'].includes(char.activity)) {
        this.drawInteractionGlow(ctx, sx, sy, ts, char);
      }

      // Character body
      this.drawCharacter(ctx, sx, sy, ts, char);

      // Name label - warm parchment pill
      ctx.font = `600 ${Math.max(10, ts * 0.38)}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      const nameWidth = ctx.measureText(char.name).width;
      const pillX = sx + ts / 2 - nameWidth / 2 - 6;
      const pillY = sy - 16;
      const pillW = nameWidth + 12;
      const pillH = 16;

      ctx.fillStyle = 'rgba(250, 246, 240, 0.85)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 8);
      ctx.fill();

      // Character-colored dot
      ctx.fillStyle = char.color || '#aaa';
      ctx.beginPath();
      ctx.arc(pillX + 6, pillY + pillH / 2, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3d3225';
      ctx.fillText(char.name, sx + ts / 2, sy - 4);

      // Activity label
      const activityLabel = this.getActivityLabel(char, characters);
      if (activityLabel) {
        ctx.font = `${Math.max(8, ts * 0.28)}px Nunito, sans-serif`;
        ctx.fillStyle = 'rgba(250, 246, 240, 0.75)';
        const labelWidth = ctx.measureText(activityLabel).width;
        ctx.beginPath();
        ctx.roundRect(sx + ts / 2 - labelWidth / 2 - 4, sy + ts + 1, labelWidth + 8, 13, 4);
        ctx.fill();
        ctx.fillStyle = '#6b5e50';
        ctx.fillText(activityLabel, sx + ts / 2, sy + ts + 11);
      }

      // Speech bubble
      if (char.say && currentTick - char.sayTick < 20) {
        this.drawBubble(ctx, sx + ts / 2, sy - 20, char.say, 'rgba(255, 255, 252, 0.95)', '#3d3225');
      }

      // Thought bubble
      if (char.think && currentTick - char.thinkTick < 12) {
        this.drawThoughtBubble(ctx, sx + ts / 2, sy - 40, char.think);
      }

      // Activity indicator
      this.drawActivityIndicator(ctx, sx, sy, ts, char);
    }

    // Particles
    this.updateParticles(ctx, ts);
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

  drawBuildingGlows(ctx, ts, buildingOccupants) {
    for (const [buildingId, occupants] of Object.entries(buildingOccupants)) {
      const b = this.buildings[buildingId];
      if (!b) continue;
      const bx = b.x * ts - this.camera.x;
      const by = b.y * ts - this.camera.y;
      const bw = b.w * ts;
      const bh = b.h * ts;

      if (bx + bw < 0 || bx > this.fgCanvas.width || by + bh < 0 || by > this.fgCanvas.height) continue;

      const pulse = 0.15 + 0.05 * Math.sin(Date.now() / 1000);
      ctx.fillStyle = `rgba(255, 200, 80, ${pulse})`;
      ctx.fillRect(bx, by, bw, bh);

      const windowSize = Math.max(4, ts * 0.25);
      ctx.fillStyle = `rgba(255, 220, 120, ${pulse + 0.1})`;
      for (let wx = bx + ts * 0.3; wx < bx + bw - ts * 0.3; wx += ts * 0.8) {
        for (let wy = by + ts * 0.3; wy < by + bh - ts * 0.5; wy += ts * 0.8) {
          ctx.fillRect(wx, wy, windowSize, windowSize);
        }
      }
    }
  }

  drawBuildingOccupants(ctx, ts, buildingOccupants) {
    for (const [buildingId, occupants] of Object.entries(buildingOccupants)) {
      const b = this.buildings[buildingId];
      if (!b) continue;
      const bCenterX = (b.x + b.w / 2) * ts - this.camera.x;
      const bTopY = b.y * ts - this.camera.y;

      if (bCenterX < -50 || bCenterX > this.fgCanvas.width + 50) continue;

      const dotSize = Math.max(4, ts * 0.2);
      const startX = bCenterX - (occupants.length * (dotSize + 2)) / 2;
      for (let i = 0; i < occupants.length; i++) {
        const occ = occupants[i];
        const dx = startX + i * (dotSize + 2);
        const dy = bTopY - dotSize - 2;

        ctx.fillStyle = occ.color || '#aaa';
        ctx.beginPath();
        ctx.arc(dx + dotSize / 2, dy + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (occupants.length > 0) {
        const badgeText = String(occupants.length);
        ctx.font = `bold ${Math.max(9, ts * 0.32)}px Nunito, sans-serif`;
        const badgeWidth = ctx.measureText(badgeText).width + 6;
        const badgeX = bCenterX + (b.w / 2) * ts - 2;
        const badgeY = bTopY - 4;

        ctx.fillStyle = '#e07850';
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeWidth / 2 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, badgeX, badgeY + 4);
      }
    }
  }

  drawDestinationLine(ctx, ts, sx, sy, char) {
    const dest = char.activityData.destination;
    const b = this.buildings[dest];
    if (!b) return;
    const destX = (b.x + b.w / 2) * ts - this.camera.x;
    const destY = (b.y + b.h / 2) * ts - this.camera.y;
    const startX = sx + ts / 2;
    const startY = sy + ts / 2;

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(224, 120, 80, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(destX, destY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(224, 120, 80, 0.6)';
    ctx.beginPath();
    ctx.moveTo(destX, destY - 4);
    ctx.lineTo(destX + 4, destY);
    ctx.lineTo(destX, destY + 4);
    ctx.lineTo(destX - 4, destY);
    ctx.closePath();
    ctx.fill();
  }

  drawInteractionGlow(ctx, sx, sy, ts, char) {
    const colors = {
      chat: 'rgba(107, 174, 107, 0.15)',
      greet: 'rgba(107, 174, 107, 0.12)',
      flirt: 'rgba(212, 112, 138, 0.2)',
      argue: 'rgba(192, 82, 74, 0.2)',
      confess: 'rgba(212, 112, 138, 0.25)',
      comfort: 'rgba(107, 174, 107, 0.18)',
      confront: 'rgba(192, 82, 74, 0.22)'
    };
    const pulse = 0.8 + 0.2 * Math.sin(Date.now() / 300);
    ctx.fillStyle = colors[char.activity] || 'rgba(255,255,255,0.1)';
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(sx + ts / 2, sy + ts / 2, ts * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  spawnParticles(activity, worldX, worldY) {
    const now = Date.now();
    const configs = {
      chat:  { emoji: '\uD83D\uDCAC', count: 1, life: 1200 },
      flirt: { emoji: '\u2764\uFE0F',  count: 2, life: 1500 },
      argue: { emoji: '\uD83D\uDCA2', count: 1, life: 1000 },
      confess: { emoji: '\uD83D\uDC8C', count: 2, life: 1500 },
      shop:  { emoji: '\uD83D\uDCB0', count: 1, life: 1000 },
      drink: { emoji: '\uD83C\uDF7A', count: 1, life: 1000 },
      eat:   { emoji: '\uD83C\uDF7D\uFE0F', count: 1, life: 1000 },
      pray:  { emoji: '\uD83D\uDE4F', count: 1, life: 1200 },
      play:  { emoji: '\u26BD',       count: 1, life: 1000 },
      work:  { emoji: '\u2692\uFE0F', count: 1, life: 800 },
      gift:  { emoji: '\uD83C\uDF81', count: 1, life: 1200 },
      comfort: { emoji: '\uD83E\uDD17', count: 1, life: 1200 },
      cry:   { emoji: '\uD83D\uDE22', count: 1, life: 1000 },
      dance: { emoji: '\uD83C\uDFB5', count: 1, life: 1200 },
      celebrate: { emoji: '\uD83C\uDF89', count: 2, life: 1200 }
    };
    const cfg = configs[activity];
    if (!cfg) return;

    for (let i = 0; i < cfg.count; i++) {
      this.particles.push({
        emoji: cfg.emoji,
        x: worldX,
        y: worldY,
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.01 - Math.random() * 0.01,
        born: now,
        life: cfg.life + Math.random() * 400,
        size: 0.4 + Math.random() * 0.2
      });
    }
  }

  updateParticles(ctx, ts) {
    const now = Date.now();
    this.particles = this.particles.filter(p => now - p.born < p.life);

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;

      const age = (now - p.born) / p.life;
      const sx = p.x * ts - this.camera.x;
      const sy = p.y * ts - this.camera.y;

      if (sx < -20 || sx > this.fgCanvas.width + 20 || sy < -20 || sy > this.fgCanvas.height + 20) continue;

      ctx.globalAlpha = 1 - age;
      ctx.font = `${ts * p.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.emoji, sx, sy);
      ctx.globalAlpha = 1;
    }
  }

  drawCharacter(ctx, sx, sy, ts, char) {
    const color = char.color || '#a0a0a0';
    const halfTs = ts / 2;
    const qTs = ts / 4;

    // Bouncy walk animation
    let yBounce = 0;
    if (char.walking) {
      yBounce = Math.sin(Date.now() / 150) * 2;
    }

    // Shadow (squishes during walk)
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    const shadowStretch = char.walking ? 0.8 : 0.7;
    ctx.beginPath();
    ctx.ellipse(sx + halfTs, sy + ts - 1, halfTs * shadowStretch, qTs * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawY = sy + yBounce;

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(sx + qTs, drawY + halfTs - 2, halfTs, halfTs + 2);

    // Head (round)
    const headSize = halfTs * 0.8;
    const headCenterX = sx + halfTs;
    const headCenterY = drawY + 2 + headSize / 2;
    ctx.fillStyle = '#f0d0b0';
    ctx.beginPath();
    ctx.arc(headCenterX, headCenterY, headSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = this.darkenColor(color, 0.5);
    ctx.beginPath();
    ctx.arc(headCenterX, headCenterY - 2, headSize / 2, Math.PI, 2 * Math.PI);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#222';
    const eyeY = headCenterY + 1;
    if (char.activity === 'sleep') {
      ctx.fillRect(headCenterX - 4, eyeY, 3, 1);
      ctx.fillRect(headCenterX + 2, eyeY, 3, 1);
    } else if (char.activity === 'cry') {
      ctx.fillRect(headCenterX - 4, eyeY, 2, 2);
      ctx.fillRect(headCenterX + 2, eyeY, 2, 2);
      // Tear
      ctx.fillStyle = '#5a8aad';
      ctx.fillRect(headCenterX - 3, eyeY + 3, 1, 2);
    } else {
      ctx.fillRect(headCenterX - 4, eyeY, 2, 2);
      ctx.fillRect(headCenterX + 2, eyeY, 2, 2);
    }

    // Legs
    if (char.walking) {
      const frame = Math.floor(Date.now() / 200) % 2;
      ctx.fillStyle = this.darkenColor(color, 0.7);
      if (frame === 0) {
        ctx.fillRect(sx + qTs + 2, sy + ts - 6, 4, 6);
        ctx.fillRect(sx + halfTs + 2, sy + ts - 4, 4, 4);
      } else {
        ctx.fillRect(sx + qTs + 2, sy + ts - 4, 4, 4);
        ctx.fillRect(sx + halfTs + 2, sy + ts - 6, 4, 6);
      }
    } else {
      ctx.fillStyle = this.darkenColor(color, 0.7);
      ctx.fillRect(sx + qTs + 2, sy + ts - 5, 4, 5);
      ctx.fillRect(sx + halfTs + 2, sy + ts - 5, 4, 5);
    }

    // Selection - soft glow circle
    if (char._selected) {
      ctx.strokeStyle = 'rgba(224, 120, 80, 0.6)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(224, 120, 80, 0.4)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx + ts / 2, sy + ts / 2, ts * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  drawBubble(ctx, x, y, text, bgColor, textColor) {
    ctx.font = `${Math.max(9, this.ts * 0.3)}px Nunito, sans-serif`;
    const maxWidth = 160;
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

    const lineHeight = 13;
    const padding = 7;
    const totalHeight = lines.length * lineHeight + padding * 2;
    const totalWidth = Math.min(maxWidth + padding * 2,
      Math.max(...lines.map(l => ctx.measureText(l).width)) + padding * 2);

    const bx = x - totalWidth / 2;
    const by = y - totalHeight;

    // Shadow
    ctx.fillStyle = 'rgba(61, 50, 37, 0.15)';
    ctx.beginPath();
    ctx.roundRect(bx + 2, by + 2, totalWidth, totalHeight, 8);
    ctx.fill();

    // Bubble
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(bx, by, totalWidth, totalHeight, 8);
    ctx.fill();

    // Pointer
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x + 5, y);
    ctx.fill();

    // Text
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + padding, by + padding + 10 + i * lineHeight);
    }
    ctx.textAlign = 'center';
  }

  drawThoughtBubble(ctx, x, y, text) {
    ctx.font = `${Math.max(8, this.ts * 0.28)}px Nunito, sans-serif`;
    const width = Math.min(120, ctx.measureText(text).width + 12);

    ctx.fillStyle = 'rgba(232, 224, 212, 0.85)';
    ctx.beginPath();
    ctx.ellipse(x, y - 8, width / 2, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x - 4, y + 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 8, y + 10, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#6b5e50';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y - 4);
  }

  drawActivityIndicator(ctx, sx, sy, ts, char) {
    const emojis = {
      sleep: null,
      eat:   '\uD83C\uDF7D\uFE0F',
      work:  '\u2692\uFE0F',
      chat:  '\uD83D\uDCAC',
      drink: '\uD83C\uDF7A',
      pray:  '\uD83D\uDE4F',
      play:  '\u26BD',
      shop:  '\uD83D\uDED2',
      think: '\uD83D\uDCAD',
      greet: '\uD83D\uDC4B',
      flirt: '\u2764\uFE0F',
      argue: '\uD83D\uDCA2',
      gift:  '\uD83C\uDF81',
      relax: '\uD83D\uDE0C',
      wander:'\uD83D\uDC63',
      confess: '\uD83D\uDC8C',
      comfort: '\uD83E\uDD17',
      confront: '\uD83D\uDE24',
      cry: '\uD83D\uDE22',
      dance: '\uD83D\uDC83',
      sing: '\uD83C\uDFA4',
      celebrate: '\uD83C\uDF89',
      gossip: '\uD83E\uDD2B',
      fish: '\uD83C\uDFA3',
      stargaze: '\u2B50',
      garden: '\uD83C\uDF31',
      explore: '\uD83E\uDDED',
      craft: '\uD83D\uDD28'
    };

    if (char.activity === 'sleep') {
      ctx.font = `bold ${ts * 0.4}px sans-serif`;
      ctx.fillStyle = '#8888b0';
      const frame = Math.floor(Date.now() / 600) % 3;
      const zText = 'z'.repeat(frame + 1);
      ctx.fillText(zText, sx + ts + 2, sy - frame * 4);
    } else if (emojis[char.activity]) {
      ctx.font = `${ts * 0.45}px sans-serif`;
      ctx.fillText(emojis[char.activity], sx + ts - 4, sy + 4);
    }

    // Spawn particles
    if (char.activity && char.activity !== 'idle' && char.activity !== 'goto' && char.activity !== 'wander') {
      if (Math.random() < 0.02) {
        const pos = char.pos || { x: sx / ts, y: sy / ts };
        this.spawnParticles(char.activity, pos.x + 0.5, pos.y - 0.5);
      }
    }
  }

  renderDayNightOverlay(phase) {
    const ctx = this.fgCtx;
    let overlay = null;

    switch (phase) {
      case 'dawn':
        overlay = 'rgba(224, 160, 96, 0.12)';
        break;
      case 'evening':
        overlay = 'rgba(192, 112, 64, 0.18)';
        break;
      case 'night':
        overlay = 'rgba(30, 30, 60, 0.40)';
        break;
    }

    if (overlay) {
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, this.fgCanvas.width, this.fgCanvas.height);
    }
  }

  markDirty() {
    this.bgDirty = true;
  }

  darkenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
  }
}
