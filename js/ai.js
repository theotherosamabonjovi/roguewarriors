// ============================================================
//  ROGUE WARRIORS DIGITAL — AI PLAYER  (v2)
// ============================================================

class AIPlayer {
  constructor(team = 1) {
    this.team  = team;
    this.delay = 800;
  }

  planTurn(state) {
    const myUnits = state.units.filter(u =>
      u.alive && u.team === this.team && !state.activatedThisRound.has(u.id)
    );
    if (!myUnits.length) return [];
    return this._planUnitActions(state, this._chooseUnit(state, myUnits));
  }

  // ── Utility ──────────────────────────────────────────────

  _dist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }
  _cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  _unitRange(unit)       { return WEAPON_DEFS[unit.weapon]?.range || 18; }

  _isInCover(state, x, y) {
    if (!state._inBounds(x, y)) return false;
    const t = state.board[y][x];
    return t.type === TILE.COVER || t.type === TILE.RUBBLE;
  }

  _nearestEnemyDist(state, unit) {
    let min = 999;
    for (const e of state.units.filter(u => u.alive && u.team !== this.team))
      min = Math.min(min, this._cheb(unit.x, unit.y, e.x, e.y));
    return min;
  }

  _enemies(state) { return state.units.filter(u => u.alive && u.team !== this.team); }
  _allies(state)  { return state.units.filter(u => u.alive && u.team === this.team); }

  // ── Unit selection ───────────────────────────────────────

  _chooseUnit(state, units) {
    const gm  = state.gameMode;
    const obj = state.objectives;

    // Bomb – urgent: closest defender acts first when bomb is ticking
    if (gm === 'bomb' && obj) {
      const defTeam = obj.defenderTeam ?? (1 - (obj.attackerTeam ?? 0));
      const attTeam = obj.attackerTeam ?? 0;

      if (this.team === defTeam && obj.bombPlanted) {
        const site = obj.sites?.find(s => s.id === obj.activeSite && !s.defused);
        if (site) {
          const closest = units
            .filter(u => u.team === defTeam)
            .sort((a, b) =>
              this._dist(a.x, a.y, site.x, site.y) -
              this._dist(b.x, b.y, site.x, site.y)
            )[0];
          if (closest) return closest;
        }
      }
      // Bomb carrier acts first for attackers
      if (this.team === attTeam && obj.bomb && !obj.bombPlanted) {
        const carrier = units.find(u => obj.bomb.carriedBy === u.id);
        if (carrier) return carrier;
      }
    }

    // CTF – flag carrier acts first to score/flee
    if (gm === 'ctf' && obj?.flag) {
      const carrier = units.find(u => obj.flag.carriedBy === u.id);
      if (carrier) return carrier;
    }

    // VIP – VIP unit acts first to reach extraction
    if (gm === 'vip' && obj?.vipId && this.team === 0) {
      const vip = units.find(u => u.id === obj.vipId);
      if (vip) return vip;
    }

    // Default scoring
    let best = null, bestScore = -Infinity;
    for (const u of units) {
      const targets     = state.getValidTargets(u);
      const nearestDist = this._nearestEnemyDist(state, u);
      let score = 0;
      if (targets.length)          score += 80 - nearestDist;
      if (u.ability === 'sniper')  score += 15;
      if (u.ability === 'blast' && targets.length) score += 25;
      if (u.ability === 'command') score -= 5;
      if (u.pinned)                score -= 20;
      if (!this._isInCover(state, u.x, u.y) && nearestDist <= 6) score += 18;
      score += Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = u; }
    }
    return best || units[0];
  }

  // ── Top-level plan dispatcher ─────────────────────────────

  _planUnitActions(state, unit) {
    const gm  = state.gameMode;
    const obj = state.objectives;

    // ── BOMB ─────────────────────────────────────────────────
    if (gm === 'bomb' && obj) {
      const attTeam = obj.attackerTeam ?? 0;
      const defTeam = obj.defenderTeam ?? (1 - attTeam);

      if (unit.team === defTeam && obj.bombPlanted) {
        const site = obj.sites?.find(s => s.id === obj.activeSite && !s.defused);
        if (site) return this._bombDefusePlan(state, unit, site);
      }

      if (unit.team === defTeam && !obj.bombPlanted) {
        const carrier = this._enemies(state).find(e => obj.bomb?.carriedBy === e.id);
        if (carrier) {
          const tgts = state.getValidTargets(unit);
          if (tgts.some(t => t.id === carrier.id))
            return this._shootThenMove(state, unit, [carrier]);
          return this._interceptPlan(state, unit, carrier);
        }
        return this._standardPlan(state, unit);
      }

      if (unit.team === attTeam && obj.bomb?.carriedBy === unit.id && !obj.bombPlanted) {
        const site = obj.sites?.find(s => !s.planted);
        if (site) return this._bombCarryPlan(state, unit, site);
      }

      if (unit.team === attTeam && obj.bomb?.carriedBy === null && !obj.bombPlanted) {
        return this._bombPickupPlan(state, unit, obj.bomb);
      }

      return this._standardPlan(state, unit);
    }

    // ── CTF ──────────────────────────────────────────────────
    if (gm === 'ctf' && obj?.flag) {
      const flag = obj.flag;

      if (flag.carriedBy === unit.id)
        return this._ctfRunHomePlan(state, unit);

      if (flag.carriedBy === null) {
        const myDist    = this._dist(unit.x, unit.y, flag.x, flag.y);
        const isNearest = this._allies(state).every(a =>
          this._dist(a.x, a.y, flag.x, flag.y) >= myDist
        );
        if (isNearest) return this._ctfGrabFlagPlan(state, unit, flag);
      }

      if (flag.carriedBy !== null) {
        const carrier = this._enemies(state).find(e => e.id === flag.carriedBy);
        if (carrier) {
          const tgts = state.getValidTargets(unit);
          if (tgts.some(t => t.id === carrier.id))
            return this._shootThenMove(state, unit, [carrier]);
          return this._interceptPlan(state, unit, carrier);
        }
      }
    }

    // ── VIP ──────────────────────────────────────────────────
    if (gm === 'vip' && obj?.vipId) {
      if (this.team === 0) {
        if (unit.isVIP) return this._vipMovePlan(state, unit);
        return this._vipEscortPlan(state, unit);
      } else {
        const vip = state.getUnit(obj.vipId);
        if (vip && vip.alive) {
          const tgts = state.getValidTargets(unit);
          if (tgts.some(t => t.id === vip.id))
            return this._shootThenMove(state, unit, [vip]);
          return this._interceptPlan(state, unit, vip);
        }
      }
    }

    return this._standardPlan(state, unit);
  }

  // ── Standard elimination plan ─────────────────────────────

  _standardPlan(state, unit) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    const inCover     = this._isInCover(state, unit.x, unit.y);
    const nearestDist = this._nearestEnemyDist(state, unit);
    let targets       = state.getValidTargets(unit);

    // Move first to get into range/cover when we have no LOS but enemies are close
    const shouldMoveFirst = targets.length === 0 && nearestDist <= 12 && actionsLeft >= 2;
    if (shouldMoveFirst) {
      const dest = this._bestMovePosition(state, unit);
      if (dest) {
        const mr = state.getMovementRange(unit, false);
        if (mr.some(t => t.x === dest.x && t.y === dest.y)) {
          actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
          actionsLeft--;
          targets = state.getValidTargets(unit);
        }
      }
    }

    // Overwatch for snipers sitting in cover with no visible target
    if (unit.ability === 'overwatch' && targets.length === 0 &&
        inCover && nearestDist <= this._unitRange(unit) && actionsLeft >= 2) {
      actions.push({ type: 'overwatch', unitId: unit.id });
      actionsLeft -= 2;
    }

    // Shoot
    if (targets.length && actionsLeft >= 2) {
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
    } else if (targets.length && actionsLeft === 1) {
      actions.push({ type: 'shoot', unitId: unit.id,
                     targetId: this._pickTarget(state, unit, targets).id });
      actionsLeft--;
    }

    // Move after shooting if we haven't moved and still no LOS
    const hasMoved = actions.some(a => a.type === 'move');
    if (!hasMoved && actionsLeft >= 1 && targets.length === 0) {
      const dest = this._bestMovePosition(state, unit);
      if (dest) {
        const mr = state.getMovementRange(unit, false);
        if (mr.some(t => t.x === dest.x && t.y === dest.y)) {
          actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
          actionsLeft--;
        }
      }
    }

    // Take cover on a cover tile
    const lastMove = actions.filter(a => a.type === 'move').pop();
    const simX = lastMove ? lastMove.x : unit.x;
    const simY = lastMove ? lastMove.y : unit.y;
    const medicPending = unit.ability === 'heal' &&
      !state.revivedUnits.has(unit.id) &&
      this._findHealTarget(state, unit) !== null;
    if (actionsLeft >= 1 && this._isInCover(state, simX, simY) && !unit.inCover
        && !(actionsLeft === 1 && medicPending)) {
      actions.push({ type: 'cover', unitId: unit.id });
      actionsLeft--;
    }

    // Medic: heal adjacent allies, or move toward the nearest injured one
    if (unit.ability === 'heal' && actionsLeft >= 1 && !state.revivedUnits.has(unit.id)) {
      const ht = this._findHealTarget(state, unit);
      if (ht) {
        actions.push({ type: 'ability', unitId: unit.id, targetId: ht.id });
        actionsLeft--;
      } else if (!hasMoved && targets.length === 0) {
        // Move toward nearest injured ally
        const injured = this._allies(state).filter(a =>
          a.id !== unit.id && (a.hp < a.maxHp || a.pinned || !a.alive)
        ).sort((a, b) =>
          this._dist(unit.x, unit.y, a.x, a.y) - this._dist(unit.x, unit.y, b.x, b.y)
        );
        if (injured.length && actionsLeft >= 1) {
          const dest = this._moveTowardCover(state, unit, injured[0].x, injured[0].y);
          if (dest) {
            const mr = state.getMovementRange(unit, false);
            if (mr.some(t => t.x === dest.x && t.y === dest.y)) {
              actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
              actionsLeft--;
            }
          }
        }
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // Shoot priority targets then take cover
  _shootThenMove(state, unit, priorityTargets) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    const validIds = new Set(state.getValidTargets(unit).map(t => t.id));
    const targets  = priorityTargets.filter(t => validIds.has(t.id));

    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    } else if (targets.length && actionsLeft === 1) {
      actions.push({ type: 'shoot', unitId: unit.id,
                     targetId: this._pickTarget(state, unit, targets).id });
      actionsLeft--;
    }

    if (actionsLeft >= 1 && this._isInCover(state, unit.x, unit.y) && !unit.inCover)
      actions.push({ type: 'cover', unitId: unit.id });

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // Move toward a target, shooting en route
  _interceptPlan(state, unit, target) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    const allTargets = state.getValidTargets(unit);
    if (allTargets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, allTargets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    } else if (allTargets.length && actionsLeft === 1) {
      actions.push({ type: 'shoot', unitId: unit.id,
                     targetId: this._pickTarget(state, unit, allTargets).id });
      actionsLeft--;
    }

    if (actionsLeft >= 1) {
      const dest = this._moveTowardCover(state, unit, target.x, target.y);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
        if (this._isInCover(state, dest.x, dest.y) && !unit.inCover && actionsLeft >= 1)
          actions.push({ type: 'cover', unitId: unit.id });
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // ── Bomb plans ───────────────────────────────────────────

  _bombDefusePlan(state, unit, site) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    if (unit.x === site.x && unit.y === site.y) {
      actions.push({ type: 'defuse_bomb', unitId: unit.id });
      actions.push({ type: 'end',         unitId: unit.id });
      return actions;
    }

    // Shoot a blocker if we can still move after
    const targets = state.getValidTargets(unit);
    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    }

    if (actionsLeft >= 1) {
      const dest = this._moveTowardCover(state, unit, site.x, site.y);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
        if (dest.x === site.x && dest.y === site.y)
          actions.push({ type: 'defuse_bomb', unitId: unit.id });
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _bombCarryPlan(state, unit, site) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    if (unit.x === site.x && unit.y === site.y) {
      actions.push({ type: 'plant_bomb', unitId: unit.id });
      actions.push({ type: 'end',        unitId: unit.id });
      return actions;
    }

    const targets = state.getValidTargets(unit);
    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    }

    if (actionsLeft >= 1) {
      const dest = this._moveTowardCover(state, unit, site.x, site.y);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
        if (dest.x === site.x && dest.y === site.y)
          actions.push({ type: 'plant_bomb', unitId: unit.id });
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _bombPickupPlan(state, unit, bomb) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    if (unit.x === bomb.x && unit.y === bomb.y) {
      actions.push({ type: 'pickup_bomb', unitId: unit.id });
      actionsLeft--;
      const site = state.objectives?.sites?.find(s => !s.planted);
      if (site && actionsLeft >= 1) {
        const dest = this._moveTowardCover(state, unit, site.x, site.y);
        if (dest) actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
      }
      actions.push({ type: 'end', unitId: unit.id });
      return actions;
    }

    const targets = state.getValidTargets(unit);
    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    }

    if (actionsLeft >= 1) {
      const dest = this._moveToward(state, unit, bomb.x, bomb.y);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
        if (dest.x === bomb.x && dest.y === bomb.y)
          actions.push({ type: 'pickup_bomb', unitId: unit.id });
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // ── CTF plans ────────────────────────────────────────────

  _ctfRunHomePlan(state, unit) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    const baseX = unit.team === 0 ? 1 : CFG.COLS - 2;
    const baseY = Math.floor(CFG.ROWS / 2);

    // Move first — engine scores flag automatically on moveUnit
    if (actionsLeft >= 1) {
      const dest = this._moveToward(state, unit, baseX, baseY);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
      }
    }

    // Shoot any pursuers
    if (actionsLeft >= 2) {
      const targets = state.getValidTargets(unit);
      if (targets.length) {
        const best = this._pickTarget(state, unit, targets);
        actions.push({ type: 'aim',   unitId: unit.id });
        actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
        actionsLeft -= 2;
      }
    } else if (actionsLeft === 1) {
      const targets = state.getValidTargets(unit);
      if (targets.length) {
        actions.push({ type: 'shoot', unitId: unit.id,
                       targetId: this._pickTarget(state, unit, targets).id });
        actionsLeft--;
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _ctfGrabFlagPlan(state, unit, flag) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    const targets = state.getValidTargets(unit);
    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    }

    if (actionsLeft >= 1) {
      const dest = this._moveTowardCover(state, unit, flag.x, flag.y);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // ── VIP plans ────────────────────────────────────────────

  _vipMovePlan(state, unit) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;
    const obj = state.objectives;

    if (actionsLeft >= 1) {
      const dest = this._moveTowardCover(state, unit, obj.extractX, obj.extractY);
      if (dest) {
        actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
        actionsLeft--;
      }
    }

    if (actionsLeft >= 2) {
      const targets = state.getValidTargets(unit);
      if (targets.length) {
        const best = this._pickTarget(state, unit, targets);
        actions.push({ type: 'aim',   unitId: unit.id });
        actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
        actionsLeft -= 2;
      }
    } else if (actionsLeft === 1) {
      const targets = state.getValidTargets(unit);
      if (targets.length) {
        actions.push({ type: 'shoot', unitId: unit.id,
                       targetId: this._pickTarget(state, unit, targets).id });
        actionsLeft--;
      }
    }

    if (actionsLeft >= 1 && this._isInCover(state, unit.x, unit.y) && !unit.inCover)
      actions.push({ type: 'cover', unitId: unit.id });

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  _vipEscortPlan(state, unit) {
    const actions = [];
    let actionsLeft = MAX_ACTIONS;

    if ((unit.weaponJammed || unit.needsReload) && actionsLeft >= 1) {
      actions.push({ type: 'reload', unitId: unit.id });
      actionsLeft--;
    }

    if (unit.ability === 'heal' && actionsLeft >= 1 && !state.revivedUnits.has(unit.id)) {
      const ht = this._findHealTarget(state, unit);
      if (ht) { actions.push({ type: 'ability', unitId: unit.id, targetId: ht.id }); actionsLeft--; }
    }

    const targets = state.getValidTargets(unit);
    if (targets.length && actionsLeft >= 2) {
      const best = this._pickTarget(state, unit, targets);
      actions.push({ type: 'aim',   unitId: unit.id });
      actions.push({ type: 'shoot', unitId: unit.id, targetId: best.id });
      actionsLeft -= 2;
    } else if (targets.length && actionsLeft === 1) {
      actions.push({ type: 'shoot', unitId: unit.id,
                     targetId: this._pickTarget(state, unit, targets).id });
      actionsLeft--;
    }

    if (actionsLeft >= 1) {
      const vip     = state.getUnit(state.objectives?.vipId);
      const enemies = this._enemies(state);
      const nearestThreat = vip ? enemies.sort((a, b) =>
        this._dist(a.x, a.y, vip.x, vip.y) - this._dist(b.x, b.y, vip.x, vip.y)
      )[0] : null;
      const dest = nearestThreat
        ? this._moveTowardCover(state, unit, nearestThreat.x, nearestThreat.y)
        : this._bestMovePosition(state, unit);
      if (dest) {
        const mr = state.getMovementRange(unit, false);
        if (mr.some(t => t.x === dest.x && t.y === dest.y)) {
          actions.push({ type: 'move', unitId: unit.id, x: dest.x, y: dest.y });
          actionsLeft--;
          if (this._isInCover(state, dest.x, dest.y) && !unit.inCover && actionsLeft >= 1)
            actions.push({ type: 'cover', unitId: unit.id });
        }
      }
    }

    actions.push({ type: 'end', unitId: unit.id });
    return actions;
  }

  // ── Movement helpers ─────────────────────────────────────

  // Move toward (tx,ty) preferring cover and low exposure
  _moveTowardCover(state, unit, tx, ty) {
    const r = state.getMovementRange(unit, false);
    if (!r.length) return null;
    const enemies = this._enemies(state);
    let best = null, bestScore = -Infinity;
    for (const tile of r) {
      const dist     = this._dist(tile.x, tile.y, tx, ty);
      const inCover  = this._isInCover(state, tile.x, tile.y);
      const exposure = enemies.filter(e =>
        state.hasLOS(e.x, e.y, tile.x, tile.y) &&
        this._cheb(e.x, e.y, tile.x, tile.y) <= this._unitRange(e)
      ).length;
      const score = -dist * 2 + (inCover ? 10 : 0) - exposure * 6;
      if (score > bestScore) { bestScore = score; best = tile; }
    }
    return best;
  }

  // Move toward (tx,ty) by raw Manhattan distance only
  _moveToward(state, unit, tx, ty) {
    const r = state.getMovementRange(unit, false);
    if (!r.length) return null;
    let best = null, bestDist = Infinity;
    for (const t of r) {
      const d = this._dist(t.x, t.y, tx, ty);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    return best;
  }

  // Best general combat move position
  _bestMovePosition(state, unit) {
    const enemies = this._enemies(state);
    if (!enemies.length) return null;

    let nearestEnemy = null, minDist = Infinity;
    for (const e of enemies) {
      const d = this._dist(unit.x, unit.y, e.x, e.y);
      if (d < minDist) { minDist = d; nearestEnemy = e; }
    }
    if (!nearestEnemy) return null;

    const range     = state.getMovementRange(unit, false);
    if (!range.length) return null;
    const unitRange = this._unitRange(unit);

    let bestTile = null, bestScore = -Infinity;
    for (const tile of range) {
      const distToNearest = this._dist(tile.x, tile.y, nearestEnemy.x, nearestEnemy.y);
      const inCover       = this._isInCover(state, tile.x, tile.y);
      const exposure      = enemies.filter(e =>
        state.hasLOS(e.x, e.y, tile.x, tile.y) &&
        this._cheb(e.x, e.y, tile.x, tile.y) <= this._unitRange(e)
      ).length;
      const hasLOS = state.hasLOS(tile.x, tile.y, nearestEnemy.x, nearestEnemy.y);

      let score = 0;
      score -= distToNearest * 1.5;
      score += inCover       ? 22 : 0;
      score -= exposure      * 15;
      score += (distToNearest <= unitRange && hasLOS) ? 14 : 0;
      score += hasLOS        ? 5 : 0;
      score += Math.random() * 4;

      if (unit.ability === 'stealth'   && inCover)           score += 14;
      if (unit.ability === 'overwatch' && distToNearest < 6) score -= 12;
      if (unit.ability === 'sniper'    && distToNearest < 7) score -= 10;

      if (score > bestScore) { bestScore = score; bestTile = tile; }
    }
    return bestTile;
  }

  // ── Combat helpers ───────────────────────────────────────

  _pickTarget(state, unit, targets) {
    const obj = state.objectives;
    let best = null, bestScore = -Infinity;
    for (const t of targets) {
      const dist = this._cheb(unit.x, unit.y, t.x, t.y);
      const score =
          (t.hp <= 1                        ? 50 : 0)
        + (obj?.flag?.carriedBy  === t.id   ? 35 : 0)
        + (obj?.bomb?.carriedBy  === t.id   ? 35 : 0)
        + (t.id === obj?.vipId              ? 45 : 0)
        + (this._unitRange(unit) - dist)    *  2
        + (t.inCover                        ? -4 : 4);
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
          const occ = state.getUnitAt(t.x + dx, t.y + dy);
          if (!occ) continue;
          if (occ.team !== unit.team) count++;
          else hitsFriendly = true;
        }
      }
      if (!hitsFriendly && count > bestCount) { bestCount = count; bestTile = { x: t.x, y: t.y }; }
    }
    return bestTile;
  }

  _findHealTarget(state, medic) {
    let best = null, bestPriority = -1;
    for (const a of state.units.filter(u => u.team === this.team && u.id !== medic.id)) {
      const d = Math.max(Math.abs(medic.x - a.x), Math.abs(medic.y - a.y));
      if (d > 1) continue;
      const priority = (!a.alive ? 3 : 0) + (a.pinned ? 2 : 0) + (a.hp < a.maxHp ? 1 : 0);
      if (priority > 0 && priority > bestPriority) { bestPriority = priority; best = a; }
    }
    return best;
  }
}
