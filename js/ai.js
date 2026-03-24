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
    let best = null, bestScore = -Infinity;
    for (const u of units) {
      const targets     = state.getValidTargets(u);
      const nearestDist = this._nearestEnemyDist(state, u);
      const inCover     = this._isInCover(state, u.x, u.y);
      let score = 0;

      if (targets.length)       score += 100 - nearestDist;  // has a shot
      if (u.ability === 'sniper') score += 20;
      if (u.ability === 'blast' && targets.length) score += 30;
      if (u.ability === 'command') score -= 8;                // activate leader last
      if (u.suppressed)          score -= 20;                 // suppressed = deprioritise
      if (!inCover && nearestDist <= 8) score += 15;          // exposed unit near enemies needs attention
      if (inCover && !targets.length)   score -= 5;           // safe unit in cover is less urgent
      score += Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = u; }
    }
    return best || units[0];
  }

  _planUnitActions(state, unit) {
    const actions = [];

    // ── BOMB MODE LOGIC ─────────────────────────────────────────────────────
    if (state.gameMode === 'bomb') {
      const obj = state.objectives;
      const attTeam = obj?.attackerTeam ?? 0;
      const defTeam = obj?.defenderTeam ?? 1;

      // DEFENDERS: defuse the bomb if it's planted
      if (unit.team === defTeam && obj && obj.bombPlanted) {
        const site = obj.sites && obj.sites.find(s => s.id === obj.activeSite && !s.defused);
        if (site) {
          const dist = Math.abs(unit.x - site.x) + Math.abs(unit.y - site.y);
          if (unit.x === site.x && unit.y === site.y) {
            // Standing on the site — defuse immediately
            actions.push({ type: 'defuse_bomb', unitId: unit.id });
            actions.push({ type: 'end', unitId: unit.id });
            return actions;
          } else {
            // Move toward the bomb site, using sprint if needed
            const sprintRange = state.getMovementRange(unit, true);
            const moveRange   = state.getMovementRange(unit, false);
            // Pick the reachable tile closest to the site
            const allRange = sprintRange.length ? sprintRange : moveRange;
            let best = null, bestDist = Infinity;
            for (const t of allRange) {
              const d = Math.abs(t.x - site.x) + Math.abs(t.y - site.y);
              if (d < bestDist) { bestDist = d; best = t; }
            }
            if (best) {
              const canSprint = sprintRange.some(t => t.x === best.x && t.y === best.y);
              actions.push({ type: canSprint ? 'sprint' : 'move', unitId: unit.id, x: best.x, y: best.y });
              // If we'd land exactly on the site after moving, defuse too
              if (best.x === site.x && best.y === site.y) {
                actions.push({ type: 'defuse_bomb', unitId: unit.id });
              }
            }
            actions.push({ type: 'end', unitId: unit.id });
            return actions;
          }
        }
      }

      // ATTACKERS: pick up bomb, then plant it
      if (unit.team === attTeam && obj && obj.bomb && !obj.bombPlanted) {
        const bombCarried = obj.bomb.carriedBy === unit.id;
        const bombFree    = obj.bomb.carriedBy === null;

        if (!bombCarried && bombFree) {
          // Try to pick up bomb if standing on it
          if (unit.x === obj.bomb.x && unit.y === obj.bomb.y) {
            actions.push({ type: 'pickup_bomb', unitId: unit.id });
            // After picking up, try to move toward nearest unplanted site
            const site = obj.sites && obj.sites.find(s => !s.planted);
            if (site) {
              const moveRange = state.getMovementRange(unit, false);
              let best = null, bestDist = Infinity;
              for (const t of moveRange) {
                const d = Math.abs(t.x - site.x) + Math.abs(t.y - site.y);
                if (d < bestDist) { bestDist = d; best = t; }
              }
              if (best && !(best.x === unit.x && best.y === unit.y)) {
                actions.push({ type: 'move', unitId: unit.id, x: best.x, y: best.y });
              }
            }
            actions.push({ type: 'end', unitId: unit.id });
            return actions;
          } else {
            // Move toward the bomb
            const sprintRange = state.getMovementRange(unit, true);
            const moveRange   = state.getMovementRange(unit, false);
            const allRange = sprintRange.length ? sprintRange : moveRange;
            let best = null, bestDist = Infinity;
            for (const t of allRange) {
              const d = Math.abs(t.x - obj.bomb.x) + Math.abs(t.y - obj.bomb.y);
              if (d < bestDist) { bestDist = d; best = t; }
            }
            if (best) {
              const canSprint = sprintRange.some(t => t.x === best.x && t.y === best.y);
              actions.push({ type: canSprint ? 'sprint' : 'move', unitId: unit.id, x: best.x, y: best.y });
              // If we move onto the bomb, pick it up too
              if (best.x === obj.bomb.x && best.y === obj.bomb.y) {
                actions.push({ type: 'pickup_bomb', unitId: unit.id });
              }
            }
            actions.push({ type: 'end', unitId: unit.id });
            return actions;
          }
        }

        if (bombCarried) {
          // Carrying the bomb — head to nearest unplanted site
          const site = obj.sites && obj.sites.find(s => !s.planted);
          if (site) {
            if (unit.x === site.x && unit.y === site.y) {
              // Plant it!
              actions.push({ type: 'plant_bomb', unitId: unit.id });
              actions.push({ type: 'end', unitId: unit.id });
              return actions;
            } else {
              const sprintRange = state.getMovementRange(unit, true);
              const moveRange   = state.getMovementRange(unit, false);
              const allRange = sprintRange.length ? sprintRange : moveRange;
              let best = null, bestDist = Infinity;
              for (const t of allRange) {
                const d = Math.abs(t.x - site.x) + Math.abs(t.y - site.y);
                if (d < bestDist) { bestDist = d; best = t; }
              }
              if (best) {
                const canSprint = sprintRange.some(t => t.x === best.x && t.y === best.y);
                actions.push({ type: canSprint ? 'sprint' : 'move', unitId: unit.id, x: best.x, y: best.y });
                if (best.x === site.x && best.y === site.y) {
                  actions.push({ type: 'plant_bomb', unitId: unit.id });
                }
              }
              actions.push({ type: 'end', unitId: unit.id });
              return actions;
            }
          }
        }
      }
    }
    // ── END BOMB MODE LOGIC ─────────────────────────────────────────────────
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
      if (unit.ability === 'blast' && actionsLeft >= 1) {
        const cluster = this._findBestBlastTile(state, unit, targets);
        if (cluster) {
          actions.push({ type: 'ability', unitId: unit.id, x: cluster.x, y: cluster.y });
          actionsLeft -= 1;
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

    // Take cover if standing on a cover tile and have an action left.
    // Reserve the action for medic heal if needed.
    const medicNeedsAction = unit.ability === 'heal'
      && !state.revivedUnits.has(unit.id)
      && this._findHealTarget(state, unit) !== null;
    const shouldCover = actionsLeft >= 1
      && this._isInCover(state, simX, simY)
      && !unit.inCover                          // avoid wasting action if already in cover
      && !(actionsLeft === 1 && medicNeedsAction);
    if (shouldCover) {
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
    const enemies = state.units.filter(u => u.alive && u.team !== this.team);
    if (!enemies.length) return null;

    // Find nearest enemy and the most dangerous enemy (most shots at us)
    let nearestEnemy = null, minDist = Infinity;
    for (const e of enemies) {
      const d = Math.abs(unit.x - e.x) + Math.abs(unit.y - e.y);
      if (d < minDist) { minDist = d; nearestEnemy = e; }
    }
    if (!nearestEnemy) return null;

    // Determine how exposed the unit currently is (how many enemies can target it)
    const currentlyExposed = enemies.filter(e =>
      state.hasLOS(e.x, e.y, unit.x, unit.y) &&
      Math.max(Math.abs(e.x - unit.x), Math.abs(e.y - unit.y)) <= e.range
    ).length;
    const alreadyInCover = this._isInCover(state, unit.x, unit.y);

    // Use sprint if far from enemies AND not already in cover; walk if close or in cover
    const useSprint = minDist > unit.move * 2 && !alreadyInCover;
    const range = state.getMovementRange(unit, useSprint);
    if (!range.length) return null;

    let bestTile = null, bestScore = -Infinity;
    for (const tile of range) {
      const distToNearest = Math.abs(tile.x - nearestEnemy.x) + Math.abs(tile.y - nearestEnemy.y);
      const inCover       = this._isInCover(state, tile.x, tile.y);

      // Count how many enemies could shoot us from this tile (exposure)
      const exposure = enemies.filter(e =>
        state.hasLOS(e.x, e.y, tile.x, tile.y) &&
        Math.max(Math.abs(e.x - tile.x), Math.abs(e.y - tile.y)) <= e.range
      ).length;

      const inShotRange   = distToNearest <= unit.range;
      const hasLOSToEnemy = state.hasLOS(tile.x, tile.y, nearestEnemy.x, nearestEnemy.y);

      // Scoring: strongly prefer cover, strongly avoid exposure
      let score = 0;
      score -= distToNearest * 1.5;        // closer to enemy is better
      score += inCover ? 18 : 0;           // cover is very valuable
      score -= exposure * 12;              // each additional shooter is costly
      score += inShotRange ? 10 : 0;       // can shoot from here
      score += hasLOSToEnemy ? 5 : 0;      // can see an enemy
      score += Math.random() * 3;          // small tiebreaker

      // Scouts get extra bonus for staying hidden in cover
      if (unit.ability === 'stealth' && inCover) score += 10;
      // Snipers want range — penalise getting too close
      if (unit.ability === 'overwatch' && distToNearest < 6) score -= 8;

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
