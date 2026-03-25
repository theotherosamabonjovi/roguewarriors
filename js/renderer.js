// ============================================================
//  ROGUE WARRIORS DIGITAL — RENDERER
// ============================================================

class Renderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx    = this.canvas.getContext('2d');
    this.T      = CFG.TILE;
    this._seed  = 42;  // For deterministic noise

    // Highlight overlays
    this.moveHighlights   = []; // [{x,y}]
    this.attackHighlights = []; // unit ids
    this.blastHighlights  = []; // [{x,y}] tile-based targeting for grenadier
    this.deployHighlights = []; // [{x,y}] valid drop tiles during deploy
    this.hoverTile        = null;
    this.selectedUnit     = null;
    this.lastResult       = null; // last combat result for flash
    this.flashUnit        = null;
    this.flashTimer       = 0;
    this.healTargets      = [];
    this.animFrame        = 0;
    // Move slide animations: unitId → { fromX, fromY, toX, toY, t, duration }
    // t counts up from 0 to duration each draw() call.
    this._moveAnims       = {};

    // Resize canvas to match grid
    this.canvas.width  = CFG.COLS * this.T;
    this.canvas.height = CFG.ROWS * this.T;
  }

  // ─── Main draw ────────────────────────────────────────────
  draw(state) {
    this.animFrame++;
    this._tickMoveAnims();   // advance slide animations each frame
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw tiles
    for (let r = 0; r < CFG.ROWS; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        this._drawTile(state, c, r);
      }
    }

    // Draw deploy zones + highlights during deploy phase
    if (state.phase === 'deploy') {
      this._drawDeployZoneFull(state);
      if (this.deployHighlights && this.deployHighlights.length) this._drawDeployHighlights();
    }

    // Draw move range
    if (this.moveHighlights.length)  this._drawMoveRange();
    if (this.blastHighlights.length)  this._drawBlastRange();

    // Draw buildings
    state.buildings.forEach(b => this._drawBuilding(state, b));

    // Draw cover objects
    state.coverObjs.forEach(co => this._drawCover(state, co));

    // Draw deployment zones if deploying
    if (state.phase === 'deploy') this._drawDeployZones();

    // Draw attack range highlights
    if (this.attackHighlights.length) this._drawAttackHighlights(state);

    // Draw heal targets
    if (this.healTargets.length) this._drawHealTargets(state);

    // Draw motion trails for sliding units (behind the unit sprites)
    state.units.forEach(u => {
      if (u.alive && u.x >= 0 && this._moveAnims[u.id]) this._drawMoveTrail(state, u);
    });

    // Draw units (skip undeployed).
    // During online deploy, hide the opponent's units so neither player can
    // see where the other is placing.  _onlineMyTeam is set to 0 or 1 while
    // in the deploy phase and cleared back to null by _exitDeployPhase the
    // moment battle starts, so this guard is automatically inactive in play.
    state.units.forEach(u => {
      if (!u.alive || u.x < 0 || u.y < 0) return;
      if ((this._onlineMyTeam === 0 || this._onlineMyTeam === 1) &&
          u.team !== this._onlineMyTeam) return;
      this._drawUnit(state, u);
    });

    // Draw dead units (tombstones, skip undeployed)
    state.units.forEach(u => {
      if (!u.alive && u.x >= 0 && u.y >= 0) this._drawTombstone(state, u);
    });

    // Draw objectives (CTF flag, bomb sites, VIP marker, extraction point)
    if (state.phase === 'playing' || state.phase === 'gameover') {
      this._drawObjectives(state);
    }

    // Draw hover
    if (this.hoverTile) this._drawHover();

    // Deployment column markers
    this._drawDeployMarkers(state);

    // Flash effect for recent combat
    if (this.flashUnit)   this._drawFlash(state);
    if (this._blastFlash) this._drawBlastFlash();
  }

  // ─── Tile ─────────────────────────────────────────────────
  _drawTile(state, c, r) {
    const ctx = this.ctx;
    const T   = this.T;
    const x   = c * T, y = r * T;
    const tile = state.board[r][c];
    const theme = THEMES[state.theme];

    // Base color (checkerboard subtle variation)
    const alt   = (c + r) % 2 === 0;
    const base  = alt ? theme.base : theme.baseAlt;

    ctx.fillStyle = base;
    ctx.fillRect(x, y, T, T);

    // Ground texture details
    this._drawGroundTexture(ctx, c, r, T, theme.groundVariant);

    // Border line
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);

    // Rubble
    if (tile.type === TILE.RUBBLE) {
      ctx.fillStyle = 'rgba(80,60,40,0.45)';
      ctx.fillRect(x + 4, y + 4, T - 8, T - 8);
      ctx.fillStyle = '#8a7060';
      for (let i = 0; i < 6; i++) {
        const nx = x + 4 + this._noise(c * 17 + i, r * 13) * (T - 12);
        const ny = y + 4 + this._noise(c * 11 + i + 7, r * 19 + i) * (T - 12);
        ctx.fillRect(nx, ny, 4, 3);
      }
    }
  }

  _drawGroundTexture(ctx, c, r, T, variant) {
    const x = c * T, y = r * T;
    ctx.save();
    ctx.globalAlpha = 0.25;
    if (variant === 'grass') {
      ctx.fillStyle = '#2d6e2d';
      for (let i = 0; i < 4; i++) {
        const nx = x + this._noise(c * 7 + i * 3, r * 5 + i) * T;
        const ny = y + this._noise(c * 11 + i, r * 9 + i * 2) * T;
        ctx.fillRect(nx, ny, 2, 3);
      }
    } else if (variant === 'sand') {
      ctx.fillStyle = '#9a7830';
      for (let i = 0; i < 5; i++) {
        const nx = x + this._noise(c * 5 + i, r * 3 + i * 4) * T;
        const ny = y + this._noise(c * 13 + i * 2, r * 11 + i) * T;
        ctx.fillRect(nx, ny, 3, 1);
      }
    } else if (variant === 'concrete') {
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.5;
      if (c % 4 === 0) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + T); ctx.stroke(); }
      if (r % 2 === 0) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + T, y); ctx.stroke(); }
    } else if (variant === 'snow') {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const nx = x + this._noise(c * 9 + i, r * 7 + i * 3) * T;
        const ny = y + this._noise(c * 3 + i * 5, r * 17 + i) * T;
        const sz = 1 + this._noise(c + i, r + i) * 2;
        ctx.fillRect(nx, ny, sz, sz);
      }
    }
    ctx.restore();
  }

  _noise(x, y) {
    // Simple deterministic pseudorandom 0..1
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  // ─── Building ─────────────────────────────────────────────
  _drawBuilding(state, b) {
    const ctx   = this.ctx;
    const T     = this.T;
    const theme = THEMES[state.theme];
    const px = b.x * T, py = b.y * T;
    const pw = b.w * T, ph = b.h * T;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 4, py + 4, pw, ph);

    // Walls
    ctx.fillStyle = theme.buildingColor;
    ctx.fillRect(px, py, pw, ph);

    // Roof
    ctx.fillStyle = theme.buildingRoof;
    const roofIn = T * 0.2;
    ctx.fillRect(px + roofIn, py + roofIn, pw - roofIn * 2, ph - roofIn * 2);

    // Ridge line
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.5, py + roofIn);
    ctx.lineTo(px + pw * 0.5, py + ph - roofIn);
    ctx.stroke();

    // Windows
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    const winSize = 5;
    if (b.w >= 2) {
      ctx.fillRect(px + T * 0.3, py + T * 0.3, winSize, winSize);
      if (b.w >= 3) ctx.fillRect(px + T * 1.3, py + T * 0.3, winSize, winSize);
      if (b.h >= 2) ctx.fillRect(px + T * 0.3, py + T * 1.3, winSize, winSize);
    }

    // Door
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const doorW = Math.floor(T * 0.25), doorH = Math.floor(T * 0.35);
    ctx.fillRect(px + Math.floor(pw / 2) - doorW / 2, py + ph - doorH, doorW, doorH);

    // Outline
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  }

  // ─── Cover object ─────────────────────────────────────────
  _drawCover(state, co) {
    const ctx   = this.ctx;
    const T     = this.T;
    const theme = THEMES[state.theme];
    const cx    = co.x * T + T / 2;
    const cy    = co.y * T + T / 2;

    ctx.save();
    if (co.type === 'sandbag') {
      ctx.fillStyle = '#c4a040';
      // Draw 3 stacked sandbags
      for (let i = 0; i < 3; i++) {
        const bx = cx - 12 + i * 9, by = cy;
        ctx.beginPath();
        ctx.ellipse(bx, by, 7, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#806820';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Top row
      for (let i = 0; i < 2; i++) {
        const bx = cx - 7 + i * 9, by = cy - 7;
        ctx.beginPath();
        ctx.ellipse(bx, by, 7, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (co.type === 'crate') {
      ctx.fillStyle = '#8b6020';
      ctx.fillRect(cx - 11, cy - 11, 22, 22);
      ctx.strokeStyle = '#604010';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 11, cy - 11, 22, 22);
      ctx.beginPath();
      ctx.moveTo(cx - 11, cy); ctx.lineTo(cx + 11, cy);
      ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy + 11);
      ctx.stroke();
    } else if (co.type === 'barrier') {
      ctx.fillStyle = theme.groundVariant === 'concrete' ? '#aaaaaa' : '#888888';
      ctx.fillRect(cx - 14, cy - 6, 28, 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 14, cy - 6, 28, 12);
      // Jersey barrier ridges
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(cx - 12, cy - 4, 24, 4);
    } else if (co.type === 'wall') {
      ctx.fillStyle = '#888';
      const wallPts = [
        [cx - 14, cy - 3], [cx + 14, cy - 3],
        [cx + 14, cy + 3], [cx - 14, cy + 3],
      ];
      ctx.beginPath();
      wallPts.forEach(([wx, wy], i) => i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Brick pattern
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + i * 9 - 1, cy - 3, 1, 6);
      }
    }
    ctx.restore();
  }

  // ─── Soldier unit ─────────────────────────────────────────
  _drawUnit(state, unit) {
    const ctx  = this.ctx;
    const T    = this.T;
    // Use animated position if a slide is in progress, otherwise snap to tile
    const { px: cx, py: cy, dustAlpha } = this._unitDrawPos(unit);
    const teamColor = TEAM_COLORS[unit.team];
    const isSelected = this.selectedUnit && this.selectedUnit.id === unit.id;
    const isActive   = state.activeUnit === unit.id;
    const activated  = state.activatedThisRound.has(unit.id);
    const pulse      = Math.sin(this.animFrame * 0.1) * 0.5 + 0.5;

    ctx.save();

    // Glow for selected/active unit
    if (isSelected || isActive) {
      ctx.shadowColor = isActive ? '#ffeb3b' : '#ffffff';
      ctx.shadowBlur  = 10 + pulse * 6;
    }

    // Activated dimming
    if (activated && !isActive) ctx.globalAlpha = 0.55;

    // Pinned indicator ring (purple)
    if (unit.pinned) {
      ctx.strokeStyle = '#b84cf7';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Heavy cover indicator (teal shield ring)
    if (unit.inHeavyCover) {
      ctx.strokeStyle = '#00bcd4';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.stroke();
    } else if (unit.inCover) {
      // Light cover indicator (faint teal)
      ctx.strokeStyle = 'rgba(0,188,212,0.45)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Overwatch indicator
    if (state.overwatchUnits && state.overwatchUnits.has(unit.id)) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth   = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + 3, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Body (teardrop shape pointing right = facing enemy)
    const facing = unit.team === 0 ? 0 : Math.PI;
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(facing);
    // Draw soldier body
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Helmet/head (circle at front)
    ctx.fillStyle = this._lighten(teamColor, 0.3);
    ctx.beginPath();
    ctx.arc(9, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Weapon indicator on body
    ctx.restore();
    this._drawUnitIcon(ctx, cx, cy, unit.type, teamColor);

    // HP bar
    if (unit.maxHp > 1) {
      const barW = 20, barH = 3;
      const bx = cx - barW / 2, by = cy + 14;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = unit.hp > 1 ? '#4caf50' : '#f44336';
      ctx.fillRect(bx, by, barW * (unit.hp / unit.maxHp), barH);
    }

    // Unit type label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText(unit.name.substring(0, 3).toUpperCase(), cx, cy + 24);
    ctx.shadowBlur = 0;

    // Bomb carrier indicator
    if (state.gameMode === 'bomb' && state.objectives?.bomb?.carriedBy === unit.id) {
      ctx.font = '11px serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
      ctx.fillText('💣', cx + 10, cy - 10);
      ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
    }

    // Status badges (pinned 📌 / jammed 🔧 / reload 🔄) above unit
    const badges = [];
    if (unit.pinned)       badges.push('📌');
    if (unit.weaponJammed) badges.push('🔧');
    if (unit.needsReload)  badges.push('🔄');
    if (badges.length) {
      ctx.font = '10px serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'center';
      ctx.shadowColor  = '#000';
      ctx.shadowBlur   = 3;
      badges.forEach((b, i) => ctx.fillText(b, cx - 8 + i * 12, cy - 18));
      ctx.shadowBlur   = 0;
      ctx.textBaseline = 'alphabetic';
    }

    // Speed lines — short strokes behind the unit in its current travel direction
    const anim = this._moveAnims[unit.id];
    if (anim) {
      const { from, to, raw } = this._animSegment(anim);
      const dx    = to.x - from.x;
      const dy    = to.y - from.y;
      const speed = Math.sqrt(dx * dx + dy * dy);
      if (speed > 0 && raw < 0.9) {
        const segRaw  = ((anim.t % anim.framesPerTile)) / anim.framesPerTile;
        const angle   = Math.atan2(dy, dx);
        const fadeIn  = Math.min(1, segRaw * 5);
        const fadeOut = 1 - Math.max(0, (raw - 0.7) / 0.2);
        const alpha   = fadeIn * fadeOut * 0.55;
        const lineLen = 10 * (1 - raw * 0.3);
        ctx.save();
        ctx.strokeStyle = this._lighten(teamColor, 0.4);
        ctx.globalAlpha = alpha;
        ctx.lineWidth   = 1.5;
        ctx.lineCap     = 'round';
        for (let i = -1; i <= 1; i++) {
          const offX = Math.cos(angle + Math.PI / 2) * (i * 4);
          const offY = Math.sin(angle + Math.PI / 2) * (i * 4);
          ctx.beginPath();
          ctx.moveTo(cx + offX, cy + offY);
          ctx.lineTo(cx - Math.cos(angle) * lineLen + offX, cy - Math.sin(angle) * lineLen + offY);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _drawUnitIcon(ctx, cx, cy, type, teamColor) {
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.fillStyle   = '#fff';
    ctx.lineWidth   = 1.2;
    ctx.globalAlpha = 0.9;
    switch (type) {
      case 'rifleman':
        // Gun shape (L)
        ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 4, cy); ctx.lineTo(cx + 4, cy + 3); ctx.stroke();
        break;
      case 'sniper':
        // Crosshair
        ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'medic':
        // Red cross
        ctx.fillStyle = '#ff3333';
        ctx.fillRect(cx - 1.5, cy - 5, 3, 10);
        ctx.fillRect(cx - 5, cy - 1.5, 10, 3);
        break;
      case 'grenadier':
        // Grenade shape
        ctx.beginPath(); ctx.arc(cx, cy + 1, 4, 0, Math.PI * 2); ctx.stroke();
        ctx.fillRect(cx - 1, cy - 5, 2, 4);
        break;
      case 'leader':
        // Star
        ctx.fillStyle = '#ffeb3b';
        this._drawStar(ctx, cx, cy, 5, 3, 5);
        break;
      case 'scout':
        // Arrow pointing forward
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(cx + 5, cy);
        ctx.lineTo(cx - 3, cy - 4);
        ctx.lineTo(cx - 3, cy + 4);
        ctx.closePath();
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  _drawStar(ctx, x, y, r1, r2, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? r1 : r2;
      i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
              : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
  }

  _lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
    const g = Math.min(255, ((num >>  8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, ((num >>  0) & 0xff) + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  _drawTombstone(state, unit) {
    const ctx = this.ctx;
    const T   = this.T;
    const cx  = unit.x * T + T / 2;
    const cy  = unit.y * T + T / 2;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 6, Math.PI, 0);
    ctx.rect(cx - 6, cy - 5, 12, 10);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('✕', cx, cy + 1);
    ctx.restore();
  }

  // ─── Movement range ───────────────────────────────────────
  _drawBlastRange() {
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    ctx.fillStyle   = 'rgba(255, 140, 0, 0.18)';
    ctx.strokeStyle = 'rgba(255, 140, 0, 0.65)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    for (const { x, y } of this.blastHighlights) {
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawMoveRange() {
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    ctx.fillStyle   = 'rgba(100, 180, 255, 0.22)';
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
    ctx.lineWidth   = 1;
    for (const { x, y } of this.moveHighlights) {
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
    }
    ctx.restore();
  }

  _drawAttackHighlights(state) {
    const ctx = this.ctx;
    const T   = this.T;
    const pulse = Math.sin(this.animFrame * 0.15) * 0.5 + 0.5;
    ctx.save();
    for (const uid of this.attackHighlights) {
      const u = state.units.find(u => u.id === uid);
      if (!u || !u.alive) continue;
      const cx = u.x * T + T / 2, cy = u.y * T + T / 2;
      ctx.fillStyle   = `rgba(255,60,60,${0.15 + pulse * 0.1})`;
      ctx.strokeStyle = `rgba(255,60,60,${0.7 + pulse * 0.3})`;
      ctx.lineWidth   = 2;
      ctx.fillRect(u.x * T + 1, u.y * T + 1, T - 2, T - 2);
      ctx.strokeRect(u.x * T + 1.5, u.y * T + 1.5, T - 3, T - 3);
      // Crosshair
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy);
      ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHealTargets(state) {
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    for (const uid of this.healTargets) {
      const u = state.units.find(u => u.id === uid);
      if (!u) continue;
      ctx.fillStyle   = 'rgba(60,255,120,0.2)';
      ctx.strokeStyle = 'rgba(60,255,120,0.8)';
      ctx.lineWidth   = 2;
      ctx.fillRect(u.x * T + 1, u.y * T + 1, T - 2, T - 2);
      ctx.strokeRect(u.x * T + 1.5, u.y * T + 1.5, T - 3, T - 3);
    }
    ctx.restore();
  }

  _drawDeployZones() {
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    // Player 0: left 2 columns
    ctx.fillStyle = 'rgba(58,158,255,0.12)';
    ctx.fillRect(0, 0, T * 2, CFG.ROWS * T);
    ctx.strokeStyle = 'rgba(58,158,255,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, T * 2 - 2, CFG.ROWS * T - 2);
    // Player 1: right 2 columns
    ctx.fillStyle = 'rgba(255,69,69,0.12)';
    ctx.fillRect(T * (CFG.COLS - 2), 0, T * 2, CFG.ROWS * T);
    ctx.strokeStyle = 'rgba(255,69,69,0.5)';
    ctx.strokeRect(T * (CFG.COLS - 2) + 1, 1, T * 2 - 2, CFG.ROWS * T - 2);
    ctx.restore();
  }

  _drawDeployMarkers(state) {
    if (state.phase !== 'playing' && state.phase !== 'gameover') return;
    // Small team indicator strips
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    ctx.fillStyle = TEAM_COLORS[0] + '44';
    ctx.fillRect(0, 0, 3, CFG.ROWS * T);
    ctx.fillStyle = TEAM_COLORS[1] + '44';
    ctx.fillRect(CFG.COLS * T - 3, 0, 3, CFG.ROWS * T);
    ctx.restore();
  }

  _drawHover() {
    const ctx = this.ctx;
    const T   = this.T;
    const { x, y } = this.hoverTile;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
    ctx.restore();
  }

  _drawFlash(state) {
    const u = state.units.find(u => u.id === this.flashUnit);
    if (!u) { this.flashUnit = null; return; }
    const ctx = this.ctx;
    const T   = this.T;
    const alpha = Math.max(0, this.flashTimer / 30);
    ctx.save();
    ctx.fillStyle = `rgba(255,100,100,${alpha * 0.5})`;
    ctx.fillRect(u.x * T, u.y * T, T, T);
    ctx.restore();
    this.flashTimer--;
    if (this.flashTimer <= 0) this.flashUnit = null;
  }

  _drawBlastFlash() {
    const bf = this._blastFlash;
    if (!bf) return;
    const ctx = this.ctx;
    const T   = this.T;
    const alpha = bf.timer / 25;
    ctx.save();
    // Expanding orange ring
    const radius = (1 - alpha) * T * 1.8 + T * 0.3;
    ctx.strokeStyle = `rgba(255,140,0,${alpha * 0.9})`;
    ctx.fillStyle   = `rgba(255,80,0,${alpha * 0.35})`;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(bf.tx * T + T / 2, bf.ty * T + T / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    bf.timer--;
    if (bf.timer <= 0) this._blastFlash = null;
  }

  triggerFlash(unitId) {
    this.flashUnit  = unitId;
    this.flashTimer = 30;
  }

  // Trigger an orange explosion flash centred on tile (tx, ty)
  triggerBlastFlash(tx, ty) {
    this._blastFlash = { tx, ty, timer: 25 };
  }

  // ─── Move slide animation ─────────────────────────────────
  // Call this BEFORE state.moveUnit() so fromX/fromY are the current position.
  // isSprint=true uses a slightly longer duration.
  // path: array of {x,y} tile waypoints from engine.getPath(), excluding origin.
  // The animation walks each segment at a fixed frames-per-tile rate so longer
  // paths naturally take longer (sprint is faster per tile).
  triggerMove(unitId, path, isSprint = false) {
    if (!path || path.length === 0) return;
    const framesPerTile = isSprint ? 7 : 10;
    this._moveAnims[unitId] = {
      path,           // [{x,y}, ...]  waypoints, not including origin
      t: 0,
      duration: path.length * framesPerTile,
      framesPerTile,
    };
  }

  // Advance all in-flight move animations by one frame.
  _tickMoveAnims() {
    for (const id of Object.keys(this._moveAnims)) {
      const a = this._moveAnims[id];
      a.t++;
      if (a.t >= a.duration) delete this._moveAnims[id];
    }
  }

  // Given a path animation, return the current {fromTile, toTile, segProgress}
  // where segProgress is 0→1 within the current tile-to-tile segment.
  _animSegment(anim) {
    const { path, t, framesPerTile } = anim;
    // Which segment are we on?
    const segIdx  = Math.min(Math.floor(t / framesPerTile), path.length - 1);
    const segT    = (t - segIdx * framesPerTile) / framesPerTile; // 0→1 within seg
    const ease    = 1 - (1 - Math.min(segT, 1)) * (1 - Math.min(segT, 1)); // ease-out
    const from    = segIdx === 0
      ? anim._origin   // set by caller so we always have the true start tile
      : path[segIdx - 1];
    const to      = path[segIdx];
    return { from, to, ease, segIdx, raw: t / anim.duration };
  }

  // Return the interpolated pixel centre for a unit.
  _unitDrawPos(unit) {
    const T    = this.T;
    const anim = this._moveAnims[unit.id];
    if (!anim) {
      return { px: unit.x * T + T / 2, py: unit.y * T + T / 2 };
    }
    const { from, to, ease, raw } = this._animSegment(anim);
    const px = (from.x + (to.x - from.x) * ease) * T + T / 2;
    const py = (from.y + (to.y - from.y) * ease) * T + T / 2;
    return { px, py, raw };
  }

  // Draw ghost-dot trail and arrival dust puff, routing correctly around buildings.
  _drawMoveTrail(state, unit) {
    const anim = this._moveAnims[unit.id];
    if (!anim) return;

    const ctx       = this.ctx;
    const T         = this.T;
    const teamColor = TEAM_COLORS[unit.team];
    const { from, to, ease, raw } = this._animSegment(anim);

    // Current pixel position of the unit
    const curPx = (from.x + (to.x - from.x) * ease) * T + T / 2;
    const curPy = (from.y + (to.y - from.y) * ease) * T + T / 2;

    ctx.save();

    // ── Ghost dots — 5 positions trailing back along the path ──────────────
    // Walk backwards through the path at sub-tile precision to find ghost spots.
    const GHOSTS = 5;
    const trailSpacing = anim.framesPerTile * 0.6; // frames between ghost dots
    for (let i = 1; i <= GHOSTS; i++) {
      const ghostT = Math.max(0, anim.t - i * trailSpacing);
      // Re-derive position at ghostT
      const gSegIdx = Math.min(Math.floor(ghostT / anim.framesPerTile), anim.path.length - 1);
      const gSegT   = (ghostT - gSegIdx * anim.framesPerTile) / anim.framesPerTile;
      const gEase   = 1 - (1 - Math.min(gSegT, 1)) * (1 - Math.min(gSegT, 1));
      const gFrom   = gSegIdx === 0 ? anim._origin : anim.path[gSegIdx - 1];
      const gTo     = anim.path[gSegIdx];
      const gx      = (gFrom.x + (gTo.x - gFrom.x) * gEase) * T + T / 2;
      const gy      = (gFrom.y + (gTo.y - gFrom.y) * gEase) * T + T / 2;

      const r = Math.max(1, (8 - i * 1.2) * (1 - raw * 0.4));
      const a = (1 - raw) * 0.5 * (1 - i / (GHOSTS + 1));
      if (a <= 0) continue;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fillStyle = teamColor;
      ctx.globalAlpha = a;
      ctx.fill();
    }

    // ── Dust puff on arrival (last 30% of total animation) ──────────────────
    if (raw > 0.7) {
      const puffProgress = (raw - 0.7) / 0.3;
      const puffAlpha    = (1 - puffProgress) * 0.6;
      const puffRadius   = 6 + puffProgress * 14;
      const PUFFS = 6;
      for (let i = 0; i < PUFFS; i++) {
        const angle  = (i / PUFFS) * Math.PI * 2 + anim.t * 0.3;
        const spread = puffProgress * T * 0.45;
        const px     = curPx + Math.cos(angle) * spread;
        const py     = curPy + Math.sin(angle) * spread * 0.5;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, puffRadius * (1 - i / PUFFS / 2)), 0, Math.PI * 2);
        ctx.fillStyle = '#c8baa0';
        ctx.globalAlpha = puffAlpha * (1 - i / PUFFS);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  _drawDeployZoneFull(state) {
    const ctx = this.ctx;
    const T   = this.T;
    const { COLS, ROWS } = CFG;

    // Team 0 zone: cols 0-3
    ctx.save();
    ctx.fillStyle = 'rgba(58,158,255,0.10)';
    ctx.fillRect(0, 0, T * 4, ROWS * T);
    if (state.deployingTeam === 0) {
      ctx.strokeStyle = 'rgba(58,158,255,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, T * 4 - 2, ROWS * T - 2);
      ctx.fillStyle = 'rgba(58,158,255,0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ALPHA DEPLOY ZONE', T * 2, 14);
    }
    ctx.restore();

    // Team 1 zone: cols COLS-4 to COLS-1
    ctx.save();
    ctx.fillStyle = 'rgba(255,69,69,0.10)';
    ctx.fillRect(T * (COLS - 4), 0, T * 4, ROWS * T);
    if (state.deployingTeam === 1) {
      ctx.strokeStyle = 'rgba(255,69,69,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(T * (COLS - 4) + 1, 1, T * 4 - 2, ROWS * T - 2);
      ctx.fillStyle = 'rgba(255,69,69,0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BRAVO DEPLOY ZONE', T * (COLS - 2), 14);
    }
    ctx.restore();
  }

  _drawDeployHighlights() {
    const ctx = this.ctx;
    const T   = this.T;
    ctx.save();
    ctx.fillStyle   = 'rgba(255,255,100,0.18)';
    ctx.strokeStyle = 'rgba(255,255,100,0.7)';
    ctx.lineWidth   = 1.5;
    for (const { x, y } of this.deployHighlights) {
      ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
    }
    ctx.restore();
  }

  // ─── Objectives ───────────────────────────────────────────
  _drawObjectives(state) {
    const ctx = this.ctx;
    const T   = this.T;
    const obj = state.objectives;
    if (!obj) return;

    // ── CTF flag ──
    if (state.gameMode === 'ctf' && obj.flag && obj.flag.capturedBy === null) {
      const f  = obj.flag;
      const cx = f.x * T + T / 2;
      const cy = f.y * T + T / 2;
      const pulse = Math.sin(this.animFrame * 0.08) * 0.4 + 0.6;
      ctx.save();
      // Glow ring
      ctx.strokeStyle = `rgba(255,220,0,${pulse})`;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.arc(cx, cy, T * 0.45, 0, Math.PI * 2); ctx.stroke();
      // Pole
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 4, cy + 10); ctx.lineTo(cx - 4, cy - 14); ctx.stroke();
      // Flag cloth
      const carrier = f.carriedBy ? state.getUnit(f.carriedBy) : null;
      const flagColor = carrier ? TEAM_COLORS[carrier.team] : '#ffdd00';
      ctx.fillStyle = flagColor;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 14);
      ctx.lineTo(cx + 12, cy - 8);
      ctx.lineTo(cx - 4, cy - 2);
      ctx.closePath(); ctx.fill();
      // Label
      ctx.fillStyle = '#fff'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
      ctx.fillText(carrier ? '🚩 CARRIED' : '🚩 FLAG', cx, cy + 22);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Physical bomb (before it's planted) ──
    if (state.gameMode === 'bomb' && obj.bomb && !obj.bombPlanted) {
      const b = obj.bomb;
      if (b.carriedBy === null && this._inBoundsR(b.x, b.y)) {
        const cx = b.x * T + T / 2;
        const cy = b.y * T + T / 2;
        const pulse = Math.sin(this.animFrame * 0.1) * 0.4 + 0.6;
        ctx.save();
        ctx.fillStyle   = `rgba(255,180,0,${0.15 + pulse * 0.1})`;
        ctx.strokeStyle = `rgba(255,180,0,${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.42, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.font = `${Math.round(T * 0.38)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💣', cx, cy);
        ctx.font = 'bold 7px monospace'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffcc00'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
        ctx.fillText('PICK UP', cx, cy + 20);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // ── Bomb sites ──
    if (state.gameMode === 'bomb' && obj.sites) {
      obj.sites.forEach((site, i) => {
        if (site.defused) return;
        const cx = site.x * T + T / 2;
        const cy = site.y * T + T / 2;
        const pulse = Math.sin(this.animFrame * 0.12 + i) * 0.5 + 0.5;
        ctx.save();
        if (site.planted) {
          // Planted: red pulsing ring
          ctx.fillStyle   = `rgba(255,50,50,${0.2 + pulse * 0.3})`;
          ctx.strokeStyle = `rgba(255,50,50,${0.6 + pulse * 0.4})`;
          ctx.lineWidth   = 3;
          ctx.beginPath(); ctx.arc(cx, cy, T * 0.44, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          // Bomb icon
          ctx.font = `${Math.round(T * 0.4)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff'; ctx.fillText('💣', cx, cy);
          // Timer
          ctx.font = 'bold 8px monospace'; ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = '#ff4444';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
          ctx.fillText(`BOOM IN ${obj.bombTimer}`, cx, cy + 22);
          ctx.shadowBlur = 0;
        } else {
          // Unplanted: yellow site marker
          ctx.fillStyle   = 'rgba(255,220,0,0.15)';
          ctx.strokeStyle = `rgba(255,220,0,${0.5 + pulse * 0.3})`;
          ctx.lineWidth   = 2;
          ctx.fillRect(site.x * T + 3, site.y * T + 3, T - 6, T - 6);
          ctx.strokeRect(site.x * T + 3, site.y * T + 3, T - 6, T - 6);
          ctx.fillStyle = '#ffdd00'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
          ctx.fillText(`SITE ${String.fromCharCode(65 + i)}`, cx, cy + 4);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      });
    }

    // ── VIP crown overlay & extraction point ──
    if (state.gameMode === 'vip') {
      // Extraction point
      const ex = obj.extractX, ey = obj.extractY;
      if (this._inBoundsR(ex, ey)) {
        const pulse = Math.sin(this.animFrame * 0.1) * 0.4 + 0.6;
        ctx.save();
        ctx.fillStyle   = `rgba(58,158,255,${0.15 + pulse * 0.1})`;
        ctx.strokeStyle = `rgba(58,158,255,${pulse})`;
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(ex * T + 2, ey * T + 2, T - 4, T - 4);
        ctx.strokeRect(ex * T + 2, ey * T + 2, T - 4, T - 4);
        ctx.setLineDash([]);
        ctx.fillStyle = '#3a9eff'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
        ctx.fillText('EXTRACT', ex * T + T / 2, ey * T + T / 2 + 4);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      // Crown on VIP unit
      if (obj.vipId) {
        const vip = state.getUnit(obj.vipId);
        if (vip && vip.alive && vip.x >= 0) {
          const cx = vip.x * T + T / 2;
          const cy = vip.y * T;
          ctx.save();
          ctx.font = '13px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
          ctx.fillText('👑', cx, cy + 2);
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
    }
  }

  _inBoundsR(x, y) { return x >= 0 && y >= 0 && x < CFG.COLS && y < CFG.ROWS; }

  // ─── Coordinate helpers ───────────────────────────────────
  screenToGrid(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const cx = (sx - rect.left) * scaleX;
    const cy = (sy - rect.top)  * scaleY;
    return {
      x: Math.floor(cx / this.T),
      y: Math.floor(cy / this.T),
    };
  }
}
