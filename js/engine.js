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
    this.actionTakenThisActivation = false;
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
    const weaponKey = def.weapon || 'assaultRifle';
    const weaponDef = WEAPON_DEFS[weaponKey] || WEAPON_DEFS.assaultRifle;
    // LMG drawback: -1 MA
    const effectiveMA = (weaponDef.drawback === 'minusOneMA') ? (def.ma - 1) : def.ma;
    return {
      id, type, team,
      name: def.name,
      x, y,
      hp: def.hp, maxHp: def.hp,
      // Rogue Warriors stats
      ma: effectiveMA,        // Movement Allowance in tiles
      weapon: weaponKey,      // primary weapon key into WEAPON_DEFS
      sidearm: def.sidearm || null,  // sidearm used for Shoot when primary is grenade
      ability: def.ability,
      // combat state flags
      alive:        true,
      pinned:       false,    // Pinned: cannot move next activation (Armour Save 3-4 result)
      inCover:      false,    // Light Cover: -1 to incoming attack rolls
      inHeavyCover: false,    // Heavy Cover: -2 to incoming attack rolls
      aiming:       false,    // Aim action used: +1 to next shooting roll
      weaponJammed: false,    // Assault Rifle jam: must spend Shoot action to clear
      needsReload:  false,    // Sniper Rifle: must reload after firing
      hasRun:       false,    // Ran this activation (cannot shoot)
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
  getMovementRange(unit, isRun = false) {
    if (unit.pinned) return [];
    const dist = isRun ? unit._runBonus || 3 : unit.ma;
    const reachable = [];
    const visited = {};
    // Use fractional steps so water costs 2 movement per tile (half MA)
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
        // Water costs 2 movement tiles (rounded up) — half MA per rulebook
        const tileCost = tile.type === TILE.WATER ? 2 : 1;
        if (steps + tileCost > dist) continue;
        visited[key] = true;
        queue.push({ x: nx, y: ny, steps: steps + tileCost });
      }
    }
    return reachable;
  }

  // Return the shortest walkable tile path from unit's current position to (toX,toY).
  // Uses the same BFS rules as getMovementRange (no buildings, no occupied tiles)
  // but with unlimited range and parent-pointer tracking so the path can be
  // reconstructed.  Returns an array of {x,y} from the step AFTER the origin
  // up to and including the destination, e.g. [{x:1,y:0},{x:2,y:0}].
  // Returns [] if no path exists (shouldn't happen in normal play).
  getPath(unit, toX, toY) {
    const start = `${unit.x},${unit.y}`;
    const goal  = `${toX},${toY}`;
    if (start === goal) return [];

    const parent  = { [start]: null };
    const queue   = [{ x: unit.x, y: unit.y }];

    while (queue.length) {
      const { x, y } = queue.shift();
      const key = `${x},${y}`;
      if (key === goal) {
        // Reconstruct path (excluding the start tile)
        const path = [];
        let cur = key;
        while (cur && cur !== start) {
          const [px, py] = cur.split(',').map(Number);
          path.unshift({ x: px, y: py });
          cur = parent[cur];
        }
        return path;
      }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        const nk = `${nx},${ny}`;
        if (!this._inBounds(nx, ny)) continue;
        if (nk in parent) continue;
        if (this.board[ny][nx].type === TILE.BUILDING) continue;
        // Allow the destination tile even if occupied (unit will vacate it)
        if (this.getUnitAt(nx, ny) && nk !== goal) continue;
        parent[nk] = key;
        queue.push({ x: nx, y: ny });
      }
    }
    return []; // unreachable
  }

  moveUnit(unit, x, y) {
    const tile = this.board[y][x];
    unit.x = x;
    unit.y = y;
    // Cover status from tile: Cover/Rubble = Light Cover; not auto Heavy Cover (needs Take Cover action)
    unit.inCover      = (tile.type === TILE.COVER || tile.type === TILE.RUBBLE);
    unit.inHeavyCover = false; // heavy cover only via Take Cover action
    unit.pinned       = false; // moving clears any queued pinned display (pin already took effect)
    this.addLog(`${unit.name} (${this.players[unit.team].name}) moves to (${x},${y})`, 'move');
    // Move flag with carrier
    if (this.gameMode === 'ctf') {
      this.updateFlagPosition(unit);
      this.tryScoreFlag(unit);
    }
    // VIP extraction: Alpha wins if VIP reaches the extraction tile
    if (this.gameMode === 'vip' && unit.isVIP) {
      const obj = this.objectives;
      if (unit.x === obj.extractX && unit.y === obj.extractY) {
        this.addLog(`👑 ${unit.name} reaches the extraction point! Alpha wins!`, 'system');
        this.phase  = 'gameover';
        this.winner = 0;
      }
    }
    // Bomb carrier move: update bomb position with carrier
    if (this.gameMode === 'bomb' && this.objectives?.bomb?.carriedBy === unit.id) {
      this.objectives.bomb.x = unit.x;
      this.objectives.bomb.y = unit.y;
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

  // ─── D3 helper ────────────────────────────────────────────
  rollD3() { return 1 + Math.floor(Math.random() * 3); }

  // ─── Combat ───────────────────────────────────────────────
  // Rogue Warriors Shooting Attack sequence:
  //  1. All Shooting Attacks hit on 4+
  //  2. Modifiers to the attack roll (effectively shifting the target number):
  //       -1 Light Cover (need 5+)  -2 Heavy Cover (need 6+)
  //       +1 Aim action (need 3+)   +1 within half range (need 3+)
  //       SMG drawback: -1 to attack roll (need 5+ base)
  //  3. For each Hit → Armour Save: roll 1D6 + weapon AP
  //       1-2: 1 Damage (lose 1 Heart)   3-4: Pinned (can't move next activation)   5-6: Saved
  resolveShoot(attacker, target, aimBonus = 0) {
    // Grenadiers fire their pistol sidearm when using the Shoot action
    const shootWeaponKey = (attacker.sidearm && WEAPON_DEFS[attacker.weapon]?.perk === 'aoeSplash')
      ? attacker.sidearm : attacker.weapon;
    const weapon = WEAPON_DEFS[shootWeaponKey] || WEAPON_DEFS.assaultRifle;
    const dist   = this._dist(attacker, target);

    // ── Pre-fire checks ──
    if (attacker.weaponJammed) {
      this.addLog(`🔧 ${attacker.name}'s weapon is JAMMED — spend a Shoot action to clear!`, 'system');
      return this._nullResult(attacker, target);
    }
    if (weapon.drawback === 'mustReload' && attacker.needsReload) {
      this.addLog(`🔄 ${attacker.name} must Reload before firing the Sniper Rifle again!`, 'system');
      return this._nullResult(attacker, target);
    }
    if (weapon.minRange && dist < weapon.minRange) {
      this.addLog(`${attacker.name} is too close for the ${weapon.name} (min range ${weapon.minRange}")!`, 'miss');
      return this._nullResult(attacker, target);
    }

    // ── Calculate hit target number (base 4+) ──
    let hitTarget = 4;

    // Cover: only applies to ranged attacks, not melee
    let coverType = 'none';
    if (target.inHeavyCover) {
      coverType = 'heavy'; hitTarget += 2;  // need 6+
    } else if (target.inCover) {
      coverType = 'light'; hitTarget += 1;  // need 5+
    }

    // Half-range bonus (+1 to roll = −1 to target number)
    const halfRange = Math.floor(weapon.range / 2);
    if (dist <= halfRange) hitTarget -= 1;

    // Aim bonus
    if (attacker.aiming || aimBonus > 0) hitTarget -= (aimBonus || 1);

    // SMG drawback: −1 to Shooting Attacks (effectively +1 to target number)
    if (weapon.drawback === 'minusOneShoot') hitTarget += 1;

    // Stealth: Scout in cover needs natural 6 to hit
    const stealthActive = (target.ability === 'stealth' && target.inCover);
    if (stealthActive) hitTarget = 6;

    hitTarget = Math.max(2, Math.min(6, hitTarget));

    // ── Leader Command Aura: reroll one failed attack die ──
    const hasLeaderAura = this.units.some(u =>
      u.alive && u.team === attacker.team && u.ability === 'command' &&
      u.id !== attacker.id && this._dist(attacker, u) <= 3
    );

    // ── Roll Attack Dice ──
    const rolls = [];
    for (let i = 0; i < weapon.attackDice; i++) rolls.push(this.rollD6());

    let finalRolls = [...rolls];
    let rerolled   = null;
    if (hasLeaderAura) {
      const failIdx = finalRolls.findIndex(r => r < hitTarget);
      if (failIdx >= 0) {
        const newRoll = this.rollD6();
        rerolled = { idx: failIdx, from: finalRolls[failIdx], to: newRoll };
        finalRolls[failIdx] = newRoll;
      }
    }

    // ── Weapon-specific perk/drawback checks on attack rolls ──
    let bonusAP      = 0;
    let weaponJammed = false;

    if (weapon.drawback === 'weaponJam') {
      if (finalRolls.filter(r => r === 1).length >= 3) {
        weaponJammed = true;
        attacker.weaponJammed = true;
        this.addLog(`🔧 ${attacker.name}'s Assault Rifle is JAMMED! Spend a Shoot action to clear.`, 'system');
      }
    }
    if (weapon.perk === 'triSixAP' && finalRolls.filter(r => r === 6).length >= 3) {
      bonusAP = -1;  // −1 AP bonus (hurts target saves more)
      this.addLog(`⚡ ${attacker.name}: Three 6s! −1 bonus Armour Piercing!`, 'ability');
    }

    // LMG auto-pin: any natural 6 on the attack roll auto-pins (target still saves)
    const lmgAutoPinCount = (weapon.perk === 'autoPin')
      ? finalRolls.filter(r => r === 6).length : 0;

    const hitCount = finalRolls.filter(r => r >= hitTarget).length;

    // ── Armour Save for each Hit ──
    // Roll 1D6, apply AP (weapon.ap + bonusAP), then:
    //   1-2 → 1 Damage   3-4 → Pinned   5-6 → Saved
    const effectiveAP  = weapon.ap + bonusAP;
    const armourSaves  = [];
    let wounds = 0;
    let pinned = 0;

    // Sniper perk: auto 1D3 damage if at least one hit (target still saves normally)
    let sniperBonusDmg = 0;
    if (weapon.perk === 'auto1D3Dmg' && hitCount > 0) {
      sniperBonusDmg = this.rollD3();
    }

    for (let h = 0; h < hitCount; h++) {
      const rawSave  = this.rollD6();
      const modSave  = rawSave + effectiveAP;   // AP is negative → lowers the save
      armourSaves.push({ raw: rawSave, modified: modSave });
      if (modSave <= 2)      wounds++;          // 1-2: Damage
      else if (modSave <= 4) pinned++;          // 3-4: Pinned
      // 5-6: Saved — no effect
    }

    wounds += sniperBonusDmg;

    // LMG: each natural 6 also pins (adds to pinned count)
    pinned += lmgAutoPinCount;

    // Frag Grenade dud check: if any attack die rolls a 1, roll 1D6; on 1 = detonates in hand
    if (weapon.drawback === 'dud' && finalRolls.some(r => r === 1)) {
      const dudRoll = this.rollD6();
      if (dudRoll === 1) {
        this.addLog(`💥 GRENADE DETONATES IN HAND! ${attacker.name} is hit!`, 'death');
        attacker.hp = Math.max(0, attacker.hp - 1);
        if (attacker.hp <= 0) { attacker.alive = false; }
        this.checkObjectiveWin();
      } else {
        this.addLog(`Grenade dud check: rolled ${dudRoll} — close call!`, 'system');
      }
    }

    // Shotgun knockback: if any hit → push target 1 tile away
    if (weapon.perk === 'knockback' && hitCount > 0 && target.alive) {
      const dx = Math.sign(target.x - attacker.x);
      const dy = Math.sign(target.y - attacker.y);
      const nx = target.x + dx, ny = target.y + dy;
      if (this._inBounds(nx, ny) && this.board[ny][nx].type !== TILE.BUILDING && !this.getUnitAt(nx, ny)) {
        target.x = nx;
        target.y = ny;
        this.addLog(`💨 ${target.name} is knocked back 1 tile!`, 'hit');
      }
    }

    // ── Apply results ──
    const result = {
      attacker: attacker.id, target: target.id,
      rolls: finalRolls, originalRolls: rolls,
      hitTarget, hitCount, coverType, effectiveAP,
      armourSaves, wounds, pinned, sniperBonusDmg,
      rerolled, hasLeaderAura, weaponJammed,
      weaponName: weapon.name,
    };

    if (wounds > 0 && target.alive) {
      target.hp -= wounds;
      if (target.hp <= 0) {
        target.alive = false; target.hp = 0;
        this.addLog(`💀 ${target.name} is eliminated!`, 'death');
        if (this.gameMode === 'ctf')  this.dropFlag(target.id);
        if (this.gameMode === 'bomb') this.dropBomb(target.id);
        this.checkObjectiveWin();
      } else {
        this.addLog(`${target.name} takes ${wounds} damage!`, 'hit');
      }
    }
    if (pinned > 0 && target.alive) {
      target.pinned = true;
      if (!wounds) this.addLog(`📌 ${target.name} is PINNED — cannot move next activation!`, 'hit');
    }
    if (wounds === 0 && pinned === 0) {
      if (hitCount > 0) this.addLog(`🛡️ ${target.name} saves all hits!`, 'miss');
      else              this.addLog(`${attacker.name} misses!`, 'miss');
    }

    // Mark sniper as needing reload after firing
    if (weapon.drawback === 'mustReload') attacker.needsReload = true;

    attacker.aiming = false;
    return result;
  }

  // Empty result helper for blocked shots
  _nullResult(attacker, target) {
    attacker.aiming = false;
    return {
      attacker: attacker.id, target: target.id,
      rolls: [], hitTarget: 4, hitCount: 0,
      armourSaves: [], wounds: 0, pinned: 0, coverType: 'none',
      effectiveAP: 0, weaponName: '', rerolled: null,
    };
  }

  // Reload a jammed or sniper weapon (costs 1 Shoot action)
  reloadWeapon(unit) {
    if (unit.weaponJammed) {
      unit.weaponJammed = false;
      this.addLog(`🔧 ${unit.name} clears the jam — weapon ready!`, 'ability');
      return true;
    }
    if (unit.needsReload) {
      unit.needsReload = false;
      this.addLog(`🔄 ${unit.name} reloads the Sniper Rifle — ready to fire!`, 'ability');
      return true;
    }
    return false;
  }

  getValidTargets(attacker) {
    // Grenadiers shoot with their sidearm; all others use their primary weapon
    const shootWeaponKey = (attacker.sidearm && WEAPON_DEFS[attacker.weapon]?.perk === 'aoeSplash')
      ? attacker.sidearm : attacker.weapon;
    const weapon = WEAPON_DEFS[shootWeaponKey] || WEAPON_DEFS.assaultRifle;
    const alive = this.units.filter(u => u.alive && u.team !== attacker.team);
    return alive.filter(t => {
      const dist = this._dist(attacker, t);
      if (dist > weapon.range) return false;
      if (weapon.minRange && dist < weapon.minRange) return false;
      return this.hasLOS(attacker.x, attacker.y, t.x, t.y);
    });
  }

  _dist(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); // Chebyshev
  }

  resolveBlast(attacker, cx, cy) {
    // Frag Grenade: auto-hit everyone within 3" of landing spot; ignores cover.
    // On attack roll of 1 → dud check handled in resolveShoot's dud drawback.
    const affected = [];
    const friendlyHit = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue; // rough circular radius 3
        const tx = cx + dx, ty = cy + dy;
        const target = this.getUnitAt(tx, ty);
        if (target && target.alive) {
          affected.push(target);
          if (target.team === attacker.team) friendlyHit.push(target);
        }
      }
    }

    // For each target: auto-hit (ignores cover), just resolve armour save
    const weapon  = WEAPON_DEFS[attacker.weapon] || WEAPON_DEFS.fragGrenade;
    const results = [];

    // Dud check: roll attack die; on 1, dud check
    const attackRoll = this.rollD6();
    if (attackRoll === 1) {
      const dudRoll = this.rollD6();
      if (dudRoll === 1) {
        this.addLog(`💥 GRENADE DETONATES IN HAND! ${attacker.name} is hit!`, 'death');
        attacker.hp = Math.max(0, attacker.hp - 1);
        if (attacker.hp <= 0) attacker.alive = false;
        this.checkObjectiveWin();
        return results;
      }
    }

    for (const target of affected) {
      // Auto-hit, ignore cover — resolve armour save only
      const rawSave = this.rollD6();
      const modSave = rawSave + weapon.ap; // ap is -2
      let wounds = 0, pinned = 0;
      if (modSave <= 2)      wounds = 1;
      else if (modSave <= 4) pinned = 1;

      results.push({ attacker: attacker.id, target: target.id, rolls:[attackRoll], hitTarget:4, hitCount:1,
                     armourSaves:[{raw:rawSave, modified:modSave}], wounds, pinned,
                     coverType:'none', effectiveAP: weapon.ap, weaponName: weapon.name });

      if (wounds > 0 && target.alive) {
        target.hp -= wounds;
        if (target.hp <= 0) {
          target.alive = false; target.hp = 0;
          this.addLog(`💀 ${target.name} caught in blast — eliminated!`, 'death');
          if (this.gameMode === 'ctf')  this.dropFlag(target.id);
          if (this.gameMode === 'bomb') this.dropBomb(target.id);
          this.checkObjectiveWin();
        } else {
          this.addLog(`${target.name} wounded by grenade blast!`, 'hit');
        }
      }
      if (pinned > 0 && target.alive) {
        target.pinned = true;
        this.addLog(`📌 ${target.name} pinned by explosion!`, 'hit');
      }
    }

    const friendlyStr = friendlyHit.length
      ? ` ⚠️ Friendly fire — ${friendlyHit.map(u => u.name).join(', ')} in blast!` : '';
    this.addLog(`💥 ${attacker.name} throws grenade at (${cx},${cy}) — ${affected.length} in blast!${friendlyStr}`, 'ability');
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
      if (this.gameMode === 'ctf')  this.dropFlag(target.id);
      if (this.gameMode === 'bomb') this.dropBomb(target.id);
      this.checkObjectiveWin();
      return { winner: attacker, aRoll, dRoll };
    } else if (dRoll > aRoll) {
      attacker.pinned = true;
      this.addLog(`${attacker.name} is repelled and pinned!`, 'hit');
      return { winner: target, aRoll, dRoll };
    } else {
      attacker.pinned = true;
      target.pinned   = true;
      this.addLog(`Melee tied — both units pinned!`, 'miss');
      return { winner: null, aRoll, dRoll };
    }
  }

  // Medic ability — heals wounded allies (restores HP) or revives dead ones
  tryHeal(medic, targetUnit) {
    if (this.revivedUnits.has(medic.id)) {
      this.addLog(`${medic.name} has already used their heal!`, 'system');
      return false;
    }
    if (this._dist(medic, targetUnit) > 1) {
      this.addLog(`Target too far to heal!`, 'system');
      return false;
    }
    if (!targetUnit.alive) {
      // Revive a dead soldier with 1 HP
      targetUnit.alive  = true;
      targetUnit.hp     = 1;
      targetUnit.pinned = false;
      this.addLog(`💉 ${medic.name} revives ${targetUnit.name}! (1 HP)`, 'ability');
    } else if (targetUnit.hp < targetUnit.maxHp) {
      // Patch up a wounded soldier — restore up to half max HP (min 1)
      const restored    = Math.max(1, Math.floor(targetUnit.maxHp / 2));
      targetUnit.hp     = Math.min(targetUnit.maxHp, targetUnit.hp + restored);
      targetUnit.pinned = false;
      this.addLog(`💉 ${medic.name} patches up ${targetUnit.name} — +${restored} HP! (${targetUnit.hp}/${targetUnit.maxHp})`, 'ability');
    } else if (targetUnit.pinned) {
      // Fully healthy but pinned — clear the pin
      targetUnit.pinned = false;
      this.addLog(`💉 ${medic.name} steadies ${targetUnit.name} — pin cleared!`, 'ability');
    } else {
      this.addLog(`${targetUnit.name} doesn't need healing!`, 'system');
      return false;
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
    this.hasSprinted  = false; // kept for serialization compat
    this.hasRun       = false;
    this.isAiming     = false;
    this.actionTakenThisActivation = false;
    unit.aiming  = false;
    unit.hasRun  = false;
    // Pinned: warrior cannot move this activation; clear pinned after it takes effect
    if (unit.pinned) {
      this.hasMoved = true;   // block movement actions
      unit.pinned   = false;
      this.addLog(`📌 ${unit.name} is Pinned — movement blocked this activation!`, 'system');
    }
    this.addLog(`— ${unit.name} activated (${MAX_ACTIONS} actions)`, 'activate');
    return true;
  }

  useAction(cost = 1) {
    this.actionTakenThisActivation = true;
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
    this.actionTakenThisActivation = false;

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

  deactivateUnit() {
    if (this.activeUnit && this.actionTakenThisActivation) {
      this.activatedThisRound.add(this.activeUnit);
    }
    this.activeUnit  = null;
    this.actionsLeft = MAX_ACTIONS;
    this.hasMoved    = false;
    this.hasSprinted = false;
    this.hasRun      = false;
    this.isAiming    = false;
    this.actionTakenThisActivation = false;
  }

  // ─── Objective initialisation ──────────────────────────────
  initObjectives() {
    const { COLS, ROWS } = CFG;
    const cx  = Math.floor(COLS / 2);
    const cy  = Math.floor(ROWS / 2);
    // Custom positions from scenario editor (if any)
    const cus = this._scCustomObjectives || {};

    if (this.gameMode === 'ctf') {
      const flagPos = cus.flag
        ? this._nearestOpen(cus.flag.x, cus.flag.y)
        : this._nearestOpen(cx, cy);
      this.objectives = {
        flag: { x: flagPos.x, y: flagPos.y, carriedBy: null, capturedBy: null },
      };
      this.addLog('🚩 Capture the Flag — grab the flag at centre and return it to your base!', 'system');

    } else if (this.gameMode === 'bomb') {
      // Determine which team is attacking (default team 0 = left side)
      const attTeam = (this.bombAttackerTeam === 1) ? 1 : 0;
      const defTeam = 1 - attTeam;

      // Attacker deploys left (cols 0-3) or right (cols COLS-4 to COLS-1)
      const attLeft  = attTeam === 0;
      // Bomb spawns in attacker deployment zone centre
      const bombDefaultX = attLeft ? 2 : COLS - 3;
      const bombDefaultY = Math.floor(ROWS / 2);
      // Sites spawn in defender deployment zone (split top/bottom)
      const defLeft  = !attLeft;
      const siteBaseX = defLeft ? 2 : COLS - 3;

      const site1    = cus.site_a  ? this._nearestOpen(cus.site_a.x,  cus.site_a.y)
                                   : this._nearestOpen(siteBaseX, Math.floor(ROWS * 0.25));
      const site2    = cus.site_b  ? this._nearestOpen(cus.site_b.x,  cus.site_b.y)
                                   : this._nearestOpen(siteBaseX, Math.floor(ROWS * 0.75));
      const bombStart = cus.bomb   ? this._nearestOpen(cus.bomb.x,    cus.bomb.y)
                                   : this._nearestOpen(bombDefaultX,  bombDefaultY);
      const fuseLen = (this.bombFuseLength && this.bombFuseLength >= 1) ? this.bombFuseLength : 8;
      this.objectives = {
        sites: [
          { id: 0, x: site1.x,     y: site1.y,     planted: false, defused: false },
          { id: 1, x: site2.x,     y: site2.y,     planted: false, defused: false },
        ],
        bomb:        { x: bombStart.x, y: bombStart.y, carriedBy: null },
        bombPlanted: false,
        bombTimer:   0,
        maxTimer:    fuseLen,
        activeSite:  null,
        attackerTeam: attTeam,
        defenderTeam: defTeam,
      };
      const attName = this.players[attTeam]?.name || `Team ${attTeam + 1}`;
      const defName = this.players[defTeam]?.name || `Team ${defTeam + 1}`;
      this.addLog(`💣 Plant the Bomb — ${attName} are Attackers. ${defName} have ${fuseLen} rounds to defuse!`, 'system');

    } else if (this.gameMode === 'vip') {
      const ex = cus.extract ? cus.extract.x : CFG.COLS - 2;
      const ey = cus.extract ? cus.extract.y : Math.floor(ROWS / 2);
      this.objectives = { vipId: null, extractX: ex, extractY: ey };
      this.addLog('👑 VIP Escort — Alpha must get the VIP to the extraction point. Bravo must eliminate them!', 'system');
    }
    // Clear custom positions after use so they don't affect new games
    this._scCustomObjectives = null;
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

  // Bomb: pick up (attacker must carry it to a site before planting)
  tryPickupBomb(unit) {
    const obj = this.objectives;
    const attTeam = obj.attackerTeam ?? 0;
    if (!obj.bomb || unit.team !== attTeam) return false;    // only attackers
    if (obj.bomb.carriedBy !== null) return false;            // already carried
    if (obj.bombPlanted) return false;                        // already planted
    if (unit.x !== obj.bomb.x || unit.y !== obj.bomb.y) return false;
    obj.bomb.carriedBy = unit.id;
    this.addLog(`💣 ${unit.name} picks up the bomb!`, 'ability');
    return true;
  }

  // Drop bomb on current tile (e.g. when carrier is killed)
  dropBomb(unitId) {
    const obj = this.objectives;
    if (!obj.bomb || obj.bomb.carriedBy !== unitId) return;
    const carrier = this.getUnit(unitId);
    if (carrier) { obj.bomb.x = carrier.x; obj.bomb.y = carrier.y; }
    obj.bomb.carriedBy = null;
    this.addLog(`💣 The bomb was dropped!`, 'system');
  }

  // Bomb: plant at a site (carrier must be standing on a site tile)
  tryPlantBomb(unit) {
    const obj = this.objectives;
    const attTeam = obj.attackerTeam ?? 0;
    if (!obj.sites || unit.team !== attTeam) return false;
    if (obj.bombPlanted) return false;
    if (!obj.bomb || obj.bomb.carriedBy !== unit.id) return false; // must be carrying
    const site = obj.sites.find(s => s.x === unit.x && s.y === unit.y && !s.planted);
    if (!site) return false;
    site.planted    = true;
    obj.bombPlanted = true;
    obj.activeSite  = site.id;
    obj.bombTimer   = obj.maxTimer;
    obj.bomb.carriedBy = null;  // bomb is now planted (no longer carried)
    this.addLog(`💣 ${unit.name} plants the bomb at Site ${site.id + 1}! Defenders have ${obj.maxTimer} rounds!`, 'ability');
    return true;
  }

  // Bomb: defuse
  tryDefuseBomb(unit) {
    const obj = this.objectives;
    const defTeam = obj.defenderTeam ?? 1;
    if (!obj.sites || unit.team !== defTeam) return false; // only defenders defuse
    if (!obj.bombPlanted) return false;
    const site = obj.sites.find(s => s.id === obj.activeSite);
    if (!site || site.defused) return false;
    if (unit.x !== site.x || unit.y !== site.y) return false;
    site.defused    = true;
    obj.bombPlanted = false;
    this.addLog(`💣 ${unit.name} defuses the bomb! Defenders win!`, 'system');
    this.phase  = 'gameover';
    this.winner = defTeam;
    return true;
  }

  // Called at end of each round to tick bomb timer
  tickBombTimer() {
    const obj = this.objectives;
    if (!obj.sites || !obj.bombPlanted) return;
    obj.bombTimer--;
    this.addLog(`💣 Bomb detonates in ${obj.bombTimer} round${obj.bombTimer !== 1 ? 's' : ''}!`, 'system');
    if (obj.bombTimer <= 0) {
      const attTeam = obj.attackerTeam ?? 0;
      this.addLog(`💥 BOOM! The bomb explodes! Attackers win!`, 'system');
      this.phase  = 'gameover';
      this.winner = attTeam;
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

    // VIP mode: Bravo wins if VIP is killed; Alpha wins if VIP reaches extraction
    if (this.gameMode === 'vip' && this.objectives?.vipId) {
      const vip = this.getUnit(this.objectives.vipId);
      if (vip && !vip.alive) return 1;
      if (vip && vip.alive &&
          vip.x === this.objectives.extractX && vip.y === this.objectives.extractY) {
        return 0;
      }
    }

    return null;
  }

  newRound() {
    this.turn++;
    this.activatedThisRound = new Set();
    this.overwatchUnits     = new Set();
    this.units.forEach(u => {
      if (u.alive) {
        // Note: pinned is cleared in activateUnit, not here, so it persists correctly.
        u.aiming      = false;
        u.hasRun      = false;
        // needsReload and weaponJammed persist until cleared by a Reload action
      }
    });
    this.currentPlayer = 0;
    this.hasRun = false;
    this.actionTakenThisActivation = false;
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

  serialize() {
    return JSON.stringify({
      board: this.board, buildings: this.buildings, coverObjs: this.coverObjs,
      units: this.units, players: this.players,
      theme: this.theme, phase: this.phase, turn: this.turn,
      currentPlayer: this.currentPlayer, activeUnit: this.activeUnit,
      actionsLeft: this.actionsLeft, hasMoved: this.hasMoved,
      hasSprinted: this.hasSprinted, hasRun: this.hasRun, isAiming: this.isAiming,
      activatedThisRound: [...this.activatedThisRound],
      winner: this.winner, log: this.log.slice(-20),
      abilityUsed: [...this.abilityUsed], revivedUnits: [...this.revivedUnits],
      overwatchUnits: [...this.overwatchUnits], _uidCounter: this._uidCounter,
    });
  }

  deserialize(str) {
    const d = JSON.parse(str);
    const ALLOWED_FIELDS = [
      'board', 'buildings', 'coverObjs', 'units', 'players',
      'theme', 'phase', 'turn', 'currentPlayer', 'activeUnit',
      'actionsLeft', 'hasMoved', 'hasSprinted', 'hasRun', 'isAiming',
      'winner', 'log', '_uidCounter', 'gameMode', 'objectives',
    ];
    for (const key of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(d, key)) this[key] = d[key];
    }
    this.activatedThisRound = new Set(Array.isArray(d.activatedThisRound) ? d.activatedThisRound : []);
    this.abilityUsed        = new Set(Array.isArray(d.abilityUsed)        ? d.abilityUsed        : []);
    this.revivedUnits       = new Set(Array.isArray(d.revivedUnits)       ? d.revivedUnits       : []);
    this.overwatchUnits     = new Set(Array.isArray(d.overwatchUnits)     ? d.overwatchUnits     : []);
  }
}
