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
    this.deployHighlights = []; // [{x,y}] valid drop tiles during deploy
    this.hoverTile        = null;
    this.selectedUnit     = null;
    this.lastResult       = null; // last combat result for flash
    this.flashUnit        = null;
    this.flashTimer       = 0;
    this.healTargets      = [];
    this.animFrame        = 0;

    // Resize canvas to match grid
    this.canvas.width  = CFG.COLS * this.T;
    this.canvas.height = CFG.ROWS * this.T;
  }

  // ─── Main draw ────────────────────────────────────────────
  draw(state) {
    this.animFrame++;
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
    if (this.moveHighlights.length) this._drawMoveRange();

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

    // Draw units
    state.units.forEach(u => {
      if (u.alive) this._drawUnit(state, u);
    });

    // Draw dead units (tombstones)
    state.units.forEach(u => {
      if (!u.alive) this._drawTombstone(state, u);
    });

    // Draw hover
    if (this.hoverTile) this._drawHover();

    // Deployment column markers
    this._drawDeployMarkers(state);

    // Flash effect for recent combat
    if (this.flashUnit) this._drawFlash(state);
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
    const cx   = unit.x * T + T / 2;
    const cy   = unit.y * T + T / 2;
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

    // Suppression indicator ring
    if (unit.suppressed) {
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
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

  triggerFlash(unitId) {
    this.flashUnit  = unitId;
    this.flashTimer = 30;
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
