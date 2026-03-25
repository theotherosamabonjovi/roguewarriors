// ============================================================
//  ROGUE WARRIORS DIGITAL — AI PLAYER
// ============================================================

class AIPlayer {
  constructor(team = 1) {
    this.team     = team;
    this.delay    = 800;
  }

  planTurn(state) {
    const myUnits = state.units.filter(u =>
      u.alive && u.team === this.team && !state.activatedThisRound.has(u.id)
    );
    if (!myUnits.length) return [];
    return this._planUnitActions(state, this._chooseUnit(state, myUnits));
  }

  _unitRange(unit) {
    return WEAPON_DEFS[unit.weapon]?.range || 18;
  }

  _chooseUnit(state, units) {
    let best = null, bestScore = -Infinity;
    for (const u of units) {
      const targets     = state.getValidTargets(u);
      const nearestDist = this._nearestEnemyDist(state, u);
      const inCover     = this._isInCover(state, u.x, u.y);
      let score = 0;
      if (targets.length)          score += 100 - nearestDist;
      if (u.ability === 'sniper')  score += 20;
      if (u.ability === 'blast' && targets.length) score += 30;
      if (u.ability === 'command') score -= 8;
      if (u.pinned)                score -= 20;
      if (!inCover && nearestDist <= 8) score += 15;
      if (inCover && !targets.length)   score -= 5;
      score += Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = u; }
    }
    return best || units[0];
  }

  _planUnitActions(state, unit) {
    const actions = [];

    // BOMB MODE
    if (state.gameMode === 'bomb') {
      const obj     = state.objectives;
      const attTeam = obj?.attackerTeam ?? 0;
      const defTeam = obj?.defenderTeam ?? 1;

      if (unit.team === defTeam && obj?.bombPlanted) {
        const site = obj.sites?.find(s => s.id === obj.activeSite && !s.defused);
        if (site) {
          if (unit.x === site.x && unit.y === site.y) {
            actions.push({ type: 'defuse_bomb', unitId: unit.id });
          } else {
            const best = this._moveToward(state, unit, site.x, site.y);
            if (best) actions.push({ type: 'move', unitId: unit.id, x: best.x, y: best.y });
            if (best?.x === site.x && best?.y === site.y)
              actions.push({ type: 'defuse_bomb', unitId: unit.id });
          }
          actions.push({ type: 'end', unitId: unit.id });
          return actions;
        }
      }

      if (unit.team === attTeam && obj?.bomb && !obj.bombPlanted) {
        const bombCarried = obj.bomb.carriedBy === unit.id;
        const bombFree    = obj.bomb.carriedBy === null;
        if (!bombCarried && bombFree) {
          if (unit.x === obj.bomb.x && unit.y === obj.bomb.y) {
            actions.push({ type: 'pickup_bomb', unitId: unit.id });
            const site = obj.sites?.find(s => !s.planted);
            if (site) {
              const best = this._moveToward(state, unit, site.x, site.y);
              if (best) actions.push({ type: 'move', unitId: unit.id, x: best.x, y: best.y });
            }
          } else {
            const best = this._moveToward(state, unit, obj.bomb.x, obj.bomb.y);
            if (best) actions.push({ type: 'move', unitId: unit.id, x: best.x, y: best.y });
            if (best?.x === obj.bomb.x && best?.y === obj.bomb.y)
              actions.push({ type: 'pickup_bomb', unitId: unit.id });
          }
          actions.push({ type: 'end', unitId: unit.id });
          return actions;
        }
        if (bombCarried) {
          const site = obj.sites?.find(s => !s.planted);
          if (site) {
            if (unit.x === site.x && unit.y === site.y) {
              actions.push({ type: 'plant_bomb', unitId: unit.id });
            } else {
              const best = this._moveToward(state, unit, site.x, site.y);
              if (best) actions.push({ type: 'move', unitId: unit.id, x: best.x, y: best.y });
              if (best?.x === site.x && best?.y === site.y)
                actions.push({ type: 'plant_bomb', unitId: unit.id });
            }
          }
          actions.push({ type: 'end', unitId: unit.id });
          return actions;
        }
      }
    }

    let actionsLeft = MAX_ACTIONS;
    let hasMoved = false;
    let simX = unit.x, simY = unit.y;

    // Clear jam/reload first
    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    // Sniper overwatch
    if (unit.ability === 'overwatch' && actionsLeft >= 2) {
      const tgts = state.getValidTargets(unit);
      if (tgts.length === 0 && this._nearestEnemyDist(state, unit) <= this._unitRange(unit) && this._isInCover(state, simX, simY)) {
        actions.push({ type: 'overwatch', unitId: unit.id });
        actionsLeft -= 2;
      }
    }

    const targets = state.getValidTargets(unit);

    if (targets.length > 0 && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      if (unit.ability === 'blast') {
        const cluster = this._findBestBlastTile(state, unit, targets);
        if (cluster) {
          actions.push({ type: 'ability', unitId: unit.id, x: cluster.x, y: cluster.y });
          actionsLeft--;
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

    if (actionsLeft >= 1 && !hasMoved && targets.length === 0) {
      const moveTarget = this._bestMovePosition(state, unit);
      if (moveTarget) {
        const moveRange = state.getMovementRange(unit, false);
        if (moveRange.some(t => t.x === moveTarget.x && t.y === moveTarget.y)) {
          actions.push({ type: 'move', unitId: unit.id, x: moveTarget.x, y: moveTarget.y });
          actionsLeft--;
          hasMoved = true;
          simX = moveTarget.x;
          simY = moveTarget.y;
        }
      }
    }

    const medicNeedsAction = unit.ability === 'heal'
      && !state.revivedUnits.has(unit.id)
      && this._findHealTarget(state, unit) !== null;
    if (actionsLeft >= 1 && this._isInCover(state, simX, simY) && !unit.inCover
        && !(actionsLeft === 1 && medicNeedsAction)) {
      actions.push({ type: 'cover', unitId: unit.id });
      actionsLeft--;
    }

    if (unit.ability === 'heal' && actionsLeft >= 1 && !state.revivedUnits.has(unit.id)) {
      const healTarget = this._findHealTarget(state, unit);
      if (healTarget) {
        actions.push({ type: 'ability', unitId: unit.id, targetId: healTarget.id });
        actionsLeft--;
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _moveToward(state, unit, tx, ty) {
    const r = state.getMovementRange(unit, false);
    if (!r.length) return null;
    let best = null, bestDist = Infinity;
    for (const t of r) {
      const d = Math.abs(t.x - tx) + Math.abs(t.y - ty);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  _pickTarget(state, unit, targets) {
    let best = null, bestScore = -Infinity;
    for (const t of targets) {
      const dist  = Math.max(Math.abs(unit.x - t.x), Math.abs(unit.y - t.y));
      const score = (this._unitRange(unit) - dist) * 2 + (1 - t.hp) * 50;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  _findBestBlastTile(state, unit, targets) {
    let bestTile = null, bestCount = 1;
    for (const t of targets) {
      let count = 0, hitsFriendly = false;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > 3) continue;
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
    const enemies = state.units.filter(u => u.alive && u.team !== this.team);
    if (!enemies.length) return null;
    let nearestEnemy = null, minDist = Infinity;
    for (const e of enemies) {
      const d = Math.abs(unit.x - e.x) + Math.abs(unit.y - e.y);
      if (d < minDist) { minDist = d; nearestEnemy = e; }
    }
    if (!nearestEnemy) return null;
    const range = state.getMovementRange(unit, false);
    if (!range.length) return null;
    let bestTile = null, bestScore = -Infinity;
    for (const tile of range) {
      const distToNearest = Math.abs(tile.x - nearestEnemy.x) + Math.abs(tile.y - nearestEnemy.y);
      const inCover       = this._isInCover(state, tile.x, tile.y);
      const exposure      = enemies.filter(e =>
        state.hasLOS(e.x, e.y, tile.x, tile.y) &&
        Math.max(Math.abs(e.x - tile.x), Math.abs(e.y - tile.y)) <= this._unitRange(e)
      ).length;
      let score = 0;
      score -= distToNearest * 1.5;
      score += inCover ? 18 : 0;
      score -= exposure * 12;
      score += (distToNearest <= this._unitRange(unit)) ? 10 : 0;
      score += state.hasLOS(tile.x, tile.y, nearestEnemy.x, nearestEnemy.y) ? 5 : 0;
      score += Math.random() * 3;
      if (unit.ability === 'stealth' && inCover) score += 10;
      if (unit.ability === 'overwatch' && distToNearest < 6) score -= 8;
      if (score > bestScore) { bestScore = score; bestTile = tile; }
    }
    return bestTile;
  }

  _findHealTarget(state, medic) {
    for (const a of state.units.filter(u => u.team === this.team && u.id !== medic.id)) {
      const d = Math.max(Math.abs(medic.x - a.x), Math.abs(medic.y - a.y));
      if (d <= 1 && (!a.alive || a.pinned)) return a;
    }
    return null;
  }

  _isInCover(state, x, y) {
    if (!state._inBounds(x, y)) return false;
    const t = state.board[y][x];
    return t.type === TILE.COVER || t.type === TILE.RUBBLE;
  }

  _nearestEnemyDist(state, unit) {
    let min = 999;
    for (const e of state.units.filter(u => u.alive && u.team !== this.team)) {
      const d = Math.max(Math.abs(unit.x - e.x), Math.abs(unit.y - e.y));
      if (d < min) min = d;
    }
    return min;
  }
}
