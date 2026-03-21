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
  gameMode:    'elimination',  // elimination | ctf | bomb | vip
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
    if (this.mode === 'online') {
      // Each player sends their squad AND a 'ready' flag.
      // Neither side advances to the battlefield until BOTH have sent 'ready'.
      // This prevents one player from clicking through to the map-select screen
      // while the other is still picking units.
      const myTeamIdx = this.mp?.isHost ? 0 : 1;
      this.armyDraft[myTeamIdx] = squad;
      this._onlineReady = (this._onlineReady || 0) | (1 << myTeamIdx); // mark self ready
      this._syncOnline({ type: 'squadReady', units: squad });
      document.getElementById('army-confirm-btn') &&
        (document.getElementById('army-confirm-btn').disabled = true);
      this.showNotif('Squad locked — waiting for opponent…', 'info');
      // If both happened to click ready before the message round-tripped
      // (e.g. single machine testing), check now.
      if ((this._onlineReady & 3) === 3) this._bothSquadsReady();
    } else if (this.mode === 'ai' || p === this.myTeam) {
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

  // Called when both players have confirmed their squads.  Advances to the
  // battlefield selection screen.  Resets the ready flag for next time.
  _bothSquadsReady() {
    this._onlineReady = 0;
    this.showScreen('screen-battlefield');
    this.initBattlefieldSetup();
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

  setGameMode(gm) {
    this.gameMode = gm;
    document.querySelectorAll('.gamemode-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-gamemode="${gm}"]`);
    if (btn) btn.classList.add('active');
  },

  // ─── Map editor ─────────────────────────────────────────
  _editorBrush:    'open',
  _editorPainting: false,

  openMapEditor() {
    const overlay = document.getElementById('map-editor-overlay');
    overlay.style.display = 'flex';
    this._renderEditorCanvas();
  },

  closeMapEditor() {
    document.getElementById('map-editor-overlay').style.display = 'none';
    // Re-render the small preview with updated map
    if (this._previewEngine) this._renderPreviewFromEngine(this._previewEngine);
  },

  setEditorBrush(brush) {
    this._editorBrush = brush;
    document.querySelectorAll('.editor-brush-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-brush="${brush}"]`);
    if (btn) btn.classList.add('active');
  },

  _renderEditorCanvas() {
    const eng     = this._previewEngine;
    if (!eng) return;
    const canvas  = document.getElementById('editor-canvas');
    const T       = 30; // editor tile size
    canvas.width  = CFG.COLS * T;
    canvas.height = CFG.ROWS * T;
    const ctx     = canvas.getContext('2d');
    const theme   = THEMES[eng.theme];

    const drawAll = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < CFG.ROWS; r++) {
        for (let c = 0; c < CFG.COLS; c++) {
          const tile = eng.board[r][c];
          let color  = (c + r) % 2 === 0 ? theme.base : theme.baseAlt;
          if (tile.type === TILE.BUILDING) color = theme.buildingColor;
          if (tile.type === TILE.COVER)    color = theme.coverColor;
          if (tile.type === TILE.RUBBLE)   color = '#6a5040';
          ctx.fillStyle = color;
          ctx.fillRect(c * T, r * T, T, T);
          ctx.strokeStyle = 'rgba(0,0,0,0.15)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * T + 0.5, r * T + 0.5, T - 1, T - 1);
        }
      }
      // Deploy zone tint
      ctx.fillStyle = 'rgba(58,158,255,0.12)';
      ctx.fillRect(0, 0, T * 4, CFG.ROWS * T);
      ctx.fillStyle = 'rgba(255,69,69,0.12)';
      ctx.fillRect(T * (CFG.COLS - 4), 0, T * 4, CFG.ROWS * T);
    };

    drawAll();
    canvas._drawAll = drawAll;
    canvas._eng     = eng;
    canvas._T       = T;

    // Attach paint events (only once per open)
    if (!canvas._editorReady) {
      canvas._editorReady = true;

      const paint = (e) => {
        if (!this._editorPainting) return;
        const rect = canvas.getBoundingClientRect();
        const sx   = (e.touches ? e.touches[0].clientX : e.clientX);
        const sy   = (e.touches ? e.touches[0].clientY : e.clientY);
        const c    = Math.floor((sx - rect.left) / (canvas._T * (rect.width  / canvas.width)));
        const r    = Math.floor((sy - rect.top)  / (canvas._T * (rect.height / canvas.height)));
        if (c < 0 || r < 0 || c >= CFG.COLS || r >= CFG.ROWS) return;
        // Don't paint in deploy zones
        if (c <= 3 || c >= CFG.COLS - 4) return;

        const brush = this._editorBrush;
        const board = canvas._eng.board;
        const bldgs = canvas._eng.buildings;
        const cov   = canvas._eng.coverObjs;

        if (brush === 'open') {
          board[r][c] = { type: TILE.OPEN, buildingId: -1, coverId: -1 };
        } else if (brush === 'building') {
          board[r][c] = { type: TILE.BUILDING, buildingId: 999, coverId: -1 };
        } else if (brush === 'cover') {
          const id = cov.length;
          cov.push({ id, x: c, y: r, type: 'barrier' });
          board[r][c] = { type: TILE.COVER, buildingId: -1, coverId: id };
        } else if (brush === 'rubble') {
          board[r][c] = { type: TILE.RUBBLE, buildingId: -1, coverId: -1 };
        }
        canvas._drawAll();
      };

      canvas.addEventListener('mousedown',  (e) => { this._editorPainting = true;  paint(e); });
      canvas.addEventListener('mousemove',  (e) => { paint(e); });
      canvas.addEventListener('mouseup',    ()  => { this._editorPainting = false; });
      canvas.addEventListener('mouseleave', ()  => { this._editorPainting = false; });
    }
  },

  _renderPreviewFromEngine(eng) {
    const previewCanvas = document.getElementById('preview-canvas');
    if (!previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    const T   = 8;
    previewCanvas.width  = CFG.COLS * T;
    previewCanvas.height = CFG.ROWS * T;
    const thm = THEMES[eng.theme];
    for (let r = 0; r < CFG.ROWS; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        const tile = eng.board[r][c];
        let color  = (c + r) % 2 === 0 ? thm.base : thm.baseAlt;
        if (tile.type === TILE.BUILDING) color = thm.buildingColor;
        if (tile.type === TILE.COVER)    color = thm.coverColor;
        if (tile.type === TILE.RUBBLE)   color = '#6a5040';
        ctx.fillStyle = color;
        ctx.fillRect(c * T, r * T, T, T);
      }
    }
  },

  rerollBattlefield() {
    this.renderBattlefieldPreview();
  },

  startGame() {
    const eng  = this._previewEngine || new Engine();
    if (!this._previewEngine) eng.generateBoard(this.theme, this.density);

    eng.players[0].squadDef = this.armyDraft[0];
    eng.players[1].squadDef = this.armyDraft[1];
    eng.mode     = this.mode;
    eng.gameMode = this.gameMode || 'elimination';

    this.engine   = eng;
    this.renderer = new Renderer('battlefield');
    if (this.mode === 'ai') this.ai = new AIPlayer(1);

    this.showScreen('screen-game');
    this._setupGameCanvas();
    this.startRenderLoop();

    // Wire multiplayer callbacks now that the engine exists
    // Note: _setupMultiplayerCallbacks() is called in hostGame/joinGame's
    // onConnect handler so it is wired before the army-builder squad messages
    // fly, not here where it would be too late.

    // Tell the renderer which team is local so it can hide the opponent's
    // deploy positions until the battle starts.
    if (this.mode === 'online') {
      this.renderer._onlineMyTeam = this.myTeam;
    }

    // Start interactive deployment
    eng.startDeploy();
    this._enterDeployPhase();

    // Synchronise engines over the network.
    // Both sides send a message so whichever player clicks "Deploy & Fight"
    // second will always get/send the authoritative state:
    //   Host  : sends 'init' immediately AND handles 'requestInit' replies.
    //   Joiner: sends 'requestInit' so the host re-sends if host was first.
    // This covers both orderings without a race.
    if (this.mode === 'online') {
      if (this.mp?.isHost) {
        // Host proactively pushes their engine to whoever is already listening
        this._syncOnline({ type: 'init', state: eng.serialize() });
      } else {
        // Joiner asks for the host's engine in case the host isn't ready yet
        this._syncOnline({ type: 'requestInit' });
      }
    }
  },

  // ─── Deployment phase UI ─────────────────────────────────
  _deploySelectedUnit: null,

  _enterDeployPhase() {
    const state = this.engine;
    // Show deploy panel, hide actions panel
    document.getElementById('deploy-section').style.display  = 'flex';
    document.getElementById('actions-section').style.display = 'none';
    document.getElementById('stats-section').style.display   = 'none';

    // In online mode both deploy simultaneously — always show own team panel
    const deployTeam = (this.mode === 'online') ? this.myTeam : state.deployingTeam;
    this._renderDeployPanel(deployTeam);
    this._updateDeployBanner();
    this._updateTeamPanels();
    this._updateLog();

    // Show deploy zone highlights for the local player's team only
    this.renderer.deployHighlights = state.deployZone(deployTeam);
    this._deploySelectedUnit = null;
  },

  _renderDeployPanel(team) {
    const state  = this.engine;
    const panel  = document.getElementById('deploy-panel');
    const doneBtn = document.getElementById('deploy-done-btn');
    const title  = document.getElementById('deploy-panel-title');
    const icons  = { rifleman:'🔫', sniper:'🎯', medic:'💉', grenadier:'💣', leader:'⭐', scout:'🏹' };

    const color = team === 0 ? '#3a9eff' : '#ff4545';
    title.textContent = `PLACE ${state.players[team].name.toUpperCase()}`;
    title.style.color = color;

    const units = state.units.filter(u => u.team === team);
    panel.innerHTML = '';

    units.forEach(u => {
      const card = document.createElement('div');
      card.className = 'deploy-unit-card' +
        (u.deployed ? ' placed' : '') +
        (this._deploySelectedUnit?.id === u.id ? ' selected' : '');
      card.dataset.uid = u.id;
      card.innerHTML = `
        <div class="duc-icon" style="background:${UNIT_DEFS[u.type].color}">${icons[u.type]}</div>
        <div class="duc-info">
          <div class="duc-name">${u.name}</div>
          <div class="duc-sub">${u.deployed ? '✅ Placed' : 'Click to select'}</div>
        </div>
      `;
      if (!u.deployed) {
        card.addEventListener('click', () => this._selectDeployUnit(u));
      }
      panel.appendChild(card);
    });

    // Enable Done button only when all units of this team are deployed.
    // Always reset text in case a previous session left it as "Waiting…".
    const allPlaced = units.every(u => u.deployed);
    doneBtn.textContent = '✅ Done Deploying';
    doneBtn.disabled = !allPlaced || !!this._localDeployDone;
  },

  _selectDeployUnit(unit) {
    this._deploySelectedUnit = unit;
    this._renderDeployPanel(unit.team);
    // Refresh valid tiles (exclude now-occupied spots)
    this.renderer.deployHighlights = this.engine.deployZone(unit.team);
    this.engine.addLog(`Selected ${unit.name} — click a yellow tile to place`, 'system');
    this._updateLog();
  },

  _handleDeployClick(x, y) {
    const state = this.engine;
    // In online mode both players deploy simultaneously — use myTeam, not deployingTeam.
    const team  = (this.mode === 'online') ? this.myTeam : state.deployingTeam;

    // Click on already-placed friendly unit = pick it back up
    const existingUnit = state.getUnitAt(x, y);
    if (existingUnit && existingUnit.team === team) {
      state.unplaceUnit(existingUnit);
      this._deploySelectedUnit = existingUnit;
      this.renderer.deployHighlights = state.deployZone(team);
      this._renderDeployPanel(team);
      this._updateLog();
      return;
    }

    if (!this._deploySelectedUnit) {
      this.showNotif('Select a unit from the left panel first', 'warn');
      return;
    }

    const ok = state.placeUnit(this._deploySelectedUnit, x, y);
    if (ok) {
      this._deploySelectedUnit = null;
      this.renderer.deployHighlights = state.deployZone(team);
      this._renderDeployPanel(team);
      this._updateTeamPanels();
      this._updateDeployBanner();
      this._updateLog();
    } else {
      this.showNotif('Cannot place there — pick a highlighted tile in your zone', 'warn');
    }
  },

  finishDeployment() {
    const state = this.engine;
    // In online mode both players deploy simultaneously, so use myTeam.
    const team  = (this.mode === 'online') ? this.myTeam : state.deployingTeam;
    const unplaced = state.units.filter(u => u.team === team && !u.deployed);
    if (unplaced.length) { this.showNotif('Place all your units first!', 'warn'); return; }

    if (this.mode === 'online') {
      // Mark local deploy done and send positions.
      // Don't call finishTeamDeploy() yet — battle only starts when BOTH sides
      // have confirmed.  The deployDone handler will start battle when ready.
      this._localDeployDone = true;
      const deployedUnits = state.units
        .filter(u => u.team === this.myTeam && u.deployed)
        .map(u => ({ id: u.id, x: u.x, y: u.y }));
      this._syncOnline({ type: 'deployDone', units: deployedUnits });
      // Update button and banner to show we're waiting
      const doneBtn = document.getElementById('deploy-done-btn');
      if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = '⏳ Waiting for opponent…'; }
      document.getElementById('lobby-status') &&
        (document.getElementById('lobby-status').textContent = '');
      // Check immediately in case remoteDeployDone arrived first
      if (this._remoteDeployDone) this._startBattleOnline();
      return;
    }

    // Local / AI modes: sequential deploy as before
    state.finishTeamDeploy();
    if (state.phase === 'playing') {
      this._exitDeployPhase();
    } else {
      if (this.mode === 'ai' && state.deployingTeam === 1) {
        state.autoDeployTeam(1);
        state.finishTeamDeploy();
        this._exitDeployPhase();
      } else {
        this._enterDeployPhase();
      }
    }
  },

  // Called when both players have finished deploying in online mode.
  _startBattleOnline() {
    const state = this.engine;
    this._localDeployDone  = false;
    this._remoteDeployDone = false;
    // Ensure the engine is in playing state — call _beginBattle directly
    // since both squads are placed and we're bypassing the sequential deploy.
    if (state.phase !== 'playing') {
      // Force both teams' deployingTeam flags done then start battle
      state.deployingTeam = 0; state.finishTeamDeploy(); // → deployingTeam=1
      state.finishTeamDeploy(); // → _beginBattle
    }
    this._exitDeployPhase();
  },

  _exitDeployPhase() {
    document.getElementById('deploy-section').style.display  = 'none';
    document.getElementById('actions-section').style.display = 'block';
    document.getElementById('stats-section').style.display   = 'flex';
    this.renderer.deployHighlights = [];
    this.renderer._onlineMyTeam    = null; // reveal all units now that battle starts
    this._deploySelectedUnit = null;
    this._localDeployDone  = false;
    this._remoteDeployDone = false;
    this._updateAllPanels();
    this._checkAITurn();
  },

  _updateDeployBanner() {
    const state  = this.engine;
    const banner = document.getElementById('turn-banner');
    if (!banner || state.phase !== 'deploy') return;
    // In online mode both players deploy simultaneously — show the local
    // player's own team name and progress, not the sequential deployingTeam.
    const team  = (this.mode === 'online') ? this.myTeam : state.deployingTeam;
    const color = TEAM_COLORS[team];
    const placed = state.units.filter(u => u.team === team && u.deployed).length;
    const total  = state.units.filter(u => u.team === team).length;
    const waitMsg = (this.mode === 'online' && this._localDeployDone)
      ? ' — ⏳ Waiting for opponent…' : '';
    banner.innerHTML = `⚔ Deploy Phase — <span style="color:${color}">${state.players[team].name}</span> — Place your units (${placed}/${total} placed)${waitMsg}`;
    banner.className = `turn-banner team-${team}`;
  },

  // ─── Game canvas events ─────────────────────────────────
  _canvasListenersAttached: false,

  _setupGameCanvas() {
    if (this._canvasListenersAttached) return;  // only attach once ever
    this._canvasListenersAttached = true;
    const canvas = document.getElementById('battlefield');
    canvas.addEventListener('mousemove',  (e) => this._onHover(e));
    canvas.addEventListener('click',      (e) => this._onClick(e));
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
    if (!this.engine) return;
    const state = this.engine;
    const grid  = this.renderer.screenToGrid(e.clientX, e.clientY);
    const { x, y } = grid;
    if (!state._inBounds(x, y)) return;

    // Deploy phase
    if (state.phase === 'deploy') {
      // Only let the current deploying team's human interact
      // In online mode each player deploys simultaneously — guard by unit ownership, not deployingTeam.
      const isMyDeploy = this.mode !== 'online' || true;
      if (isMyDeploy) this._handleDeployClick(x, y);
      return;
    }

    if (state.phase !== 'playing') return;

    const activeUnit = state.getActiveUnit();
    const clickedUnit = state.getUnitAt(x, y);

    // Waiting for ability target?
    if (this._abilityMode === 'heal') {
      // getUnitAt only returns alive units, but the medic can click a dead
      // unit's tile to revive them — so we fall back to a dead-unit lookup.
      const healClick = clickedUnit ||
        state.units.find(u => !u.alive && u.x === x && u.y === y) || null;
      if (healClick && healClick.team === state.currentPlayer &&
          this.renderer.healTargets.includes(healClick.id)) {
        this._doHeal(activeUnit, healClick);
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
    // Click on the SAME unit → deselect it
    if (clickedUnit && clickedUnit.id === activeUnit.id) {
      this._deactivateSelected();
      return;
    }

    // Click on a DIFFERENT friendly unactivated unit → switch to it
    if (clickedUnit && clickedUnit.team === state.currentPlayer &&
        clickedUnit.alive && !state.activatedThisRound.has(clickedUnit.id)) {
      this._deactivateSelected();
      state.activateUnit(clickedUnit);
      this.renderer.selectedUnit = clickedUnit;
      this._showMoveRange(clickedUnit, false);
      this._showAttackHighlights(clickedUnit);
      this._updateAllPanels();
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

    // Click on tile in move range = move
    if (!clickedUnit) {
      const inRange = this.renderer.moveHighlights.some(t => t.x === x && t.y === y);
      if (inRange && state.actionsLeft >= 1) {
        this._doMove(activeUnit, x, y);
        return;
      }
      // Click on empty non-move tile → deselect
      this._deactivateSelected();
    }
  },

  // Deselect the currently active unit without consuming its activation
  _deactivateSelected() {
    const state = this.engine;
    if (!state) return;
    state.deactivateUnit();
    this.renderer.selectedUnit     = null;
    this.renderer.moveHighlights   = [];
    this.renderer.attackHighlights = [];
    this.renderer.healTargets      = [];
    this._abilityMode = null;
    this._updateAllPanels();
  },

  // ─── AI trigger ─────────────────────────────────────────
  // Call after any action that could have ended the human's activation
  _checkAITurn() {
    const state = this.engine;
    if (!state || state.phase !== 'playing') return;
    if (this.mode !== 'ai') return;
    if (state.currentPlayer !== 1) return;
    if (this.aiRunning) return;
    if (state.phase === 'gameover') return;
    setTimeout(() => this._runAI(), 400);
  },

  // ─── Action execution ────────────────────────────────────

  // Call after every useAction(). Clears visual state if the activation ended
  // (useAction triggered endActivation internally), or refreshes highlights if
  // the unit still has actions left.  This is the single place that decides
  // what the board looks like after each player action.
  _afterAction(unit, syncPayload) {
    const state = this.engine;
    if (state.phase === 'gameover') {
      this._clearActionVisuals();
      this._showGameOver();
      return;
    }
    if (!state.activeUnit) {
      // endActivation fired internally (actionsLeft hit 0).
      // Clear visuals and tell the remote client to also end the activation,
      // advancing their currentPlayer so they can take their turn.
      this._clearActionVisuals();
      if (syncPayload) this._syncOnline(syncPayload);
      this._syncOnline({ type: 'end' });  // explicit end so remote advances turn
    } else {
      // Unit still has actions — refresh highlights for remaining moves/shots.
      this._showMoveRange(unit, false);
      this._showAttackHighlights(unit);
      if (syncPayload) this._syncOnline(syncPayload);
    }
    this._updateAllPanels();
    this._checkAITurn();
  },

  // Wipe all selection and highlight state from the renderer.
  _clearActionVisuals() {
    this.renderer.selectedUnit     = null;
    this.renderer.moveHighlights   = [];
    this.renderer.attackHighlights = [];
    this.renderer.healTargets      = [];
    this._abilityMode              = null;
  },

  _doMove(unit, x, y) {
    const state = this.engine;
    const sprint = state.hasMoved === false && state.actionsLeft >= 2;
    const sprintRange = state.getMovementRange(unit, true);
    const inSprintRange = sprintRange.some(t => t.x === x && t.y === y);
    const moveRange  = state.getMovementRange(unit, false);
    const inMoveRange = moveRange.some(t => t.x === x && t.y === y);

    if (!inMoveRange && !inSprintRange) return;
    const actualSprint = !inMoveRange && inSprintRange;

    // Trigger slide animation before state.moveUnit() updates the unit's tile coords.
    // getPath returns BFS waypoints that route around buildings.
    {
      const _path = state.getPath(unit, x, y);
      const _from = { x: unit.x, y: unit.y };
      this.renderer.triggerMove(unit.id, _path, actualSprint);
      if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
    }
    state.moveUnit(unit, x, y);
    state.hasMoved = true;
    if (actualSprint) {
      state.hasSprinted = true;
      state.useAction(2);
    } else {
      state.useAction(1);
    }

    this._afterAction(unit, { type: 'move', unitId: unit.id, x, y, sprint: actualSprint });
  },

  _doShoot(attacker, target) {
    const state = this.engine;
    if (state.actionsLeft < 1 || state.hasSprinted) return;
    const result = state.resolveShoot(attacker, target);
    this.renderer.triggerFlash(target.id);
    this._showDiceResult(result);
    state.useAction(1);
    // Send the authoritative result so the remote applies the same wounds/rolls,
    // not a separate independent dice roll that could differ.
    this._afterAction(attacker, {
      type: 'shoot', unitId: attacker.id, targetId: target.id,
      result: { rolls: result.rolls, saves: result.saves, wounds: result.wounds,
                hitCount: result.hitCount, targetNum: result.targetNum }
    });
  },

  _doBlast(attacker, cx, cy) {
    const state = this.engine;
    if (state.actionsLeft < 2) return;
    const results = state.resolveBlast(attacker, cx, cy);
    this.renderer.triggerFlash(attacker.id);
    state.useAction(2);
    this._afterAction(attacker, {
      type: 'blast', unitId: attacker.id, x: cx, y: cy,
      results: results.map(r => ({ targetId: r.target, wounds: r.wounds,
                                   rolls: r.rolls, saves: r.saves }))
    });
  },

  _doHeal(medic, target) {
    const state   = this.engine;
    const success = state.tryHeal(medic, target);
    if (!success) return; // tryHeal already logged why (already used, too far)
    state.useAction(1);
    this._afterAction(medic, { type: 'heal', unitId: medic.id, targetId: target.id });
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
    this._afterAction(unit, { type: 'aim', unitId: unit.id });
  },

  btnTakeCover() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    unit.inCover = true;
    state.addLog(`🛡️ ${unit.name} takes cover!`, 'ability');
    state.useAction(1);
    this._afterAction(unit, { type: 'cover', unitId: unit.id });
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
        this._afterAction(unit, { type: 'overwatch', unitId: unit.id });
        break;
      case 'heal': {
        // Heal just enters targeting mode — useAction is called in _doHeal
        // when the player clicks their target, so no _afterAction here.
        const nearby = state.units.filter(u =>
          u.team === unit.team && u.id !== unit.id &&
          Math.max(Math.abs(unit.x - u.x), Math.abs(unit.y - u.y)) <= 1 &&
          (!u.alive || u.suppressed)
        );
        if (!nearby.length) { this.showNotif('No allies in range to heal!', 'warn'); return; }
        this._abilityMode = 'heal';
        this.renderer.healTargets = nearby.map(u => u.id);
        state.addLog(`💉 ${unit.name}: click an adjacent ally to heal`, 'ability');
        this._updateAllPanels();
        break;
      }
      case 'blast': {
        // Blast just enters targeting mode — useAction is called in _doBlast.
        const targets = state.getValidTargets(unit);
        if (!targets.length) { this.showNotif('No targets in range!', 'warn'); return; }
        this._abilityMode = 'blast';
        this.renderer.attackHighlights = targets.map(t => t.id);
        state.addLog(`💥 ${unit.name}: click an enemy to throw grenade`, 'ability');
        this._updateAllPanels();
        break;
      }
      case 'stealth':
        state.addLog(`👻 ${unit.name} activates Stealth — hard to target in cover!`, 'ability');
        state.useAction(1);
        this._afterAction(unit, { type: 'ability', unitId: unit.id, ability: 'stealth' });
        break;
      case 'command':
        state.addLog(`📣 ${unit.name} rallies the squad — Command Aura active!`, 'ability');
        state.useAction(1);
        this._afterAction(unit, { type: 'ability', unitId: unit.id, ability: 'command' });
        break;
    }
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
    this._afterAction(unit, { type: 'charge', unitId: unit.id, targetId: target.id });
  },

  btnEndActivation() {
    const state = this.engine;
    if (!state.getActiveUnit()) return;
    state.endActivation();
    this._clearActionVisuals();
    this._updateAllPanels();
    this._syncOnline({ type: 'end' });
    if (state.phase === 'gameover') { this._showGameOver(); return; }
    this._checkAITurn();
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
          {
            const _path = state.getPath(unit, action.x, action.y);
            const _from = { x: unit.x, y: unit.y };
            this.renderer.triggerMove(unit.id, _path, action.type === 'sprint');
            if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
          }
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
    const state   = this.engine;
    const remTeam = this.mp.isHost ? 1 : 0;  // remote player's team

    // ── Pre-game messages — handled before any turn-order checks ─────────────

    // 'init': host sends their full serialized engine right after startGame().
    // The joiner deserializes it so both clients share the exact same board,
    // squads, and game-mode settings.  The joiner's own startGame() already
    // set up the renderer/canvas; we just overwrite the engine data here.
    // ── Squad exchange (army builder phase) ────────────────────────────────
    // squadReady: a player has confirmed their army.  Store their squad and
    // check if both sides are ready.  Neither side advances until both send this.
    if (action.type === 'squadReady') {
      const remoteTeam = this.mp?.isHost ? 1 : 0;
      this.armyDraft[remoteTeam] = action.units || [];
      this._onlineReady = (this._onlineReady || 0) | (1 << remoteTeam);
      if ((this._onlineReady & 3) === 3) this._bothSquadsReady();
      return;
    }

    // Joiner asks the host for the authoritative engine state.
    // Host replies with 'init' carrying the full serialized engine.
    if (action.type === 'requestInit') {
      if (this.mp?.isHost && state) {
        this._syncOnline({ type: 'init', state: state.serialize() });
      }
      return;
    }

    // Joiner receives the host's engine — overwrite local copy so both clients
    // share the exact same board, squads, game-mode, and deploy state.
    if (action.type === 'init') {
      if (!state) return;
      state.deserialize(action.state);
      this._enterDeployPhase();
      this._updateAllPanels();
      return;
    }

    // 'deployDone': opponent finished placing their units.  Mirror their
    // positions locally, then start battle once BOTH sides are done.
    if (action.type === 'deployDone') {
      if (!state) return;
      for (const u of (action.units || [])) {
        const unit = state.getUnit(u.id);
        if (unit) { unit.x = u.x; unit.y = u.y; unit.deployed = true; }
      }
      this._remoteDeployDone = true;
      if (this._localDeployDone) {
        // Both players are done — start battle
        this._startBattleOnline();
      } else {
        // We haven't finished yet — just refresh so the banner updates
        this._updateAllPanels();
      }
      return;
    }

    // ── FIX #7: Gate every action behind the same legality checks used locally ──

    // 1. Must be remote team's turn
    if (state.currentPlayer !== remTeam) return;

    // 2. 'end' doesn't need a unit
    if (action.type === 'end') {
      state.endActivation();
      this._clearActionVisuals();   // wipe stale highlights so local player sees a clean board
      this._updateAllPanels();
      if (state.phase === 'gameover') this._showGameOver();
      return;
    }

    // 3. Unit must exist, be alive, and belong to the remote team
    const unit = state.getUnit(action.unitId);
    if (!unit || !unit.alive || unit.team !== remTeam) return;

    // 4. Unit must not have already been activated this round (unless already active)
    const currentActive = state.getActiveUnit();
    if (currentActive && currentActive.id !== unit.id) return; // someone else is active
    if (!currentActive && state.activatedThisRound.has(unit.id)) return;

    // 5. Activate if needed (safe now that ownership is verified)
    if (!currentActive) state.activateUnit(unit);

    switch (action.type) {
      case 'move': {
        const isSprint = !!action.sprint;
        const legalTiles = state.getMovementRange(unit, isSprint);
        const isLegal = legalTiles.some(t => t.x === action.x && t.y === action.y);
        if (!isLegal) return;
        {
          const _path = state.getPath(unit, action.x, action.y);
          const _from = { x: unit.x, y: unit.y };
          this.renderer.triggerMove(unit.id, _path, isSprint);
          if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
        }
        state.moveUnit(unit, action.x, action.y);
        isSprint ? (state.hasSprinted = true, state.useAction(2)) : state.useAction(1);
        break;
      }
      case 'aim':
        // Sync aiming state — needed so remote resolveShoot applies the aim bonus
        unit.aiming    = true;
        state.isAiming = true;
        state.useAction(1);
        break;
      case 'cover':
        unit.inCover = true;
        state.useAction(1);
        break;
      case 'shoot': {
        const t = state.getUnit(action.targetId);
        if (!t) return;
        if (action.result) {
          // Apply the authoritative result sent by the shooter — no re-roll
          this._applyRemoteCombatResult(unit, t, action.result);
        } else {
          // Fallback: re-resolve locally (older client compatibility)
          const r = state.resolveShoot(unit, t);
          this._showDiceResult(r);
        }
        this.renderer.triggerFlash(t.id);
        state.useAction(1);
        break;
      }
      case 'blast': {
        if (!state._inBounds(action.x, action.y)) return;
        const dist = Math.max(Math.abs(unit.x - action.x), Math.abs(unit.y - action.y));
        if (dist > unit.range) return;
        if (action.results) {
          // Apply authoritative per-target results
          for (const res of action.results) {
            const tgt = state.getUnit(res.targetId);
            if (tgt) this._applyRemoteCombatResult(unit, tgt, res);
          }
        } else {
          state.resolveBlast(unit, action.x, action.y);
        }
        state.useAction(2);
        break;
      }
      case 'heal': {
        const ht = state.getUnit(action.targetId);
        if (!ht || ht.team !== remTeam) return;
        const hDist = Math.max(Math.abs(unit.x - ht.x), Math.abs(unit.y - ht.y));
        if (hDist > 1) return;
        state.tryHeal(unit, ht);
        state.useAction(1);
        break;
      }
      case 'overwatch':
        state.setOverwatch(unit);
        state.useAction(2);
        break;
      case 'ability':
        // Passive ability activation (stealth, command) — just consume the action
        state.useAction(1);
        break;
      default:
        return; // unknown action type — ignore
    }

    // If the remote action ended their activation, clear any stale visual
    // selection state so the local player sees a clean board for their turn.
    if (!state.activeUnit) this._clearActionVisuals();
    this._updateAllPanels();
    if (state.phase === 'gameover') this._showGameOver();
  },

  // Apply an authoritative combat result sent by the remote shooter.
  // Directly sets hp, alive, suppressed from the sender's dice — no local re-roll.
  _applyRemoteCombatResult(attacker, target, res) {
    if (!res || typeof res.wounds !== 'number') return;
    if (res.wounds > 0) {
      target.hp -= res.wounds;
      if (target.hp <= 0) {
        target.alive = false;
        target.hp    = 0;
        this.engine.addLog(`💀 ${target.name} is eliminated!`, 'death');
        if (this.engine.gameMode === 'ctf') this.engine.dropFlag(target.id);
        this.engine.checkObjectiveWin();
      } else {
        target.suppressed = true;
        this.engine.addLog(`${target.name} is hit and suppressed!`, 'hit');
      }
    } else {
      this.engine.addLog(`${attacker.name} misses!`, 'miss');
    }
    attacker.aiming = false;
    // Show the dice the remote rolled
    if (res.rolls) this._showDiceResult({ ...res, attacker: attacker.id, target: target.id });
    if (target.alive === false) {
      const winner = this.engine.checkWin();
      if (winner !== null) {
        this.engine.phase  = 'gameover';
        this.engine.winner = winner;
      }
    }
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
    if (state.phase === 'deploy') { this._updateDeployBanner(); return; }
    if (state.phase === 'gameover') {
      banner.innerHTML = `🏆 <strong>${state.players[state.winner].name} Wins!</strong> — Round ${state.turn}`;
      banner.className = 'turn-banner gameover';
      return;
    }
    const cp   = state.currentPlayer;
    const name = state.players[cp].name;
    const active = state.getActiveUnit();

    // Objective status string
    let objStatus = '';
    if (state.gameMode === 'ctf' && state.objectives?.flag) {
      const f = state.objectives.flag;
      if (f.carriedBy) {
        const carrier = state.getUnit(f.carriedBy);
        objStatus = ` · 🚩 ${carrier?.name || '?'} carrying the flag!`;
      } else {
        objStatus = ' · 🚩 Flag at centre — grab it!';
      }
    } else if (state.gameMode === 'bomb' && state.objectives) {
      if (state.objectives.bombPlanted) {
        objStatus = ` · 💣 BOMB PLANTED — detonates in ${state.objectives.bombTimer} rounds!`;
      } else {
        objStatus = ' · 💣 Attackers must plant the bomb';
      }
    } else if (state.gameMode === 'vip') {
      objStatus = ' · 👑 Alpha: protect VIP. Bravo: eliminate them.';
    }

    // Activation counters — how many alive units each team has activated this round
    const countActivated = (team) => {
      const alive = state.units.filter(u => u.alive && u.team === team);
      const done  = alive.filter(u => state.activatedThisRound.has(u.id));
      // Also count the currently-active unit if it has taken an action
      const activeIsThisTeam = state.activeUnit &&
        state.getUnit(state.activeUnit)?.team === team &&
        state.actionTakenThisActivation;
      const doneCount = done.length + (activeIsThisTeam && !done.some(u => u.id === state.activeUnit) ? 1 : 0);
      return `${doneCount}/${alive.length}`;
    };
    const counter = `<span style="opacity:0.7;font-size:0.88em"> · ✅ ${countActivated(0)} / ${countActivated(1)}</span>`;

    banner.innerHTML = active
      ? `Round ${state.turn} — <span style="color:${TEAM_COLORS[cp]}">${name}</span> — ${active.name} (${state.actionsLeft} action${state.actionsLeft !== 1 ? 's' : ''} left)${objStatus}${counter}`
      : `Round ${state.turn} — <span style="color:${TEAM_COLORS[cp]}">${name}</span> — Click a unit to activate${objStatus}${counter}`;
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

    // ── Objective action buttons ──
    if (state.gameMode === 'ctf' && state.objectives?.flag) {
      const f = state.objectives.flag;
      // Pick up flag
      if (f.carriedBy === null && f.capturedBy === null && unit.x === f.x && unit.y === f.y) {
        addBtn('btnPickupFlag', 'Pick Up Flag', '🚩', al >= 1, 'Pick up the flag and carry it to your base');
      }
    }
    if (state.gameMode === 'bomb' && state.objectives?.sites) {
      // Plant bomb (attackers = team 0, on a site tile)
      if (unit.team === 0 && !state.objectives.bombPlanted) {
        const onSite = state.objectives.sites.some(s => s.x === unit.x && s.y === unit.y && !s.planted);
        if (onSite) addBtn('btnPlantBomb', 'Plant Bomb', '💣', al >= 1, 'Plant the bomb at this site');
      }
      // Defuse bomb (defenders = team 1, on planted site)
      if (unit.team === 1 && state.objectives.bombPlanted) {
        const activeSite = state.objectives.sites.find(s => s.id === state.objectives.activeSite);
        if (activeSite && unit.x === activeSite.x && unit.y === activeSite.y) {
          addBtn('btnDefuseBomb', 'Defuse Bomb', '🔧', al >= 2, 'Defuse the bomb — takes 2 actions');
        }
      }
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

  btnPickupFlag() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    if (state.tryPickupFlag(unit)) {
      state.useAction(1);
      this._updateAllPanels();
      this._checkAITurn();
      if (state.phase === 'gameover') this._showGameOver();
    }
  },

  btnPlantBomb() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    if (state.tryPlantBomb(unit)) {
      state.useAction(1);
      this._updateAllPanels();
      this._checkAITurn();
    }
  },

  btnDefuseBomb() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 2) return;
    if (state.tryDefuseBomb(unit)) {
      state.useAction(2);
      this._updateAllPanels();
      if (state.phase === 'gameover') this._showGameOver();
    } else {
      this.showNotif('Move to the bomb site first!', 'warn');
    }
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
    // FIX #9: Build log entries with safe DOM APIs instead of innerHTML to
    // prevent XSS. e.type is whitelisted; e.text is set as textContent.
    const ALLOWED_TYPES = new Set([
      'info','system','move','shoot','hit','miss','death','ability','activate','melee','error'
    ]);
    logEl.innerHTML = '';
    for (const e of last) {
      const div = document.createElement('div');
      const safeType = ALLOWED_TYPES.has(e.type) ? e.type : 'info';
      div.className   = 'log-' + safeType;
      div.textContent = e.text;
      logEl.appendChild(div);
    }
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

  // ─── In-game menu ────────────────────────────────────────────
  openGameMenu() {
    const overlay = document.getElementById('game-menu-overlay');
    const round   = document.getElementById('game-menu-round');
    if (round && this.engine) {
      const phase = this.engine.phase;
      const turn  = this.engine.turn;
      const cp    = this.engine.players[this.engine.currentPlayer]?.name || '';
      round.textContent = phase === 'gameover'
        ? `Game over — Round ${turn}`
        : `Round ${turn} · ${cp}'s turn`;
    }
    overlay.classList.add('open');
  },

  closeGameMenu() {
    document.getElementById('game-menu-overlay').classList.remove('open');
  },

  newGameFromMenu() {
    this.closeGameMenu();
    document.getElementById('gameover-overlay').style.display = 'none';
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.engine    = null;
    this.renderer  = null;
    this.aiQueue   = [];
    this.aiRunning = false;
    // Reset deploy panel state
    document.getElementById('deploy-section').style.display  = 'none';
    document.getElementById('actions-section').style.display = 'block';
    document.getElementById('stats-section').style.display   = 'flex';
    this._deploySelectedUnit = null;
    this.showScreen('screen-battlefield');
    this.initBattlefieldSetup();
  },

  mainMenuFromMenu() {
    this.closeGameMenu();
    document.getElementById('gameover-overlay').style.display = 'none';
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.engine    = null;
    this.renderer  = null;
    this.aiQueue   = [];
    this.aiRunning = false;
    this._deploySelectedUnit = null;
    document.getElementById('deploy-section').style.display  = 'none';
    document.getElementById('actions-section').style.display = 'block';
    document.getElementById('stats-section').style.display   = 'flex';
    if (this.mp) { this.mp.destroy(); this.mp = null; }
    this.showScreen('screen-menu');
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
    // Tear down any existing peer cleanly before creating a new one.
    if (this.mp) { this.mp.destroy(); }
    this.mp = new MultiplayerManager();
  },

  hostGame() {
    // Guard: if we're already hosting and waiting, don't restart — just
    // make sure the code is visible. A second click would abandon the peer
    // the joiner is trying to connect to and generate a useless new code.
    if (this.mp?.isHost && !this.mp?.connected) {
      document.getElementById('room-code-display').style.display = 'block';
      return;
    }
    this.initMultiplayer();
    this.myTeam = 0;
    this.mp.host(
      (code) => {
        const display = document.getElementById('room-code-display');
        display.textContent = code;
        display.style.display = 'block';
        document.getElementById('lobby-status').textContent = 'Waiting for opponent to join…';
      },
      () => {
        this._setupMultiplayerCallbacks();
        document.getElementById('lobby-status').textContent = '✅ Opponent connected! Starting army builder…';
        setTimeout(() => { this.showScreen('screen-army'); this.initArmyBuilder(0); }, 1000);
      }
    );
  },

  joinGame() {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) { this.showNotif('Enter a room code!', 'warn'); return; }
    // Destroy any previous connection attempt before trying a new one.
    this.initMultiplayer();
    this.myTeam = 1;
    document.getElementById('lobby-status').textContent = 'Connecting…';
    this.mp.join(code,
      () => {
        this._setupMultiplayerCallbacks();
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
