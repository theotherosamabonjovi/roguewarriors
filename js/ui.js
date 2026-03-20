// ============================================================
//  ROGUE WARRIORS DIGITAL — UI CONTROLLER
// ============================================================

const UI = {
  engine:      null,
  renderer:    null,
  ai:          null,
  mp:          null,
  mode:        'ai',      // ai | local | online
  myTeam:      0,
  armyDraft:   [[], []],  // squadDef arrays per player during build
  armyBudget:  10,        // point limit
  theme:       'urban',
  density:     'medium',
  rafId:       null,
  aiQueue:     [],
  aiRunning:   false,
  phase:       'menu',    // menu | army | battlefield | game
  diceHistory: [],
  waitingForAction: false,

  // ─── Screen management ──────────────────────────────────
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    this.phase = id.replace('screen-', '');
  },

  showNotif(msg, type = 'info') {
    const n = document.getElementById('notif');
    if (!n) return;
    n.textContent = msg;
    n.className   = 'notif notif-' + type;
    n.style.opacity = '1';
    setTimeout(() => { n.style.opacity = '0'; }, 3000);
  },

  // ─── Mode selection ─────────────────────────────────────
  startMode(mode) {
    this.mode    = mode;
    this.myTeam  = 0;
    this.armyDraft = [[], []];
    if (mode === 'online') { this.showScreen('screen-lobby'); return; }
    this.showScreen('screen-army');
    this.initArmyBuilder(0);
  },

  // ─── Army Builder ───────────────────────────────────────
  initArmyBuilder(playerIdx) {
    const p = playerIdx;
    document.getElementById('army-player-title').textContent =
      p === 0 ? '🔵 Alpha Team — Build Your Squad' : '🔴 Bravo Team — Build Your Squad';
    document.getElementById('army-squad-list').innerHTML = '';
    document.getElementById('army-budget-left').textContent = this._budgetLeft(p);
    document.getElementById('army-current-player').value   = p;
    this._renderArmyRoster(p);
  },

  _budgetLeft(p) {
    const used = this.armyDraft[p].reduce((s, t) => s + UNIT_DEFS[t].cost, 0);
    return this.armyBudget - used;
  },

  addUnitToSquad(type) {
    const p = parseInt(document.getElementById('army-current-player').value);
    const squad = this.armyDraft[p];
    if (squad.length >= CFG.MAX_SQUAD) { this.showNotif('Squad full! (max ' + CFG.MAX_SQUAD + ')', 'warn'); return; }
    const cost = UNIT_DEFS[type].cost;
    if (this._budgetLeft(p) < cost) { this.showNotif('Not enough points!', 'warn'); return; }
    // Enforce: at least 1 leader
    squad.push(type);
    this._renderArmyRoster(p);
    document.getElementById('army-budget-left').textContent = this._budgetLeft(p);
  },

  removeUnitFromSquad(idx) {
    const p = parseInt(document.getElementById('army-current-player').value);
    this.armyDraft[p].splice(idx, 1);
    this._renderArmyRoster(p);
    document.getElementById('army-budget-left').textContent = this._budgetLeft(p);
  },

  _renderArmyRoster(p) {
    const list = document.getElementById('army-squad-list');
    list.innerHTML = '';
    const squad = this.armyDraft[p];
    if (!squad.length) {
      list.innerHTML = '<div class="empty-squad">No units yet — add from the catalogue below</div>';
      return;
    }
    squad.forEach((type, i) => {
      const def = UNIT_DEFS[type];
      const li  = document.createElement('div');
      li.className = 'squad-member';
      li.innerHTML = `
        <span class="sm-icon" style="background:${def.color}">
          ${this._unitIcon(type)}
        </span>
        <span class="sm-name">${def.name}</span>
        <span class="sm-cost">${def.cost}pt</span>
        <button class="sm-remove" onclick="UI.removeUnitFromSquad(${i})">✕</button>
      `;
      list.appendChild(li);
    });
  },

  _unitIcon(type) {
    const icons = { rifleman:'🔫', sniper:'🎯', medic:'💉', grenadier:'💣', leader:'⭐', scout:'🏹' };
    return icons[type] || '👤';
  },

  confirmArmy(p) {
    const squad = this.armyDraft[p];
    if (squad.length < CFG.MIN_SQUAD) {
      this.showNotif(`Need at least ${CFG.MIN_SQUAD} units!`, 'warn'); return;
    }
    const hasLeader = squad.some(t => t === 'leader');
    if (!hasLeader) {
      this.showNotif('You need at least 1 Leader in your squad!', 'warn'); return;
    }
    if (this.mode === 'ai' || (this.mode === 'online' && p === this.myTeam)) {
      // AI builds its own squad
      if (this.mode === 'ai') {
        this.armyDraft[1] = this._buildAISquad();
      }
      this.showScreen('screen-battlefield');
      this.initBattlefieldSetup();
    } else if (this.mode === 'local' && p === 0) {
      // Switch to player 2 build
      this.initArmyBuilder(1);
    } else {
      this.showScreen('screen-battlefield');
      this.initBattlefieldSetup();
    }
  },

  _buildAISquad() {
    // Build a balanced AI squad within budget
    const budget = this.armyBudget;
    const squad  = ['leader', 'rifleman', 'rifleman', 'sniper'];
    let used = squad.reduce((s, t) => s + UNIT_DEFS[t].cost, 0);
    const extras = ['grenadier', 'scout', 'medic', 'rifleman'];
    for (const t of extras) {
      if (squad.length >= CFG.MAX_SQUAD) break;
      const c = UNIT_DEFS[t].cost;
      if (used + c <= budget) { squad.push(t); used += c; }
    }
    return squad;
  },

  // ─── Battlefield setup ──────────────────────────────────
  initBattlefieldSetup() {
    this.renderBattlefieldPreview();
  },

  renderBattlefieldPreview() {
    // Tiny preview canvas
    const eng = new Engine();
    eng.generateBoard(this.theme, this.density);
    const previewCanvas = document.getElementById('preview-canvas');
    if (!previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    const T   = 8; // tiny tile size for preview
    previewCanvas.width  = CFG.COLS * T;
    previewCanvas.height = CFG.ROWS * T;
    const thm = THEMES[this.theme];

    for (let r = 0; r < CFG.ROWS; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        const tile = eng.board[r][c];
        let color = (c + r) % 2 === 0 ? thm.base : thm.baseAlt;
        if (tile.type === TILE.BUILDING) color = thm.buildingColor;
        if (tile.type === TILE.COVER)    color = thm.coverColor;
        if (tile.type === TILE.RUBBLE)   color = '#6a5040';
        ctx.fillStyle = color;
        ctx.fillRect(c * T, r * T, T, T);
      }
    }
    this._previewEngine = eng;
  },

  setTheme(t) {
    this.theme = t;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-theme="${t}"]`);
    if (btn) btn.classList.add('active');
    this.renderBattlefieldPreview();
  },

  setDensity(d) {
    this.density = d;
    document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-density="${d}"]`);
    if (btn) btn.classList.add('active');
    this.renderBattlefieldPreview();
  },

  rerollBattlefield() {
    this.renderBattlefieldPreview();
  },

  startGame() {
    const eng  = this._previewEngine || new Engine();
    if (!this._previewEngine) eng.generateBoard(this.theme, this.density);

    eng.players[0].squadDef = this.armyDraft[0];
    eng.players[1].squadDef = this.armyDraft[1];
    eng.mode = this.mode;
    eng.deployUnits();

    this.engine   = eng;
    this.renderer = new Renderer('battlefield');
    if (this.mode === 'ai') this.ai = new AIPlayer(1);

    this.showScreen('screen-game');
    this._setupGameCanvas();
    this._updateAllPanels();
    this.startRenderLoop();

    if (this.mode === 'online') {
      this._setupMultiplayerCallbacks();
    }
  },

  // ─── Game canvas events ─────────────────────────────────
  _setupGameCanvas() {
    const canvas = document.getElementById('battlefield');
    canvas.addEventListener('mousemove', (e) => this._onHover(e));
    canvas.addEventListener('click',     (e) => this._onClick(e));
    canvas.addEventListener('mouseleave', () => {
      if (this.renderer) this.renderer.hoverTile = null;
    });
  },

  _onHover(e) {
    if (!this.renderer) return;
    const grid = this.renderer.screenToGrid(e.clientX, e.clientY);
    this.renderer.hoverTile = grid;
    // Show tooltip
    const unit = this.engine.getUnitAt(grid.x, grid.y);
    if (unit) this._showUnitTooltip(unit);
    else this._hideTooltip();
  },

  _onClick(e) {
    if (!this.engine || this.engine.phase !== 'playing') return;
    const state = this.engine;
    const grid  = this.renderer.screenToGrid(e.clientX, e.clientY);
    const { x, y } = grid;
    if (!state._inBounds(x, y)) return;

    const activeUnit = state.getActiveUnit();
    const clickedUnit = state.getUnitAt(x, y);

    // Waiting for ability target?
    if (this._abilityMode === 'heal') {
      if (clickedUnit && clickedUnit.team === state.currentPlayer &&
          this.renderer.healTargets.includes(clickedUnit.id)) {
        this._doHeal(activeUnit, clickedUnit);
      } else {
        this._cancelAbilityMode();
      }
      return;
    }

    if (this._abilityMode === 'blast') {
      // Grenadier blast target
      const inRange = this.renderer.attackHighlights.includes(clickedUnit?.id);
      if (inRange || this.engine.hasLOS(activeUnit.x, activeUnit.y, x, y)) {
        this._doBlast(activeUnit, x, y);
      } else {
        this._cancelAbilityMode();
      }
      return;
    }

    // No active unit: try to activate
    if (!activeUnit) {
      if (clickedUnit && clickedUnit.team === state.currentPlayer && clickedUnit.alive &&
          !state.activatedThisRound.has(clickedUnit.id)) {
        if (this.mode === 'online' && clickedUnit.team !== this.myTeam) return;
        state.activateUnit(clickedUnit);
        this.renderer.selectedUnit = clickedUnit;
        this._showMoveRange(clickedUnit, false);
        this._showAttackHighlights(clickedUnit);
        this._updateActionButtons(clickedUnit);
        this._updateAllPanels();
      }
      return;
    }

    // Active unit exists
    if (clickedUnit && clickedUnit.team === state.currentPlayer && clickedUnit.id !== activeUnit.id) {
      // Switch to a different friendly unit? End current activation first
      return;
    }

    // Click on enemy = shoot
    if (clickedUnit && clickedUnit.team !== state.currentPlayer && clickedUnit.alive) {
      const targets = state.getValidTargets(activeUnit);
      if (targets.some(t => t.id === clickedUnit.id) && state.actionsLeft >= 1 && !state.hasSprinted) {
        this._doShoot(activeUnit, clickedUnit);
        return;
      }
    }

    // Click on empty tile in move range = move
    if (!clickedUnit) {
      const inRange = this.renderer.moveHighlights.some(t => t.x === x && t.y === y);
      if (inRange && state.actionsLeft >= 1) {
        this._doMove(activeUnit, x, y);
        return;
      }
    }
  },

  // ─── Action execution ────────────────────────────────────
  _doMove(unit, x, y) {
    const state = this.engine;
    const sprint = state.hasMoved === false && state.actionsLeft >= 2;
    const sprintRange = state.getMovementRange(unit, true);
    const inSprintRange = sprintRange.some(t => t.x === x && t.y === y);
    const moveRange  = state.getMovementRange(unit, false);
    const inMoveRange = moveRange.some(t => t.x === x && t.y === y);

    if (!inMoveRange && !inSprintRange) return;
    const actualSprint = !inMoveRange && inSprintRange;

    state.moveUnit(unit, x, y);
    state.hasMoved = true;
    if (actualSprint) {
      state.hasSprinted = true;
      state.useAction(2);
    } else {
      state.useAction(1);
    }

    this._showMoveRange(unit, false);
    this._showAttackHighlights(unit);
    this._updateAllPanels();
    this._syncOnline({ type: 'move', unitId: unit.id, x, y, sprint: actualSprint });
  },

  _doShoot(attacker, target) {
    const state = this.engine;
    if (state.actionsLeft < 1 || state.hasSprinted) return;
    const result = state.resolveShoot(attacker, target);
    this.renderer.triggerFlash(target.id);
    this._showDiceResult(result);
    state.useAction(1);
    if (state.activeUnit) {
      this._showMoveRange(attacker, false);
      this._showAttackHighlights(attacker);
    }
    this._updateAllPanels();
    this._syncOnline({ type: 'shoot', unitId: attacker.id, targetId: target.id });
  },

  _doBlast(attacker, cx, cy) {
    const state = this.engine;
    if (state.actionsLeft < 2) return;
    state.resolveBlast(attacker, cx, cy);
    this.renderer.triggerFlash(attacker.id);
    state.useAction(2);
    this._cancelAbilityMode();
    this._updateAllPanels();
    this._syncOnline({ type: 'blast', unitId: attacker.id, x: cx, y: cy });
  },

  _doHeal(medic, target) {
    const state = this.engine;
    state.tryHeal(medic, target);
    state.useAction(1);
    this._cancelAbilityMode();
    this._updateAllPanels();
    this._syncOnline({ type: 'heal', unitId: medic.id, targetId: target.id });
  },

  _cancelAbilityMode() {
    this._abilityMode = null;
    this.renderer.healTargets      = [];
    this.renderer.attackHighlights = [];
    const unit = this.engine.getActiveUnit();
    if (unit) {
      this._showMoveRange(unit, false);
      this._showAttackHighlights(unit);
    }
  },

  // ─── Button actions ─────────────────────────────────────
  btnAim() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    unit.aiming   = true;
    state.isAiming = true;
    state.useAction(1);
    state.addLog(`🔭 ${unit.name} aims carefully…`, 'ability');
    this._updateAllPanels();
    if (state.activeUnit) this._showAttackHighlights(unit);
  },

  btnTakeCover() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    unit.inCover = true;
    state.addLog(`🛡️ ${unit.name} takes cover!`, 'ability');
    state.useAction(1);
    this._updateAllPanels();
  },

  btnSprint() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 2 || state.hasMoved) return;
    // Show sprint range (2x move)
    const sprintRange = state.getMovementRange(unit, true);
    this.renderer.moveHighlights = sprintRange;
    state.addLog(`${unit.name} sprinting — click destination`, 'move');
    state.hasSprinted = true;  // will be confirmed on move click
    this._updateActionButtons(unit);
  },

  btnAbility() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;

    switch (unit.ability) {
      case 'overwatch':
        state.setOverwatch(unit);
        state.useAction(2);
        this._syncOnline({ type: 'overwatch', unitId: unit.id });
        break;
      case 'heal': {
        // Show heal targets (adjacent allies)
        const nearby = state.units.filter(u =>
          u.team === unit.team && u.id !== unit.id &&
          Math.max(Math.abs(unit.x - u.x), Math.abs(unit.y - u.y)) <= 1 &&
          (!u.alive || u.suppressed)
        );
        if (!nearby.length) { this.showNotif('No allies in range to heal!', 'warn'); return; }
        this._abilityMode = 'heal';
        this.renderer.healTargets = nearby.map(u => u.id);
        state.addLog(`💉 ${unit.name}: click an adjacent ally to heal`, 'ability');
        break;
      }
      case 'blast': {
        // Show blast targets
        const targets = state.getValidTargets(unit);
        if (!targets.length) { this.showNotif('No targets in range!', 'warn'); return; }
        this._abilityMode = 'blast';
        this.renderer.attackHighlights = targets.map(t => t.id);
        state.addLog(`💥 ${unit.name}: click an enemy to throw grenade`, 'ability');
        break;
      }
      case 'stealth':
        state.addLog(`👻 ${unit.name} activates Stealth — hard to target in cover!`, 'ability');
        state.useAction(1);
        break;
      case 'command':
        state.addLog(`📣 ${unit.name} rallies the squad — Command Aura active!`, 'ability');
        state.useAction(1);
        break;
    }
    this._updateAllPanels();
  },

  btnCharge() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 2) return;
    // Find adjacent enemies
    const enemies = state.units.filter(u =>
      u.alive && u.team !== state.currentPlayer &&
      Math.max(Math.abs(unit.x - u.x), Math.abs(unit.y - u.y)) <= 1
    );
    if (!enemies.length) {
      this.showNotif('No adjacent enemies to charge!', 'warn'); return;
    }
    const target = enemies[0];
    const result = state.resolveMelee(unit, target);
    this._showMeleeResult(result);
    state.useAction(2);
    this._updateAllPanels();
    this._syncOnline({ type: 'charge', unitId: unit.id, targetId: target.id });
  },

  btnEndActivation() {
    const state = this.engine;
    if (!state.getActiveUnit()) return;
    state.endActivation();
    this.renderer.selectedUnit     = null;
    this.renderer.moveHighlights   = [];
    this.renderer.attackHighlights = [];
    this.renderer.healTargets      = [];
    this._abilityMode = null;
    this._updateAllPanels();
    this._syncOnline({ type: 'end' });

    if (state.phase === 'gameover') {
      this._showGameOver();
      return;
    }

    // Trigger AI if needed
    if (this.mode === 'ai' && state.currentPlayer === 1 && state.phase === 'playing') {
      setTimeout(() => this._runAI(), 600);
    }
  },

  // ─── AI loop ────────────────────────────────────────────
  _runAI() {
    if (!this.engine || this.engine.phase !== 'playing') return;
    if (this.engine.currentPlayer !== 1) return;

    const actions = this.ai.planTurn(this.engine);
    if (!actions.length) {
      this.engine.endActivation();
      this._updateAllPanels();
      return;
    }

    this.aiQueue   = actions;
    this.aiRunning = true;
    this._stepAI();
  },

  _stepAI() {
    if (!this.aiQueue.length || this.engine.phase !== 'playing') {
      this.aiRunning = false;
      this._updateAllPanels();
      // If AI's turn still continues, keep running
      if (this.engine.currentPlayer === 1 && this.engine.phase === 'playing') {
        setTimeout(() => this._runAI(), 500);
      }
      return;
    }

    const action = this.aiQueue.shift();
    const state  = this.engine;
    const unit   = state.getUnit(action.unitId);

    switch (action.type) {
      case 'move':
      case 'sprint':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit && state._inBounds(action.x, action.y)) {
          state.moveUnit(unit, action.x, action.y);
          if (action.sprint) { state.hasSprinted = true; state.useAction(2); }
          else state.useAction(1);
          this.renderer.selectedUnit = unit;
        }
        break;
      case 'aim':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { unit.aiming = true; state.useAction(1); }
        break;
      case 'shoot': {
        if (!state.getActiveUnit()) state.activateUnit(unit);
        const target = state.getUnit(action.targetId);
        if (unit && target && target.alive) {
          const result = state.resolveShoot(unit, target);
          this.renderer.triggerFlash(target.id);
          this._showDiceResult(result);
          state.useAction(1);
        }
        break;
      }
      case 'blast': {
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) {
          state.resolveBlast(unit, action.x, action.y);
          state.useAction(2);
        }
        break;
      }
      case 'heal': {
        if (!state.getActiveUnit()) state.activateUnit(unit);
        const healTarget = state.getUnit(action.targetId);
        if (unit && healTarget) { state.tryHeal(unit, healTarget); state.useAction(1); }
        break;
      }
      case 'overwatch':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.setOverwatch(unit); state.useAction(2); }
        break;
      case 'cover':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { unit.inCover = true; state.addLog(`🛡️ ${unit.name} takes cover!`, 'ability'); state.useAction(1); }
        break;
      case 'end':
        state.endActivation();
        this.renderer.selectedUnit = null;
        this.renderer.moveHighlights = [];
        this.renderer.attackHighlights = [];
        break;
    }

    this._updateAllPanels();

    if (state.phase === 'gameover') {
      this.aiRunning = false;
      setTimeout(() => this._showGameOver(), 1000);
      return;
    }

    setTimeout(() => this._stepAI(), this.ai.delay);
  },

  // ─── Online sync ────────────────────────────────────────
  _syncOnline(action) {
    if (this.mode === 'online' && this.mp) {
      this.mp.send(action);
    }
  },

  _setupMultiplayerCallbacks() {
    if (!this.mp) return;
    this.mp.onAction = (action) => this._handleRemoteAction(action);
  },

  _handleRemoteAction(action) {
    const state = this.engine;
    const unit  = state.getUnit(action.unitId);
    if (!unit) return;

    switch (action.type) {
      case 'move':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        state.moveUnit(unit, action.x, action.y);
        action.sprint ? (state.hasSprinted = true, state.useAction(2)) : state.useAction(1);
        break;
      case 'shoot': {
        if (!state.getActiveUnit()) state.activateUnit(unit);
        const t = state.getUnit(action.targetId);
        if (t) { const r = state.resolveShoot(unit, t); this._showDiceResult(r); state.useAction(1); }
        break;
      }
      case 'blast':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        state.resolveBlast(unit, action.x, action.y);
        state.useAction(2);
        break;
      case 'heal': {
        if (!state.getActiveUnit()) state.activateUnit(unit);
        const ht = state.getUnit(action.targetId);
        if (ht) { state.tryHeal(unit, ht); state.useAction(1); }
        break;
      }
      case 'overwatch':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        state.setOverwatch(unit); state.useAction(2);
        break;
      case 'end':
        state.endActivation();
        this.renderer.selectedUnit = null;
        this.renderer.moveHighlights = [];
        break;
    }
    this._updateAllPanels();
    if (state.phase === 'gameover') this._showGameOver();
  },

  // ─── Render loop ────────────────────────────────────────
  startRenderLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const loop = () => {
      if (this.engine && this.renderer) {
        this.renderer.draw(this.engine);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  },

  // ─── UI helpers ─────────────────────────────────────────
  _showMoveRange(unit, sprint) {
    const range = this.engine.getMovementRange(unit, sprint);
    this.renderer.moveHighlights = range;
  },

  _showAttackHighlights(unit) {
    const targets = this.engine.getValidTargets(unit);
    this.renderer.attackHighlights = targets.map(t => t.id);
  },

  _updateAllPanels() {
    this._updateTurnBanner();
    this._updateActionButtons(this.engine?.getActiveUnit());
    this._updateTeamPanels();
    this._updateLog();
  },

  _updateTurnBanner() {
    const state = this.engine;
    if (!state) return;
    const banner = document.getElementById('turn-banner');
    if (!banner) return;
    if (state.phase === 'gameover') {
      banner.innerHTML = `🏆 <strong>${state.players[state.winner].name} Wins!</strong> — Round ${state.turn}`;
      banner.className = 'turn-banner gameover';
      return;
    }
    const cp   = state.currentPlayer;
    const name = state.players[cp].name;
    const active = state.getActiveUnit();
    banner.innerHTML = active
      ? `Round ${state.turn} — <span style="color:${TEAM_COLORS[cp]}">${name}</span> — Activating: <strong>${active.name}</strong> (${state.actionsLeft} action${state.actionsLeft !== 1 ? 's' : ''} left)`
      : `Round ${state.turn} — <span style="color:${TEAM_COLORS[cp]}">${name}</span> — Click a unit to activate`;
    banner.className = `turn-banner team-${cp}`;
  },

  _updateActionButtons(unit) {
    const state = this.engine;
    if (!state) return;
    const btns = document.getElementById('action-buttons');
    if (!btns) return;

    const isMyTurn = this.mode !== 'online' || state.currentPlayer === this.myTeam;
    const hasUnit  = !!unit;
    const al       = state.actionsLeft;
    const phase    = state.phase;

    btns.innerHTML = '';
    if (phase !== 'playing' || !hasUnit || !isMyTurn) {
      if (phase === 'playing' && isMyTurn && !hasUnit) {
        btns.innerHTML = '<div class="hint-text">👆 Click one of your units to activate it</div>';
      }
      return;
    }

    const targets  = state.getValidTargets(unit);
    const canShoot = targets.length > 0 && al >= 1 && !state.hasSprinted;

    const addBtn = (id, label, icon, enabled, tooltip = '') => {
      const b = document.createElement('button');
      b.className = 'action-btn' + (enabled ? '' : ' disabled');
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.title     = tooltip;
      if (enabled) b.onclick = () => UI[id]?.();
      btns.appendChild(b);
    };

    addBtn('_doMoveBtn',     'Move',       '👣', al >= 1 && !state.hasSprinted, 'Move up to your Move value');
    addBtn('btnSprint',      'Sprint',     '🏃', al >= 2 && !state.hasMoved, '2× movement, no shooting');
    addBtn('btnAim',         'Aim',        '🔭', al >= 1 && canShoot, '+1 to hit on next shot');
    addBtn('_doShootBtn',    'Shoot',      '🎯', canShoot, 'Attack an enemy in range (click enemy on map)');
    addBtn('btnCharge',      'Charge',     '⚔️', al >= 2, 'Melee attack adjacent enemy');
    addBtn('btnTakeCover',   'Take Cover', '🛡️', al >= 1, '+1 Defense until next activation');
    if (unit.ability) {
      const abilityLabels = { overwatch:'Overwatch', heal:'Heal', blast:'Grenade', stealth:'Stealth', command:'Command', sniper:'Overwatch' };
      addBtn('btnAbility', abilityLabels[unit.ability] || 'Ability', '⚡', al >= 1 && !state.abilityUsed?.has(unit.id), 'Use specialist ability');
    }
    // End activation button
    const endBtn = document.createElement('button');
    endBtn.className = 'action-btn end-btn';
    endBtn.innerHTML = '✅<span>End</span>';
    endBtn.onclick   = () => UI.btnEndActivation();
    btns.appendChild(endBtn);
  },

  _doMoveBtn() {
    const unit = this.engine?.getActiveUnit();
    if (!unit) return;
    this._showMoveRange(unit, false);
    this.engine.addLog('Click a highlighted tile to move', 'system');
  },

  _doShootBtn() {
    const unit = this.engine?.getActiveUnit();
    if (!unit) return;
    this._showAttackHighlights(unit);
    this.engine.addLog('Click a highlighted enemy to shoot', 'system');
  },

  _updateTeamPanels() {
    const state = this.engine;
    if (!state) return;
    [0, 1].forEach(t => {
      const panel = document.getElementById(`team-panel-${t}`);
      if (!panel) return;
      const units = state.units.filter(u => u.team === t);
      panel.innerHTML = `<div class="team-header" style="color:${TEAM_COLORS[t]}">${state.players[t].name}</div>`;
      units.forEach(u => {
        const div = document.createElement('div');
        div.className = 'unit-row' +
          (!u.alive ? ' unit-dead' : '') +
          (state.activatedThisRound.has(u.id) ? ' unit-activated' : '') +
          (state.activeUnit === u.id ? ' unit-active' : '');
        div.innerHTML = `
          <span class="ur-icon" style="background:${UNIT_DEFS[u.type].color}">${this._unitIcon(u.type)}</span>
          <span class="ur-name">${u.name}</span>
          <span class="ur-status">${!u.alive ? '💀' : u.suppressed ? '😵' : u.inCover ? '🛡️' : '✅'}</span>
        `;
        if (u.alive) div.onclick = () => {
          if (u.team === state.currentPlayer && !state.activatedThisRound.has(u.id) && !state.getActiveUnit()) {
            if (state.activateUnit(u)) {
              this.renderer.selectedUnit = u;
              this._showMoveRange(u, false);
              this._showAttackHighlights(u);
              this._updateAllPanels();
            }
          }
        };
        panel.appendChild(div);
      });
    });
  },

  _updateLog() {
    const state = this.engine;
    const logEl = document.getElementById('combat-log');
    if (!logEl || !state) return;
    const last = state.log.slice(-18);
    logEl.innerHTML = last.map(e => `<div class="log-${e.type}">${e.text}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  },

  // ─── Dice display ────────────────────────────────────────
  _showDiceResult(result) {
    const panel = document.getElementById('dice-panel');
    if (!panel) return;

    const attUnit  = this.engine.getUnit(result.attacker);
    const defUnit  = this.engine.getUnit(result.target);
    const atkName  = attUnit?.name || '?';
    const defName  = defUnit?.name || '?';

    let html = `<div class="dice-result">`;
    html += `<div class="dr-title">${atkName} → ${defName}</div>`;
    html += `<div class="dr-dice">`;
    result.rolls.forEach((r, i) => {
      const hit = r >= result.targetNum;
      html += `<div class="die ${hit ? 'die-hit' : 'die-miss'}">${r}</div>`;
    });
    html += `</div>`;
    html += `<div class="dr-info">Need: ${result.targetNum}+ · Hits: ${result.hitCount}</div>`;
    if (result.saves.length) {
      html += `<div class="dr-saves">Saves: `;
      result.saves.forEach(s => {
        html += `<span class="die die-small ${s >= (defUnit?.defense || 4) ? 'die-save' : 'die-hit'}">${s}</span>`;
      });
      html += `</div>`;
    }
    if (result.wounds > 0) {
      html += `<div class="dr-outcome wound">💀 ${result.wounds} wound${result.wounds > 1 ? 's' : ''}!</div>`;
    } else if (result.hitCount > 0) {
      html += `<div class="dr-outcome saved">🛡️ Saved!</div>`;
    } else {
      html += `<div class="dr-outcome miss">Miss!</div>`;
    }
    if (result.hasLeaderAura) {
      html += `<div class="dr-bonus">⭐ Leader Aura reroll used</div>`;
    }
    html += `</div>`;
    panel.innerHTML = html;
    this.diceHistory.unshift(result);
  },

  _showMeleeResult(result) {
    const panel = document.getElementById('dice-panel');
    if (!panel) return;
    const atkUnit = this.engine.getUnit(result.winner?.id || '');
    panel.innerHTML = `
      <div class="dice-result">
        <div class="dr-title">⚔️ Melee Combat</div>
        <div class="dr-dice">
          <div class="die die-hit">${result.aRoll}</div>
          <span style="padding:0 6px">vs</span>
          <div class="die die-miss">${result.dRoll}</div>
        </div>
        <div class="dr-outcome ${result.winner ? 'wound' : 'miss'}">${
          result.winner ? `${result.winner.name} wins!` : 'Tied!'
        }</div>
      </div>`;
  },

  // ─── Tooltips ────────────────────────────────────────────
  _showUnitTooltip(unit) {
    const tt = document.getElementById('tooltip');
    if (!tt) return;
    const def = UNIT_DEFS[unit.type];
    tt.innerHTML = `
      <strong>${unit.name}</strong> (${this.engine.players[unit.team].name})<br>
      HP: ${unit.hp}/${unit.maxHp} · Move: ${unit.move} · Skill: ${unit.skill}+<br>
      Range: ${unit.range} · Defense: ${unit.defense}<br>
      ${unit.suppressed ? '😵 Suppressed · ' : ''}${unit.inCover ? '🛡️ In Cover' : ''}
      ${def.desc}
    `;
    tt.style.display = 'block';
  },

  _hideTooltip() {
    const tt = document.getElementById('tooltip');
    if (tt) tt.style.display = 'none';
  },

  // ─── Game over ───────────────────────────────────────────
  _showGameOver() {
    const state   = this.engine;
    const winner  = state.winner;
    const overlay = document.getElementById('gameover-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.getElementById('go-title').textContent  = `${state.players[winner].name} Wins!`;
    document.getElementById('go-subtitle').textContent = `Victory after ${state.turn} rounds of combat`;
    const alive0 = state.units.filter(u => u.alive && u.team === 0).length;
    const alive1 = state.units.filter(u => u.alive && u.team === 1).length;
    document.getElementById('go-stats').innerHTML =
      `Alpha Team: ${alive0} survivors · Bravo Team: ${alive1} survivors`;
  },

  playAgain() {
    document.getElementById('gameover-overlay').style.display = 'none';
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.engine    = null;
    this.renderer  = null;
    this.aiQueue   = [];
    this.aiRunning = false;
    this.showScreen('screen-menu');
  },

  // ─── Multiplayer lobby ───────────────────────────────────
  initMultiplayer() {
    this.mp = new MultiplayerManager();
  },

  hostGame() {
    this.initMultiplayer();
    this.myTeam = 0;
    this.mp.host(
      (code) => {
        document.getElementById('room-code-display').textContent = code;
        document.getElementById('lobby-status').textContent = 'Waiting for opponent to join…';
      },
      () => {
        document.getElementById('lobby-status').textContent = '✅ Opponent connected! Starting army builder…';
        setTimeout(() => { this.showScreen('screen-army'); this.initArmyBuilder(0); }, 1000);
      }
    );
  },

  joinGame() {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) { this.showNotif('Enter a room code!', 'warn'); return; }
    this.initMultiplayer();
    this.myTeam = 1;
    this.mp.join(code,
      () => {
        document.getElementById('lobby-status').textContent = '✅ Connected! Starting army builder…';
        setTimeout(() => { this.showScreen('screen-army'); this.initArmyBuilder(1); }, 1000);
      }
    );
  },

  // ─── How to play ────────────────────────────────────────
  showHowToPlay() {
    this.showScreen('screen-howtoplay');
  },
};
