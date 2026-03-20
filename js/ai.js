// ============================================================
//  ROGUE WARRIORS DIGITAL — AI PLAYER
// ============================================================

class AIPlayer {
  constructor(team = 1) {
    this.team     = team;
    this.delay    = 800;  // ms between AI actions
    this._pending = null;
  }

  // Entry: called each time it's the AI's turn
  // Returns a sequence of actions to execute
  planTurn(state) {
    const myUnits = state.units.filter(u => u.alive && u.team === this.team && !state.activatedThisRound.has(u.id));
    if (!myUnits.length) return [];
    // Pick the best unit to activate
    const unit = this._chooseUnit(state, myUnits);
    return this._planUnitActions(state, unit);
  }

  _chooseUnit(state, units) {
    // Priority: unit with a target > unit near enemies > other
    let best = null, bestScore = -Infinity;
    for (const u of units) {
      const targets = state.getValidTargets(u);
      const nearestDist = this._nearestEnemyDist(state, u);
      let score = 0;
      if (targets.length)         score += 100 - nearestDist;
      if (u.ability === 'sniper') score += 20;
      if (u.ability === 'grenadier' && targets.length) score += 30;
      if (u.ability === 'command') score -= 10; // save leader
      score += Math.random() * 10;
      if (score > bestScore) { bestScore = score; best = u; }
    }
    return best || units[0];
  }

  _planUnitActions(state, unit) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;
    let simX = unit.x, simY = unit.y;
    let hasMoved   = false;
    let hasSprinted = false;

    // Action 1: Aim if sniper and has target, otherwise evaluate
    const targets = state.getValidTargets(unit);

    // Sniper: overwatch if no clear targets but positioned well
    if (unit.ability === 'overwatch' && targets.length === 0 && actionsLeft >= 1) {
      const nearDist = this._nearestEnemyDist(state, unit);
      if (nearDist <= unit.range && this._isInCover(state, simX, simY)) {
        actions.push({ type: 'overwatch', unitId: unit.id });
        actionsLeft -= 2;
      }
    }

    // If targets exist: Aim + Shoot (2 actions) or just Shoot (1 action)
    if (targets.length > 0 && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      // Use ability first if grenadier and multiple clustered enemies
      if (unit.ability === 'blast' && actionsLeft >= 2) {
        const cluster = this._findBestBlastTile(state, unit, targets);
        if (cluster) {
          actions.push({ type: 'ability', unitId: unit.id, x: cluster.x, y: cluster.y });
          actionsLeft -= 2;
        } else {
          actions.push({ type: 'aim',   unitId: unit.id });
          actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
          actionsLeft -= 2;
        }
      } else {
        actions.push({ type: 'aim',   unitId: unit.id });
        actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
        actionsLeft -= 2;
      }
    } else if (targets.length > 0 && actionsLeft === 1) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft--;
    }

    // If actions left and no targets: Move toward enemies
    if (actionsLeft >= 2 && !hasMoved && !hasSprinted && targets.length === 0) {
      const moveTarget = this._bestMovePosition(state, unit);
      if (moveTarget) {
        const sprintRange = state.getMovementRange(unit, true);
        const canSprint   = sprintRange.some(t => t.x === moveTarget.x && t.y === moveTarget.y);
        if (canSprint) {
          actions.push({ type: 'sprint', unitId: unit.id, x: moveTarget.x, y: moveTarget.y });
        } else {
          actions.push({ type: 'move', unitId: unit.id, x: moveTarget.x, y: moveTarget.y });
        }
        actionsLeft -= 2;
        hasMoved = true;
        simX = moveTarget.x;
        simY = moveTarget.y;
      }
    } else if (actionsLeft === 1 && !hasMoved && targets.length === 0) {
      const moveTarget = this._bestMovePosition(state, unit);
      if (moveTarget) {
        const moveRange = state.getMovementRange(unit, false);
        const canMove   = moveRange.some(t => t.x === moveTarget.x && t.y === moveTarget.y);
        if (canMove) {
          actions.push({ type: 'move', unitId: unit.id, x: moveTarget.x, y: moveTarget.y });
          actionsLeft--;
          hasMoved = true;
          simX = moveTarget.x;
          simY = moveTarget.y;
        }
      }
    }

    // If actions left and in cover: take cover (but reserve 1 action for medic heal)
    // FIX #4: Previously the cover action could consume the last action before
    // the medic check ran, leaving actionsLeft at 0 and silently dropping the
    // heal. Now we only take cover if we won't need that action for healing.
    const medicNeedsAction = unit.ability === 'heal'
      && !state.revivedUnits.has(unit.id)
      && this._findHealTarget(state, unit) !== null;
    if (actionsLeft >= 1 && this._isInCover(state, simX, simY) && !(actionsLeft === 1 && medicNeedsAction)) {
      actions.push({ type: 'cover', unitId: unit.id });
      actionsLeft--;
    }

    // Medic: heal nearby wounded/dead ally
    if (unit.ability === 'heal' && actionsLeft >= 1 && !state.revivedUnits.has(unit.id)) {
      const healTarget = this._findHealTarget(state, unit);
      if (healTarget) {
        actions.push({ type: 'ability', unitId: unit.id, targetId: healTarget.id });
        actionsLeft--;
      }
    }

    // Always end activation
    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _pickTarget(state, unit, targets) {
    // Pick lowest HP first, prefer closest if tied
    let best = null, bestScore = -Infinity;
    for (const t of targets) {
      const dist  = Math.max(Math.abs(unit.x - t.x), Math.abs(unit.y - t.y));
      const score = (unit.range - dist) * 2 + (1 - t.hp) * 50;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  _findBestBlastTile(state, unit, targets) {
    // Find a tile that maximises enemies hit without hitting friendly units.
    // FIX #5: Original code counted only enemies, ignoring allies in the same
    // 3×3 blast radius. Now we skip any tile that would catch a friendly.
    let bestTile = null, bestCount = 1;
    for (const t of targets) {
      let count = 0;
      let hitsFriendly = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const occupant = state.getUnitAt(t.x + dx, t.y + dy);
          if (!occupant) continue;
          if (occupant.team !== unit.team) count++;
          else hitsFriendly = true;
        }
      }
      if (!hitsFriendly && count > bestCount) { bestCount = count; bestTile = { x: t.x, y: t.y }; }
    }
    return bestTile;
  }

  _bestMovePosition(state, unit) {
    const enemies   = state.units.filter(u => u.alive && u.team !== this.team);
    if (!enemies.length) return null;

    // Find nearest enemy
    let nearestEnemy = null, minDist = Infinity;
    for (const e of enemies) {
      const d = Math.abs(unit.x - e.x) + Math.abs(unit.y - e.y);
      if (d < minDist) { minDist = d; nearestEnemy = e; }
    }
    if (!nearestEnemy) return null;

    // Get sprint range and pick tile closest to enemy that is also cover or close shot
    const range = state.getMovementRange(unit, minDist > unit.move * 2 ? true : false);
    if (!range.length) return null;

    let bestTile = null, bestScore = -Infinity;
    for (const tile of range) {
      const distToEnemy = Math.abs(tile.x - nearestEnemy.x) + Math.abs(tile.y - nearestEnemy.y);
      const inCover     = this._isInCover(state, tile.x, tile.y) ? 5 : 0;
      const inRange     = distToEnemy <= unit.range ? 10 : 0;
      const score       = -distToEnemy + inCover + inRange + Math.random();
      if (score > bestScore) { bestScore = score; bestTile = tile; }
    }
    return bestTile;
  }

  _findHealTarget(state, medic) {
    const allies = state.units.filter(u => u.team === this.team && u.id !== medic.id);
    for (const a of allies) {
      const d = Math.max(Math.abs(medic.x - a.x), Math.abs(medic.y - a.y));
      if (d <= 1 && (!a.alive || a.suppressed)) return a;
    }
    return null;
  }

  _isInCover(state, x, y) {
    if (!state._inBounds(x, y)) return false;
    const t = state.board[y][x];
    return t.type === TILE.COVER || t.type === TILE.RUBBLE;
  }

  _nearestEnemyDist(state, unit) {
    const enemies = state.units.filter(u => u.alive && u.team !== this.team);
    let min = 999;
    for (const e of enemies) {
      const d = Math.max(Math.abs(unit.x - e.x), Math.abs(unit.y - e.y));
      if (d < min) min = d;
    }
    return min;
  }
}
