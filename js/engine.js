// ============================================================
//  ROGUE WARRIORS DIGITAL — ENGINE
// ============================================================

class Engine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board      = [];
    this.buildings  = [];
    this.coverObjs  = [];
    this.units      = [];
    this.players    = [
      { name: TEAM_NAMES[0], team: 0, squadDef: [] },
      { name: TEAM_NAMES[1], team: 1, squadDef: [] },
    ];
    this.theme      = 'urban';
    this.phase      = 'setup';
    this.turn       = 1;
    this.currentPlayer = 0;
    this.activeUnit    = null;
    this.actionsLeft   = MAX_ACTIONS;
    this.hasMoved      = false;
    this.hasSprinted   = false;
    this.isAiming      = false;
    this.activatedThisRound = new Set();
    this.log           = [];
    this.winner        = null;
    this.mode          = 'ai';
    this.gameMode      = 'elimination'; // elimination | ctf | bomb | vip
    this.objectives    = {};  // mode-specific state
    this.abilityUsed   = new Set();
    this.revivedUnits  = new Set();
    this.overwatchUnits = new Set();
    this._uidCounter   = 0;
  }

  // ─── Board generation ─────────────────────────────────────
  generateBoard(theme = 'urban', density = 'medium') {
    this.theme = theme;
    const { COLS, ROWS } = CFG;
    this.board     = [];
    this.buildings = [];
    this.coverObjs = [];

    // Init all tiles as open
    for (let r = 0; r < ROWS; r++) {
      this.board[r] = [];
      for (let c = 0; c < COLS; c++) {
        this.board[r][c] = { type: TILE.OPEN, buildingId: -1, coverId: -1 };
      }
    }

    const densityMap = { light: [3,4], medium: [5,7], heavy: [8,11] };
    const [minB, maxB] = densityMap[density] || densityMap.medium;
    const numBuildings = minB + Math.floor(Math.random() * (maxB - minB + 1));

    // Place buildings — keep deployment zones (cols 0-2 and COLS-3–COLS-1) clear
    for (let b = 0; b < numBuildings * 3; b++) {
      if (this.buildings.length >= numBuildings) break;
      const w = 2 + Math.floor(Math.random() * 3);
      const h = 2 + Math.floor(Math.random() * 3);
      const x = 3 + Math.floor(Math.random() * (COLS - 6 - w));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2 - h));
      if (this._canPlace(x, y, w, h, 1)) {
        const id = this.buildings.length;
        this.buildings.push({ id, x, y, w, h });
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            this.board[y + dy][x + dx] = { type: TILE.BUILDING, buildingId: id, coverId: -1 };
          }
        }
      }
    }

    // Place cover objects (sandbags, crates, barriers)
    const numCover = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numCover * 4; i++) {
      if (this.coverObjs.length >= numCover) break;
      const x = 1 + Math.floor(Math.random() * (COLS - 2));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2));
      const tileTypes = ['sandbag', 'crate', 'barrier', 'wall'];
      const type = tileTypes[Math.floor(Math.random() * tileTypes.length)];
      if (this.board[y][x].type === TILE.OPEN) {
        const id = this.coverObjs.length;
        this.coverObjs.push({ id, x, y, type });
        this.board[y][x] = { type: TILE.COVER, buildingId: -1, coverId: id };
      }
    }

    // Place rubble near buildings occasionally
    if (theme === 'urban') {
      for (const bld of this.buildings) {
        if (Math.random() < 0.5) {
          const rx = bld.x + bld.w + (Math.random() < 0.5 ? 0 : 1);
          const ry = bld.y + Math.floor(bld.h / 2);
          if (this._inBounds(rx, ry) && this.board[ry][rx].type === TILE.OPEN) {
            this.board[ry][rx] = { type: TILE.RUBBLE, buildingId: -1, coverId: -1 };
          }
        }
      }
    }
  }

  _canPlace(x, y, w, h, margin) {
    const { COLS, ROWS } = CFG;
    if (x - margin < 0 || y - margin < 0 || x + w + margin > COLS || y + h + margin > ROWS) return false;
    for (let dy = -margin; dy < h + margin; dy++) {
      for (let dx = -margin; dx < w + margin; dx++) {
        const cx = x + dx, cy = y + dy;
        if (this._inBounds(cx, cy) && this.board[cy][cx].type !== TILE.OPEN) return false;
      }
    }
    return true;
  }

  _inBounds(x, y) {
    return x >= 0 && y >= 0 && x < CFG.COLS && y < CFG.ROWS;
  }

  // ─── Unit creation ────────────────────────────────────────
  createUnit(type, team, x, y) {
    const def = UNIT_DEFS[type];
    if (!def) throw new Error('Unknown unit type: ' + type);
    const id = 'u' + (++this._uidCounter);
    return {
      id, type, team,
      name: def.name,
      x, y,
      hp: def.hp, maxHp: def.hp,
      move: def.move,
      skill: def.skill,
      range: def.range,
      dice: def.dice,
      defense: def.defense,
      ability: def.ability,
      // state
      alive: true,
      suppressed: false,
      inCover: false,
      aiming: false,
    };
  }

  // ─── Deployment ───────────────────────────────────────────
  // Stage 1: create all units as "unplaced" and enter deploy phase
  startDeploy() {
    this.units = [];
    this.phase = 'deploy';
    this.deployingTeam = 0;          // which team is currently placing

    // Create all units with x=-1,y=-1 (not yet on board)
    [0, 1].forEach(team => {
      this.players[team].squadDef.forEach((type, i) => {
        this.units.push({ ...this.createUnit(type, team, -1, -1), deployed: false });
      });
    });

    this.addLog(`⚔ Deploy Phase — ${this.players[0].name}: place your units in the blue zone`, 'system');
  }

  // Valid deployment tiles for a team
  deployZone(team) {
    const { COLS, ROWS } = CFG;
    const tiles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const inZone = team === 0 ? c <= 3 : c >= COLS - 4;
        if (!inZone) continue;
        if (this.board[r][c].type === TILE.BUILDING) continue;
        if (this.getUnitAt(c, r)) continue;
        tiles.push({ x: c, y: r });
      }
    }
    return tiles;
  }

  // Place a single unit during deployment
  placeUnit(unit, x, y) {
    if (!this._inBounds(x, y)) return false;
    if (this.board[y][x].type === TILE.BUILDING) return false;
    if (this.getUnitAt(x, y)) return false;
    const inZone = unit.team === 0 ? x <= 3 : x >= CFG.COLS - 4;
    if (!inZone) return false;

    unit.x        = x;
    unit.y        = y;
    unit.deployed = true;
    this.addLog(`${unit.name} placed at (${x},${y})`, 'move');
    return true;
  }

  unplaceUnit(unit) {
    unit.x        = -1;
    unit.y        = -1;
    unit.deployed = false;
  }

  // All units for current deploying team have been placed — advance
  finishTeamDeploy() {
    if (this.deployingTeam === 0) {
      this.deployingTeam = 1;
      this.addLog(`⚔ ${this.players[1].name}: place your units in the red zone`, 'system');
    } else {
      this._beginBattle();
    }
  }

  // Auto-place remaining units for a team (used by AI)
  // Spreads units across the full zone height rather than stacking at top
  autoDeployTeam(team) {
    const unplaced = this.units.filter(u => u.team === team && !u.deployed);
    if (!unplaced.length) return;

    const { COLS, ROWS } = CFG;
    const colStart = team === 0 ? 0 : COLS - 4;
    const colEnd   = team === 0 ? 3 : COLS - 1;

    // Build a grid of valid tiles spread evenly across rows
    const validTiles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        if (this.board[r][c].type === TILE.BUILDING) continue;
        validTiles.push({ x: c, y: r });
      }
    }

    // Shuffle so placement isn't always top corner
    for (let i = validTiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
    }

    // Spread across different rows: sort chosen tiles by row after picking
    // Pick one tile per unit, preferring spread-out rows
    const rowsUsed = new Set();
    const picked   = [];
    // First pass: try to get one unit per row
    for (const tile of validTiles) {
      if (picked.length >= unplaced.length) break;
      if (!rowsUsed.has(tile.y) && !this.getUnitAt(tile.x, tile.y)) {
        picked.push(tile);
        rowsUsed.add(tile.y);
      }
    }
    // Second pass: fill remaining from any free tile
    for (const tile of validTiles) {
      if (picked.length >= unplaced.length) break;
      if (!picked.some(p => p.x === tile.x && p.y === tile.y) && !this.getUnitAt(tile.x, tile.y)) {
        picked.push(tile);
      }
    }

    unplaced.forEach((u, i) => {
      if (i < picked.length) this.placeUnit(u, picked[i].x, picked[i].y);
    });
  }

  _beginBattle() {
    this.phase           = 'playing';
    this.turn            = 1;
    this.currentPlayer   = 0;
    this.activatedThisRound = new Set();
    this.activeUnit      = null;
    // Initialise game-mode objectives
    this.initObjectives();
    if (this.gameMode === 'vip') this.designateVIP();
    this.addLog(`═══ Round 1 begins — ${this.players[0].name} activates first ═══`, 'system');
  }

  // Legacy auto-deploy (kept for any internal use)
  deployUnits() {
    this.startDeploy();
    this.autoDeployTeam(0);
    this.autoDeployTeam(1);
    this._beginBattle();
  }

  // ─── Movement ─────────────────────────────────────────────
  getMovementRange(unit, isSprint = false) {
    const dist = isSprint ? unit.move * 2 : unit.move;
    const reachable = [];
    const visited = {};
    const queue = [{ x: unit.x, y: unit.y, steps: 0 }];
    visited[`${unit.x},${unit.y}`] = true;

    while (queue.length) {
      const { x, y, steps } = queue.shift();
      if (steps > 0) reachable.push({ x, y });
      if (steps >= dist) continue;

      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        const key = `${nx},${ny}`;
        if (!this._inBounds(nx, ny)) continue;
        if (visited[key]) continue;
        const tile = this.board[ny][nx];
        if (tile.type === TILE.BUILDING) continue;
        if (this.getUnitAt(nx, ny)) continue;
        visited[key] = true;
        queue.push({ x: nx, y: ny, steps: steps + 1 });
      }
    }
    return reachable;
  }

  moveUnit(unit, x, y) {
    const tile = this.board[y][x];
    unit.x = x;
    unit.y = y;
    unit.inCover = (tile.type === TILE.COVER || tile.type === TILE.RUBBLE);
    unit.suppressed = false;
    this.addLog(`${unit.name} (${this.players[unit.team].name}) moves to (${x},${y})`, 'move');
    // Move flag with carrier
    if (this.gameMode === 'ctf') {
      this.updateFlagPosition(unit);
      this.tryScoreFlag(unit);
    }
  }

  // ─── Line of Sight ────────────────────────────────────────
  hasLOS(ax, ay, bx, by) {
    // Bresenham ray cast — blocked by buildings
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
    if (steps === 0) return true;
    for (let i = 1; i < steps; i++) {
      const t  = i / steps;
      const cx = Math.round(ax + (bx - ax) * t);
      const cy = Math.round(ay + (by - ay) * t);
      if (!this._inBounds(cx, cy)) return false;
      if (cx === bx && cy === by) continue;  // don't block on target tile
      if (this.board[cy][cx].type === TILE.BUILDING) return false;
    }
    return true;
  }

  // ─── Combat ───────────────────────────────────────────────
  getValidTargets(attacker) {
    const alive = this.units.filter(u => u.alive && u.team !== attacker.team);
    return alive.filter(t => {
      const dist = this._dist(attacker, t);
      if (dist > attacker.range) return false;
      return this.hasLOS(attacker.x, attacker.y, t.x, t.y);
    });
  }

  _dist(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // Chebyshev
  }

  resolveShoot(attacker, target, extraHitBonus = 0) {
    const dist = this._dist(attacker, target);
    let targetNum = attacker.skill;

    // Range penalty
    const shortRange = Math.floor(attacker.range / 3);
    const longRange  = Math.floor(attacker.range * 2 / 3);
    if (dist > longRange)       targetNum += 2;
    else if (dist > shortRange) targetNum += 1;

    // Cover bonus to defender
    let coverBonus = 0;
    if (target.inCover)   coverBonus += 1;
    const tile = this.board[target.y][target.x];
    if (tile.type === TILE.COVER || tile.type === TILE.RUBBLE) coverBonus += 1;

    // Suppression penalty
    if (attacker.suppressed) targetNum += 1;

    // Aiming bonus
    if (attacker.aiming || extraHitBonus) targetNum -= (extraHitBonus || 1);
    targetNum = Math.max(2, Math.min(6, targetNum));

    // Command Aura: check if friendly leader nearby
    const hasLeaderAura = this.units.some(u =>
      u.alive && u.team === attacker.team && u.ability === 'command' &&
      u.id !== attacker.id && this._dist(attacker, u) <= 3
    );

    // Roll attack dice
    const rolls = [];
    for (let i = 0; i < attacker.dice; i++) {
      rolls.push(this.rollD6());
    }

    // Leader reroll one failed die
    let hitCount = rolls.filter(r => r >= targetNum).length;
    let finalRolls = [...rolls];
    let rerolled = null;
    if (hasLeaderAura && hitCount < rolls.length) {
      // Reroll one failed die
      const failIdx = finalRolls.findIndex(r => r < targetNum);
      const newRoll = this.rollD6();
      rerolled = { idx: failIdx, from: finalRolls[failIdx], to: newRoll };
      finalRolls[failIdx] = newRoll;
      hitCount = finalRolls.filter(r => r >= targetNum).length;
    }

    // Each hit: target makes defense save
    const saves = [];
    let wounds = 0;
    for (let h = 0; h < hitCount; h++) {
      const save = this.rollD6();
      saves.push(save);
      const saveTarget = target.defense - coverBonus;
      if (save < saveTarget) {
        wounds++;
        // Stealth rule: if scout in cover, enemy needs 6 to hit
        if (target.ability === 'stealth' && target.inCover) {
          if (save < 6) { wounds--; } // cancel wound unless 6
        }
      } else {
        // Saved: unit may be suppressed
        if (Math.random() < 0.3) target.suppressed = true;
      }
    }

    const result = {
      attacker: attacker.id, target: target.id,
      rolls: finalRolls, originalRolls: rolls,
      targetNum, hitCount,
      coverBonus, saves, wounds,
      rerolled, hasLeaderAura,
    };

    if (wounds > 0) {
      target.hp -= wounds;
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
        this.addLog(`💀 ${target.name} is eliminated!`, 'death');
        // Drop flag if carrier was killed
        if (this.gameMode === 'ctf') this.dropFlag(target.id);
        this.checkObjectiveWin();
      } else {
        target.suppressed = true;
        this.addLog(`${target.name} is hit and suppressed!`, 'hit');
      }
    } else {
      if (hitCount > 0) {
        this.addLog(`${target.name} saves the hit!`, 'miss');
      } else {
        this.addLog(`${attacker.name} misses!`, 'miss');
      }
    }

    attacker.aiming = false;
    return result;
  }

  resolveBlast(attacker, cx, cy) {
    // Grenadier blast: hits target + adjacent tiles
    const affected = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx, ty = cy + dy;
        const target = this.getUnitAt(tx, ty);
        if (target && target.alive && target.team !== attacker.team) {
          affected.push(target);
        }
      }
    }
    const results = affected.map(t => this.resolveShoot(attacker, t, 1));
    this.addLog(`💥 ${attacker.name} throws grenade at (${cx},${cy}) — ${affected.length} caught in blast!`, 'ability');
    return results;
  }

  resolveMelee(attacker, target) {
    const aRoll = this.rollD6() + (attacker.ability === 'command' ? 1 : 0);
    const dRoll = this.rollD6();
    this.addLog(`⚔️ ${attacker.name} charges ${target.name}! [${aRoll} vs ${dRoll}]`, 'melee');
    if (aRoll > dRoll) {
      target.alive = false;
      target.hp = 0;
      this.addLog(`💀 ${target.name} is taken down in melee!`, 'death');
      return { winner: attacker, aRoll, dRoll };
    } else if (dRoll > aRoll) {
      attacker.suppressed = true;
      this.addLog(`${attacker.name} is repelled and suppressed!`, 'hit');
      return { winner: target, aRoll, dRoll };
    } else {
      attacker.suppressed = true;
      target.suppressed = true;
      this.addLog(`Melee tied — both units suppressed!`, 'miss');
      return { winner: null, aRoll, dRoll };
    }
  }

  // Medic ability
  tryHeal(medic, targetUnit) {
    if (this.revivedUnits.has(medic.id)) {
      this.addLog(`${medic.name} has already used their heal!`, 'system');
      return false;
    }
    if (this._dist(medic, targetUnit) > 1) {
      this.addLog(`Target too far to heal!`, 'system');
      return false;
    }
    if (targetUnit.alive) {
      // Remove suppression
      targetUnit.suppressed = false;
      this.addLog(`💉 ${medic.name} patches up ${targetUnit.name}!`, 'ability');
    } else {
      // Revive with 1hp if adjacent
      targetUnit.alive = true;
      targetUnit.hp = 1;
      this.addLog(`💉 ${medic.name} revives ${targetUnit.name}!`, 'ability');
    }
    this.revivedUnits.add(medic.id);
    return true;
  }

  setOverwatch(sniper) {
    this.overwatchUnits.add(sniper.id);
    this.addLog(`🔭 ${sniper.name} sets up Overwatch!`, 'ability');
  }

  // ─── Turn management ──────────────────────────────────────
  activateUnit(unit) {
    if (unit.team !== this.currentPlayer) return false;
    if (this.activatedThisRound.has(unit.id)) return false;
    if (!unit.alive) return false;
    this.activeUnit   = unit.id;
    this.actionsLeft  = MAX_ACTIONS;
    this.hasMoved     = false;
    this.hasSprinted  = false;
    this.isAiming     = false;
    unit.aiming       = false;
    this.addLog(`— ${unit.name} activated (${MAX_ACTIONS} actions)`, 'activate');
    return true;
  }

  useAction(cost = 1) {
    this.actionsLeft -= cost;
    if (this.actionsLeft <= 0) this.endActivation();
  }

  endActivation() {
    if (!this.activeUnit) return;
    const unit = this.getUnit(this.activeUnit);
    if (unit) this.activatedThisRound.add(unit.id);
    this.activeUnit  = null;
    this.actionsLeft = 0;
    this.isAiming    = false;

    // Check win before swapping
    const winner = this.checkWin();
    if (winner !== null) {
      this.phase  = 'gameover';
      this.winner = winner;
      this.addLog(`🏆 ${this.players[winner].name} wins!`, 'system');
      return;
    }

    // Switch player
    this.currentPlayer = 1 - this.currentPlayer;

    // Check if current player still has units to activate
    const canActivate = this.units.some(u =>
      u.alive && u.team === this.currentPlayer && !this.activatedThisRound.has(u.id)
    );
    if (!canActivate) {
      // Other player also done?
      const otherCanActivate = this.units.some(u =>
        u.alive && u.team === (1 - this.currentPlayer) && !this.activatedThisRound.has(u.id)
      );
      if (otherCanActivate) {
        this.currentPlayer = 1 - this.currentPlayer;
      } else {
        // New round
        this.newRound();
        return;
      }
    }
    this.addLog(`${this.players[this.currentPlayer].name}'s turn`, 'system');
  }

  newRound() {
    this.turn++;
    this.activatedThisRound = new Set();
    this.overwatchUnits     = new Set();
    // Clear per-round states
    this.units.forEach(u => {
      if (u.alive) {
        u.suppressed = false;
        u.aiming     = false;
      }
    });
    this.currentPlayer = 0;
    this.addLog(`═══ Round ${this.turn} begins ═══`, 'system');
  }

  // ─── Deselect/deactivate without consuming the activation ─
  deactivateUnit() {
    this.activeUnit  = null;
    this.actionsLeft = MAX_ACTIONS;
    this.hasMoved    = false;
    this.hasSprinted = false;
    this.isAiming    = false;
  }

  // ─── Objective initialisation ──────────────────────────────
  initObjectives() {
    const { COLS, ROWS } = CFG;
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);

    if (this.gameMode === 'ctf') {
      // Place flag at centre (find nearest open tile)
      const flagPos = this._nearestOpen(cx, cy);
      this.objectives = {
        flag: { x: flagPos.x, y: flagPos.y, carriedBy: null, capturedBy: null },
      };
      this.addLog('🚩 Capture the Flag — grab the flag at centre and return it to your base!', 'system');

    } else if (this.gameMode === 'bomb') {
      // Two bomb sites, roughly 1/3 and 2/3 across
      const site1 = this._nearestOpen(Math.floor(COLS * 0.35), Math.floor(ROWS * 0.3));
      const site2 = this._nearestOpen(Math.floor(COLS * 0.65), Math.floor(ROWS * 0.7));
      this.objectives = {
        sites: [
          { id: 0, x: site1.x, y: site1.y, planted: false, defused: false, plantedBy: null, timer: 0 },
          { id: 1, x: site2.x, y: site2.y, planted: false, defused: false, plantedBy: null, timer: 0 },
        ],
        bombPlanted: false,
        bombTimer: 0,
        maxTimer: 8,  // rounds until explosion
        activeSite: null,
      };
      this.addLog('💣 Plant the Bomb — Attackers plant at a site. Defenders have 8 rounds to defuse!', 'system');

    } else if (this.gameMode === 'vip') {
      // VIP is designated during _beginBattle once units exist
      this.objectives = { vipId: null, extractX: CFG.COLS - 2, extractY: Math.floor(ROWS / 2) };
      this.addLog('👑 VIP Escort — Alpha must get the VIP to the extraction point. Bravo must eliminate them!', 'system');
    }
  }

  _nearestOpen(cx, cy) {
    for (let r = 0; r <= Math.max(CFG.COLS, CFG.ROWS); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (this._inBounds(x, y) && this.board[y][x].type !== TILE.BUILDING) {
            return { x, y };
          }
        }
      }
    }
    return { x: cx, y: cy };
  }

  // ─── Objective actions ─────────────────────────────────────

  // CTF: unit picks up or captures flag
  tryPickupFlag(unit) {
    const obj = this.objectives;
    if (!obj.flag) return false;
    const f = obj.flag;
    if (f.capturedBy !== null) return false;
    if (f.carriedBy !== null) return false; // already carried
    if (unit.x !== f.x || unit.y !== f.y) return false;
    f.carriedBy = unit.id;
    this.addLog(`🚩 ${unit.name} picks up the flag!`, 'ability');
    return true;
  }

  tryScoreFlag(unit) {
    const obj = this.objectives;
    if (!obj.flag || obj.flag.carriedBy !== unit.id) return false;
    const inBase = unit.team === 0 ? unit.x <= 3 : unit.x >= CFG.COLS - 4;
    if (!inBase) return false;
    obj.flag.capturedBy = unit.team;
    obj.flag.carriedBy  = null;
    this.addLog(`🚩 ${this.players[unit.team].name} captures the flag! GAME OVER!`, 'system');
    this.phase  = 'gameover';
    this.winner = unit.team;
    return true;
  }

  // Drop flag when carrier is killed
  dropFlag(unitId) {
    const obj = this.objectives;
    if (!obj.flag || obj.flag.carriedBy !== unitId) return;
    const carrier = this.getUnit(unitId);
    if (carrier) { obj.flag.x = carrier.x; obj.flag.y = carrier.y; }
    obj.flag.carriedBy = null;
    this.addLog(`🚩 The flag was dropped!`, 'system');
  }

  // Move flag with carrier each time carrier moves
  updateFlagPosition(unit) {
    const obj = this.objectives;
    if (!obj.flag || obj.flag.carriedBy !== unit.id) return;
    obj.flag.x = unit.x;
    obj.flag.y = unit.y;
  }

  // Bomb: plant
  tryPlantBomb(unit) {
    const obj = this.objectives;
    if (!obj.sites || unit.team !== 0) return false; // only attackers plant
    if (obj.bombPlanted) return false;
    const site = obj.sites.find(s => s.x === unit.x && s.y === unit.y && !s.planted);
    if (!site) return false;
    site.planted   = true;
    site.plantedBy = unit.id;
    obj.bombPlanted = true;
    obj.activeSite  = site.id;
    obj.bombTimer   = obj.maxTimer;
    this.addLog(`💣 ${unit.name} plants the bomb at Site ${site.id + 1}! Defenders have ${obj.maxTimer} rounds!`, 'ability');
    return true;
  }

  // Bomb: defuse
  tryDefuseBomb(unit) {
    const obj = this.objectives;
    if (!obj.sites || unit.team !== 1) return false; // only defenders defuse
    if (!obj.bombPlanted) return false;
    const site = obj.sites.find(s => s.id === obj.activeSite);
    if (!site || site.defused) return false;
    if (unit.x !== site.x || unit.y !== site.y) return false;
    site.defused    = true;
    obj.bombPlanted = false;
    this.addLog(`💣 ${unit.name} defuses the bomb! Defenders win!`, 'system');
    this.phase  = 'gameover';
    this.winner = 1;
    return true;
  }

  // Called at end of each round to tick bomb timer
  tickBombTimer() {
    const obj = this.objectives;
    if (!obj.sites || !obj.bombPlanted) return;
    obj.bombTimer--;
    this.addLog(`💣 Bomb detonates in ${obj.bombTimer} round${obj.bombTimer !== 1 ? 's' : ''}!`, 'system');
    if (obj.bombTimer <= 0) {
      this.addLog(`💥 BOOM! The bomb explodes! Attackers win!`, 'system');
      this.phase  = 'gameover';
      this.winner = 0;
    }
  }

  // VIP: designate after deploy
  designateVIP() {
    const team0 = this.units.filter(u => u.team === 0 && u.alive);
    // Prefer leader, otherwise first unit
    const vip = team0.find(u => u.ability === 'command') || team0[0];
    if (!vip) return;
    vip.isVIP = true;
    vip.hp    = 2;
    vip.maxHp = 2;
    this.objectives.vipId = vip.id;
    this.addLog(`👑 ${vip.name} is the VIP — protect them!`, 'system');
  }

  checkObjectiveWin() {
    if (this.phase === 'gameover') return;
    // checkWin() is the authority — just call it and apply result
    const winner = this.checkWin();
    if (winner !== null) {
      this.phase  = 'gameover';
      this.winner = winner;
      const modeLabels = {
        vip: winner === 1 ? '👑 The VIP has been eliminated! Bravo wins!' : '👑 All enemies eliminated — Alpha wins!',
      };
      const msg = modeLabels[this.gameMode] || `🏆 ${this.players[winner].name} wins!`;
      this.addLog(msg, 'system');
    }
  }

  checkWin() {
    // Universal rule: wipe out the enemy squad = instant win in ALL modes
    const p0alive = this.units.some(u => u.alive && u.team === 0);
    const p1alive = this.units.some(u => u.alive && u.team === 1);
    if (!p0alive) return 1;
    if (!p1alive) return 0;

    // VIP mode: Bravo also wins if they kill the VIP (even while others live)
    if (this.gameMode === 'vip' && this.objectives?.vipId) {
      const vip = this.getUnit(this.objectives.vipId);
      if (vip && !vip.alive) return 1;
    }

    return null;
  }

  newRound() {
    this.turn++;
    this.activatedThisRound = new Set();
    this.overwatchUnits     = new Set();
    this.units.forEach(u => {
      if (u.alive) { u.suppressed = false; u.aiming = false; }
    });
    this.currentPlayer = 0;
    this.addLog(`═══ Round ${this.turn} begins ═══`, 'system');
    if (this.gameMode === 'bomb') this.tickBombTimer();
  }

  // ─── Utilities ────────────────────────────────────────────
  getUnit(id) { return this.units.find(u => u.id === id) || null; }

  getActiveUnit() { return this.activeUnit ? this.getUnit(this.activeUnit) : null; }

  getUnitAt(x, y) { return this.units.find(u => u.alive && u.x === x && u.y === y) || null; }

  rollD6() { return 1 + Math.floor(Math.random() * 6); }

  addLog(text, type = 'info') {
    this.log.push({ text, type, turn: this.turn, time: Date.now() });
    if (this.log.length > 80) this.log.shift();
  }

  // Serialise state for multiplayer sync
  serialize() {
    return JSON.stringify({
      board: this.board, buildings: this.buildings, coverObjs: this.coverObjs,
      units: this.units, players: this.players,
      theme: this.theme, phase: this.phase, turn: this.turn,
      currentPlayer: this.currentPlayer, activeUnit: this.activeUnit,
      actionsLeft: this.actionsLeft, hasMoved: this.hasMoved,
      hasSprinted: this.hasSprinted, isAiming: this.isAiming,
      activatedThisRound: [...this.activatedThisRound],
      winner: this.winner, log: this.log.slice(-20),
      abilityUsed: [...this.abilityUsed], revivedUnits: [...this.revivedUnits],
      overwatchUnits: [...this.overwatchUnits], _uidCounter: this._uidCounter,
    });
  }

  deserialize(str) {
    const d = JSON.parse(str);
    Object.assign(this, d);
    this.activatedThisRound = new Set(d.activatedThisRound);
    this.abilityUsed        = new Set(d.abilityUsed);
    this.revivedUnits       = new Set(d.revivedUnits);
    this.overwatchUnits     = new Set(d.overwatchUnits);
  }
}
