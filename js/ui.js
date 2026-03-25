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
    // Hide mobile HUD when leaving the game screen
    const hud = document.getElementById('mobile-hud');
    if (hud) hud.style.display = (id === 'screen-game') ? '' : 'none';
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
    // Show fuse-length and attacker-team controls only in bomb mode
    const fuseCtrl = document.getElementById('fuse-control');
    if (fuseCtrl) fuseCtrl.style.display = (gm === 'bomb') ? 'block' : 'none';
    // Reset hint when leaving bomb mode
    if (gm !== 'bomb') {
      const hint = document.getElementById('deploy-hint');
      if (hint) hint.textContent = '🔵 Alpha deploys left \u00a0|\u00a0 🔴 Bravo deploys right';
    } else {
      // Refresh hint for current attacker setting
      this.setBombAttacker(this.bombAttackerTeam ?? 0);
    }
  },

  setBombAttacker(team) {
    this.bombAttackerTeam = team;
    document.querySelectorAll('[data-attacker]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-attacker="${team}"]`);
    if (btn) btn.classList.add('active');
    // Update the deploy hint to reflect who is attacking/defending
    const hint = document.getElementById('deploy-hint');
    if (hint) {
      if (this.gameMode === 'bomb') {
        const attName = team === 0 ? '🔵 Alpha' : '🔴 Bravo';
        const defName = team === 0 ? '🔴 Bravo' : '🔵 Alpha';
        const attSide = team === 0 ? 'left' : 'right';
        const defSide = team === 0 ? 'right' : 'left';
        hint.textContent = `${attName} (Attackers) deploy ${attSide} — bomb spawns there | ${defName} (Defenders) deploy ${defSide} — sites spawn there`;
      } else {
        hint.textContent = '🔵 Alpha deploys left \u00a0|\u00a0 🔴 Bravo deploys right';
      }
    }
  },

  setBombFuse(n) {
    this.bombFuseLength = n;
    document.querySelectorAll('[data-fuse]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-fuse="${n}"]`);
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
    eng.mode           = this.mode;
    eng.gameMode          = this.gameMode || 'elimination';
    eng.bombFuseLength    = this.bombFuseLength || 8;
    eng.bombAttackerTeam  = (this.bombAttackerTeam === 1) ? 1 : 0;

    this.engine   = eng;
    this.renderer = new Renderer('battlefield');
    if (this.mode === 'ai') this.ai = new AIPlayer(1);

    this.showScreen('screen-game');
    this._setupGameCanvas();
    this.startRenderLoop();

    if (this.mode === 'online') {
      this.renderer._onlineMyTeam = this.myTeam;
      this._mobSetupHUD();

      if (this.mp?.isHost) {
        // HOST: generate the authoritative engine, start deploy, then broadcast.
        // The joiner will receive 'init' and sync from it.
        eng.startDeploy();
        this._enterDeployPhase();
        this._syncOnline({ type: 'init', state: eng.serialize() });
      } else {
        // JOINER: do NOT call startDeploy or enterDeployPhase yet.
        // Show a waiting banner, then start deploy only after 'init' arrives.
        const banner = document.getElementById('turn-banner');
        if (banner) {
          banner.textContent = '⏳ Waiting for host map…';
          banner.className   = 'turn-banner';
        }
        document.getElementById('deploy-section').style.display  = 'none';
        document.getElementById('actions-section').style.display = 'none';
        document.getElementById('stats-section').style.display   = 'none';
        // Ask host to send init (covers case where host sent it before joiner was ready)
        this._syncOnline({ type: 'requestInit' });
      }
    } else {
      // AI / local: start deploy first so phase === 'deploy' when HUD builds
      eng.startDeploy();
      this._enterDeployPhase();
      this._mobSetupHUD();
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

    // On mobile the HUD may already be built — refresh it so the deploy panel appears
    if (this._isMobile()) this.mobTab('actions');
  },

  _renderDeployPanel(team) {
    const state  = this.engine;
    const panel  = document.getElementById('deploy-panel');
    const doneBtn = document.getElementById('deploy-done-btn');
    const title  = document.getElementById('deploy-panel-title');
    const icons  = { rifleman:'🔫', sniper:'🎯', medic:'💉', grenadier:'💣', leader:'⭐', scout:'🏹' };

    if (!panel) return;   // HUD not ready yet

    const color = team === 0 ? '#3a9eff' : '#ff4545';
    if (title) { title.textContent = `PLACE ${state.players[team].name.toUpperCase()}`; title.style.color = color; }

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
    // Call _beginBattle directly — all units are already placed via deployDone
    // exchange. Both clients run this independently so both end up with
    // identical state: phase='playing', currentPlayer=0, activatedThisRound={}.
    if (state.phase !== 'playing') {
      state._beginBattle();
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
    this._setupTouchCanvas();
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

    if (this._abilityMode === 'charge') {
      if (clickedUnit && this._chargeTargets?.some(t => t.id === clickedUnit.id)) {
        this._doCharge(activeUnit, clickedUnit);
      } else {
        this._cancelAbilityMode();
      }
      return;
    }

    if (this._abilityMode === 'blast') {
      const blastHL = this.renderer.blastHighlights || [];
      const inRange = blastHL.some(t => t.x === x && t.y === y);
      if (inRange && activeUnit) {
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
    // BUT: if that unit's tile is in the active unit's move range AND the active
    // unit can still move, treat it as a move-to-tile instead — the player is
    // trying to move there, not swap units.
    if (clickedUnit && clickedUnit.team === state.currentPlayer &&
        clickedUnit.alive && !state.activatedThisRound.has(clickedUnit.id)) {
      const tileInMoveRange = this.renderer.moveHighlights.some(t => t.x === x && t.y === y);
      const canStillMove    = state.actionsLeft >= 1 && !state.hasMoved && !state.hasRun;
      if (tileInMoveRange && canStillMove) {
        // Player wants to move to this tile, not switch units — fall through to move
      } else {
        this._deactivateSelected();
        state.activateUnit(clickedUnit);
        this.renderer.selectedUnit = clickedUnit;
        this._showMoveRange(clickedUnit, false);
        this._showAttackHighlights(clickedUnit);
        this._updateAllPanels();
        return;
      }
    }

    // Click on enemy = shoot
    if (clickedUnit && clickedUnit.team !== state.currentPlayer && clickedUnit.alive) {
      const targets = state.getValidTargets(activeUnit);
      if (targets.some(t => t.id === clickedUnit.id) && state.actionsLeft >= 1 && !activeUnit.hasRun) {
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

  _afterAction(unit, syncPayload) {
    const state = this.engine;
    if (state.phase === 'gameover') {
      this._clearActionVisuals();
      this._showGameOver();
      return;
    }
    if (!state.activeUnit) {
      this._clearActionVisuals();
      if (syncPayload) this._syncOnline(syncPayload);
      this._syncOnline({ type: 'end' });
    } else {
      // Show move range only if haven't moved yet; run range if moved but not yet run
      if (!state.hasMoved) {
        this._showMoveRange(unit, false);
      } else if (state.hasRun || unit.hasRun) {
        this.renderer.moveHighlights = [];  // already ran — no more movement
      } else {
        this.renderer.moveHighlights = [];  // moved but can't run (run requires move first)
      }
      this._showAttackHighlights(unit);
      if (syncPayload) this._syncOnline(syncPayload);
    }
    this._updateAllPanels();
    this._checkAITurn();
  },

  _clearActionVisuals() {
    this.renderer.selectedUnit     = null;
    this.renderer.moveHighlights   = [];
    this.renderer.attackHighlights = [];
    this.renderer.blastHighlights  = [];
    this.renderer.healTargets      = [];
    this._abilityMode   = null;
    this._chargeTargets = null;
  },

  _doMove(unit, x, y) {
    const state = this.engine;
    const isRun = state.hasRun && state.hasMoved; // running uses the 1D6 extra range

    const moveRange = state.getMovementRange(unit, false);
    const inMoveRange = moveRange.some(t => t.x === x && t.y === y);
    const runRange  = state.getMovementRange(unit, true);
    const inRunRange = runRange.some(t => t.x === x && t.y === y);

    if (!inMoveRange && !inRunRange) return;
    const actualRun = !inMoveRange && inRunRange;

    // Trigger slide animation
    {
      const _path = state.getPath(unit, x, y);
      const _from = { x: unit.x, y: unit.y };
      this.renderer.triggerMove(unit.id, _path, actualRun);
      if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
    }
    state.moveUnit(unit, x, y);
    state.hasMoved = true;
    if (actualRun) {
      state.hasRun = true;
      unit.hasRun  = true;
      state.useAction(1);  // Run costs 1 additional action
    } else {
      state.useAction(1);
    }

    this._afterAction(unit, { type: 'move', unitId: unit.id, x, y, run: actualRun });
  },

  _doShoot(attacker, target) {
    const state = this.engine;
    if (state.actionsLeft < 1 || attacker.hasRun) return;

    // Shooting into base-to-base contact: misses auto-hit a friendly in contact
    const result = state.resolveShoot(attacker, target);
    this.renderer.triggerFlash(target.id);
    this._showDiceResult(result);

    // RW rule: if shooting into base contact and attacker missed, friendly adjacent to
    // target takes the hit (attacker's own units only — they don't dodge)
    if (result.hitCount === 0) {
      const friendlyInContact = state.units.find(u =>
        u.alive && u.team === attacker.team &&
        Math.max(Math.abs(target.x - u.x), Math.abs(target.y - u.y)) <= 1
      );
      if (friendlyInContact) {
        state.addLog(`⚠️ Miss into melee — ${friendlyInContact.name} is hit instead!`, 'hit');
        const friendlyResult = state.resolveShoot(attacker, friendlyInContact);
        this.renderer.triggerFlash(friendlyInContact.id);
      }
    }

    state.useAction(1);
    this._afterAction(attacker, {
      type: 'shoot', unitId: attacker.id, targetId: target.id,
      result: { rolls: result.rolls, armourSaves: result.armourSaves,
                wounds: result.wounds, pinned: result.pinned,
                hitCount: result.hitCount, hitTarget: result.hitTarget,
                effectiveAP: result.effectiveAP, weaponName: result.weaponName }
    });
  },

  _doBlast(attacker, cx, cy) {
    const state = this.engine;
    if (state.actionsLeft < 1) return;
    const results = state.resolveBlast(attacker, cx, cy);
    // Flash the attacker and all units caught in the blast
    this.renderer.triggerFlash(attacker.id);
    for (const r of results) {
      const t = state.getUnit(r.target || (r.attacker !== attacker.id ? r.attacker : null));
      if (t) this.renderer.triggerFlash(t.id);
    }
    // Brief tile flash on the target area
    this.renderer.triggerBlastFlash(cx, cy);
    state.useAction(1);
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
    this._abilityMode    = null;
    this._chargeTargets  = null;
    this.renderer.healTargets      = [];
    this.renderer.attackHighlights = [];
    this.renderer.blastHighlights  = [];
    this.renderer.moveHighlights   = [];
    const unit = this.engine.getActiveUnit();
    if (unit) {
      this._showMoveRange(unit, false);
      this._showAttackHighlights(unit);
    }
  },

  // ─── Button actions ─────────────────────────────────────
  btnReload() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    if (state.reloadWeapon(unit)) {
      state.useAction(1);
      this._afterAction(unit, { type: 'reload', unitId: unit.id });
    } else {
      this.showNotif('Nothing to reload!', 'warn');
    }
  },

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
    const tile = state.board[unit.y][unit.x];
    if (tile.type === TILE.COVER || tile.type === TILE.RUBBLE) {
      // On a cover tile: upgrade to Heavy Cover (−2 to incoming attacks)
      unit.inCover      = true;
      unit.inHeavyCover = true;
      state.addLog(`🛡️ ${unit.name} hunkers down — HEAVY COVER (−2 to incoming attacks)!`, 'ability');
    } else {
      // Open tile: gain Light Cover (−1 to incoming attacks)
      unit.inCover      = true;
      unit.inHeavyCover = false;
      state.addLog(`🛡️ ${unit.name} takes cover — LIGHT COVER (−1 to incoming attacks)!`, 'ability');
    }
    state.useAction(1);
    this._afterAction(unit, { type: 'cover', unitId: unit.id });
  },

  btnRun() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1 || !state.hasMoved || state.hasRun) return;
    // Roll 1D6 for bonus movement distance
    const bonus = state.rollD6();
    unit._runBonus = bonus;
    unit.hasRun    = true;
    state.hasRun   = true;
    const runRange = state.getMovementRange(unit, true);
    this.renderer.moveHighlights = runRange;
    state.addLog(`🏃 ${unit.name} runs! Roll: ${bonus} — click destination (${bonus} extra tiles)`, 'move');
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
        const nearby = state.units.filter(u =>
          u.team === unit.team && u.id !== unit.id &&
          Math.max(Math.abs(unit.x - u.x), Math.abs(unit.y - u.y)) <= 1 &&
          (!u.alive || u.pinned || u.hp < u.maxHp)
        );
        if (!nearby.length) { this.showNotif('No allies in range to heal!', 'warn'); return; }
        this._abilityMode = 'heal';
        this.renderer.healTargets = nearby.map(u => u.id);
        state.addLog(`💉 ${unit.name}: click an adjacent ally to heal`, 'ability');
        this._updateAllPanels();
        break;
      }
      case 'blast': {
        const weapon    = WEAPON_DEFS[unit.weapon] || {};
        const blastRng  = weapon.range || 6;
        const blastTiles = [];
        for (let dy = -blastRng; dy <= blastRng; dy++) {
          for (let dx = -blastRng; dx <= blastRng; dx++) {
            const tx = unit.x + dx, ty = unit.y + dy;
            if (!state._inBounds(tx, ty)) continue;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > blastRng) continue;
            if (state.hasLOS(unit.x, unit.y, tx, ty)) blastTiles.push({ x: tx, y: ty });
          }
        }
        if (!blastTiles.length) { this.showNotif('No tiles in range!', 'warn'); return; }
        this._abilityMode = 'blast';
        this.renderer.blastHighlights = blastTiles;
        state.addLog(`💥 ${unit.name}: click a tile to throw grenade`, 'ability');
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

    // Find adjacent enemies (already in base contact)
    const adjacent = state.units.filter(u =>
      u.alive && u.team !== state.currentPlayer &&
      Math.max(Math.abs(unit.x - u.x), Math.abs(unit.y - u.y)) <= 1
    );

    if (adjacent.length) {
      // Already in base contact — just fight
      const target = adjacent[0];
      const result = state.resolveMelee(unit, target);
      this._showMeleeResult(result);
      state.useAction(2);
      this._afterAction(unit, { type: 'charge', unitId: unit.id, targetId: target.id });
      return;
    }

    // Not adjacent — show charge range (MA tiles) and let player click enemy
    const moveRange = state.getMovementRange(unit, false);
    // Highlight enemies reachable within MA that have an adjacent open tile
    const reachableTargets = state.units.filter(u => {
      if (!u.alive || u.team === state.currentPlayer) return false;
      // Check if any tile adjacent to the enemy is within move range
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const tx = u.x + dx, ty = u.y + dy;
        if (moveRange.some(t => t.x === tx && t.y === ty)) return true;
      }
      return false;
    });

    if (!reachableTargets.length) {
      this.showNotif('No enemies in charge range!', 'warn');
      return;
    }

    // Highlight reachable enemy tiles as attack targets and move range
    this.renderer.moveHighlights   = moveRange;
    this.renderer.attackHighlights = reachableTargets.map(t => t.id);
    this._abilityMode = 'charge';
    this._chargeTargets = reachableTargets;
    state.addLog(`⚔️ ${unit.name} charging — click an enemy to charge!`, 'melee');
    this._updateAllPanels();
  },

  _doCharge(unit, target) {
    const state = this.engine;
    // Move to the closest open tile adjacent to the target
    const moveRange = state.getMovementRange(unit, false);
    let closestTile = null, bestDist = Infinity;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const tx = target.x + dx, ty = target.y + dy;
      const inRange = moveRange.some(t => t.x === tx && t.y === ty);
      if (!inRange) continue;
      const d = Math.max(Math.abs(unit.x - tx), Math.abs(unit.y - ty));
      if (d < bestDist) { bestDist = d; closestTile = { x: tx, y: ty }; }
    }

    if (closestTile) {
      const _path = state.getPath(unit, closestTile.x, closestTile.y);
      const _from = { x: unit.x, y: unit.y };
      this.renderer.triggerMove(unit.id, _path, false);
      if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
      state.moveUnit(unit, closestTile.x, closestTile.y);
      state.hasMoved = true;
    }

    const result = state.resolveMelee(unit, target);
    this._showMeleeResult(result);
    this._abilityMode = null;
    this._chargeTargets = null;
    this.renderer.moveHighlights   = [];
    this.renderer.attackHighlights = [];
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
      // planTurn returned nothing — either all AI units are already activated
      // this round, or the AI has no living units left.
      // endActivation() returns early when activeUnit===null (nothing to end),
      // leaving currentPlayer=1 and the game deadlocked.
      // Fix: find any unactivated living AI unit and end its activation properly,
      // OR if all AI units are done, force-advance the round-end check.
      const state = this.engine;
      const unactivated = state.units.filter(
        u => u.alive && u.team === 1 && !state.activatedThisRound.has(u.id)
      );
      if (unactivated.length) {
        // There IS a unit but AI couldn't plan for it — activate and immediately end
        state.activateUnit(unactivated[0]);
        state.endActivation();
      } else {
        // All AI units already activated — force the round-end check
        // by running endActivation on a dummy activation of the last AI unit,
        // or just directly nudge the engine state.
        const lastAI = state.units.filter(u => u.alive && u.team === 1);
        if (lastAI.length && !state.getActiveUnit()) {
          state.activateUnit(lastAI[0]);
          state.endActivation();
        } else {
          state.endActivation();
        }
      }
      this._updateAllPanels();
      this._checkAITurn();
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
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit && state._inBounds(action.x, action.y)) {
          const _path = state.getPath(unit, action.x, action.y);
          const _from = { x: unit.x, y: unit.y };
          this.renderer.triggerMove(unit.id, _path, false);
          if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
          state.moveUnit(unit, action.x, action.y);
          state.hasMoved = true;
          state.useAction(1);
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
          state.useAction(1);
        }
        break;
      }
      case 'ability': {
        // AI uses type:'ability' for grenadier blast and medic heal
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (!unit) break;
        if (unit.ability === 'blast' && action.x !== undefined) {
          const results = state.resolveBlast(unit, action.x, action.y);
          this._showDiceResult(results[0]);
          state.useAction(1);
        } else if (unit.ability === 'heal' && action.targetId) {
          const healTarget = state.getUnit(action.targetId);
          if (healTarget) { state.tryHeal(unit, healTarget); state.useAction(1); }
        }
        break;
      }
      case 'reload':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.reloadWeapon(unit); state.useAction(1); }
        break;
      case 'overwatch':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.setOverwatch(unit); state.useAction(2); }
        break;
      case 'cover':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { unit.inCover = true; state.addLog(`🛡️ ${unit.name} takes cover!`, 'ability'); state.useAction(1); }
        break;
      case 'pickup_bomb':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.tryPickupBomb(unit); }
        break;
      case 'plant_bomb':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.tryPlantBomb(unit); state.useAction(1); }
        break;
      case 'defuse_bomb':
        if (!state.getActiveUnit()) state.activateUnit(unit);
        if (unit) { state.tryDefuseBomb(unit); state.useAction(1); }
        break;
      case 'end':
        if (!state.getActiveUnit() && unit) state.activateUnit(unit);
        state.endActivation();
        this._clearActionVisuals();
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

    // Guard: if the engine isn't initialised yet, only allow pre-game messages.
    // Without this, an unexpected 'end' or action arriving before startGame()
    // would call state.endActivation() on a null object and crash the page.
    if (!state && !['squadReady','requestInit','init'].includes(action.type)) return;

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
      // Restore host's board, squads, units, and settings.
      // The serialized state already contains all units at x=-1,y=-1 (undeployed)
      // with the correct IDs — do NOT call startDeploy() again here, because that
      // would clear units[] and recreate them starting from _uidCounter=8, giving
      // IDs u9..u16 instead of the host's u1..u8.  deployDone lookups would then
      // find nothing and both teams would stay invisible.
      state.deserialize(action.state);
      // Ensure all units are marked undeployed so the joiner can place them
      state.units.forEach(u => { u.x = -1; u.y = -1; u.deployed = false; });
      state.phase = 'deploy';
      state.deployingTeam = 0;
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

    // ── Turn-order gate ──────────────────────────────────────────────────────

    // 'end' is handled BEFORE the currentPlayer guard because the joiner's
    // useAction may have already triggered endActivation internally (switching
    // currentPlayer away from remTeam).  The 'end' message arriving afterwards
    // is harmless — endActivation returns early if activeUnit is null — but we
    // must not drop it, otherwise the two engines can diverge on currentPlayer.
    if (action.type === 'end') {
      if (state) {
        state.endActivation();      // no-op if already ended; safe to call twice
        this._clearActionVisuals();
        this._updateAllPanels();
        if (state.phase === 'gameover') this._showGameOver();
      }
      return;
    }

    // All other actions require it to be the remote player's turn
    if (state.currentPlayer !== remTeam) return;

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
        const isRun = !!action.run;
        const legalTiles = state.getMovementRange(unit, isRun);
        const isLegal = legalTiles.some(t => t.x === action.x && t.y === action.y);
        if (!isLegal) return;
        {
          const _path = state.getPath(unit, action.x, action.y);
          const _from = { x: unit.x, y: unit.y };
          this.renderer.triggerMove(unit.id, _path, isRun);
          if (this.renderer._moveAnims[unit.id]) this.renderer._moveAnims[unit.id]._origin = _from;
        }
        state.moveUnit(unit, action.x, action.y);
        state.hasMoved = true;
        if (isRun) { state.hasRun = true; unit.hasRun = true; }
        state.useAction(1);
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
          this._applyRemoteCombatResult(unit, t, action.result);
        } else {
          const r = state.resolveShoot(unit, t);
          this._showDiceResult(r);
        }
        this.renderer.triggerFlash(t.id);
        state.useAction(1);
        break;
      }
      case 'blast': {
        if (!state._inBounds(action.x, action.y)) return;
        const blastWeapon = WEAPON_DEFS[unit.weapon] || {};
        const blastRange  = blastWeapon.range || 6;
        const dist = Math.max(Math.abs(unit.x - action.x), Math.abs(unit.y - action.y));
        if (dist > blastRange) return;
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

  _applyRemoteCombatResult(attacker, target, res) {
    if (!res || typeof res.wounds !== 'number') return;
    if (res.wounds > 0) {
      target.hp -= res.wounds;
      if (target.hp <= 0) {
        target.alive = false;
        target.hp    = 0;
        this.engine.addLog(`💀 ${target.name} is eliminated!`, 'death');
        if (this.engine.gameMode === 'ctf')  this.engine.dropFlag(target.id);
        if (this.engine.gameMode === 'bomb') this.engine.dropBomb(target.id);
        this.engine.checkObjectiveWin();
      } else {
        this.engine.addLog(`${target.name} takes ${res.wounds} damage!`, 'hit');
      }
    }
    if (res.pinned > 0 && target.alive) {
      target.pinned = true;
      this.engine.addLog(`📌 ${target.name} is pinned!`, 'hit');
    }
    if (!res.wounds && !res.pinned) {
      this.engine.addLog(`${attacker.name} misses!`, 'miss');
    }
    attacker.aiming = false;
    if (res.rolls) this._showDiceResult({ ...res, attacker: attacker.id, target: target.id });
    if (!target.alive) {
      const winner = this.engine.checkWin();
      if (winner !== null) { this.engine.phase = 'gameover'; this.engine.winner = winner; }
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
    // On mobile the panels live inside the HUD — no reparent needed,
    // the update calls above already wrote to whatever #action-buttons,
    // #team-panel-0 etc. are currently in the DOM (desktop or mobile).
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

    const weapon   = WEAPON_DEFS[unit.weapon] || WEAPON_DEFS.assaultRifle;
    // Grenadier shoots with their pistol sidearm
    const shootWeapon = (unit.sidearm && weapon.perk === 'aoeSplash')
      ? (WEAPON_DEFS[unit.sidearm] || weapon) : weapon;
    const targets  = state.getValidTargets(unit);
    const jammed   = unit.weaponJammed;
    const reload   = unit.needsReload;
    const canShoot = targets.length > 0 && al >= 1 && !unit.hasRun && !jammed && !reload;
    const canMove  = al >= 1 && !state.hasMoved;
    const canRun   = al >= 1 && state.hasMoved && !state.hasRun && !unit.hasRun && !unit.pinned;

    const addBtn = (id, label, icon, enabled, tooltip = '', cls = '') => {
      const b = document.createElement('button');
      b.className = 'action-btn' + (enabled ? '' : ' disabled') + (cls ? ' ' + cls : '');
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.title     = tooltip;
      if (enabled) b.onclick = () => UI[id]?.();
      btns.appendChild(b);
    };

    // ── Weapon status warnings ──
    if (jammed) {
      const warn = document.createElement('div');
      warn.className = 'action-warn';
      warn.innerHTML = '🔧 Weapon JAMMED — use Reload to clear';
      btns.appendChild(warn);
    }
    if (reload) {
      const warn = document.createElement('div');
      warn.className = 'action-warn';
      warn.innerHTML = '🔄 Sniper Rifle needs Reload before next shot';
      btns.appendChild(warn);
    }
    if (unit.pinned) {
      const warn = document.createElement('div');
      warn.className = 'action-warn';
      warn.innerHTML = '📌 PINNED — movement blocked this activation';
      btns.appendChild(warn);
    }

    // ── Movement ──
    addBtn('_doMoveBtn', 'Move', '👣', canMove, `Move up to MA ${unit.ma}" (${unit.ma} tiles)`);
    addBtn('btnRun',     'Run',  '🏃', canRun,  'Run: roll 1D6 extra tiles after moving. No shooting this turn.');

    // ── Shooting ──
    addBtn('btnAim',      'Aim',    '🔭', al >= 1 && canShoot, '+1 to Shooting Attack rolls on next shot');
    addBtn('_doShootBtn', 'Shoot',  '🎯', canShoot, `Fire ${shootWeapon.name} — hits on 4+ (click enemy to target)`);

    // Reload (sniper or jammed)
    if (jammed || reload) {
      addBtn('btnReload', 'Reload', '🔧', al >= 1, jammed ? 'Clear weapon jam' : 'Reload Sniper Rifle');
    }

    // ── Melee ──
    addBtn('btnCharge', 'Charge', '⚔️', al >= 2, 'Move into base contact and attack in melee');

    // ── Cover ──
    const onCoverTile = state.board[unit.y][unit.x]?.type === TILE.COVER ||
                        state.board[unit.y][unit.x]?.type === TILE.RUBBLE;
    const coverLabel  = onCoverTile ? 'Heavy Cover' : 'Light Cover';
    const coverTip    = onCoverTile
      ? 'Heavy Cover: −2 to incoming attack rolls while on this tile'
      : 'Light Cover: −1 to incoming attack rolls';
    addBtn('btnTakeCover', coverLabel, '🛡️', al >= 1, coverTip);

    // ── Specialist ability ──
    if (unit.ability) {
      const abilityLabels = {
        overwatch: 'Overwatch', heal: 'Heal', blast: 'Grenade',
        stealth: 'Stealth', command: 'Command',
      };
      addBtn('btnAbility', abilityLabels[unit.ability] || 'Ability', '⚡',
        al >= 1 && !state.abilityUsed?.has(unit.id), 'Use specialist ability');
    }

    // ── Objective buttons ──
    if (state.gameMode === 'ctf' && state.objectives?.flag) {
      const f = state.objectives.flag;
      if (f.carriedBy === null && f.capturedBy === null && unit.x === f.x && unit.y === f.y) {
        addBtn('btnPickupFlag', 'Pick Up Flag', '🚩', al >= 1, 'Pick up the flag');
      }
    }
    if (state.gameMode === 'bomb' && state.objectives) {
      const obj = state.objectives;
      if (unit.team === 0 && obj.bomb && !obj.bombPlanted &&
          obj.bomb.carriedBy === null &&
          unit.x === obj.bomb.x && unit.y === obj.bomb.y) {
        addBtn('btnPickupBomb', 'Pick Up Bomb', '💣', al >= 1, 'Pick up the bomb');
      }
      if (unit.team === 0 && obj.bomb?.carriedBy === unit.id && !obj.bombPlanted) {
        const onSite = obj.sites?.some(s => s.x === unit.x && s.y === unit.y && !s.planted);
        if (onSite) addBtn('btnPlantBomb', 'Plant Bomb', '💣', al >= 1, 'Plant the bomb');
      }
      if (unit.team === 1 && obj.bombPlanted) {
        const activeSite = obj.sites?.find(s => s.id === obj.activeSite);
        if (activeSite && unit.x === activeSite.x && unit.y === activeSite.y) {
          addBtn('btnDefuseBomb', 'Defuse Bomb', '🔧', al >= 2, 'Defuse the bomb — costs 2 actions');
        }
      }
    }

    // ── End ──
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

  btnPickupBomb() {
    const state = this.engine;
    const unit  = state.getActiveUnit();
    if (!unit || state.actionsLeft < 1) return;
    if (state.tryPickupBomb(unit)) {
      state.useAction(1);
      this._updateAllPanels();
      this._checkAITurn();
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
        const weapon = WEAPON_DEFS[u.weapon] || {};
        let statusIcon = '✅';
        if (!u.alive)       statusIcon = '💀';
        else if (u.pinned)  statusIcon = '📌';
        else if (u.inHeavyCover) statusIcon = '🛡️🛡️';
        else if (u.inCover) statusIcon = '🛡️';
        else if (u.weaponJammed) statusIcon = '🔧';
        else if (u.needsReload)  statusIcon = '🔄';
        div.innerHTML = `
          <span class="ur-icon" style="background:${UNIT_DEFS[u.type].color}">${this._unitIcon(u.type)}</span>
          <span class="ur-name">${u.name}</span>
          <span class="ur-wpn" title="${weapon.name || ''}">${u.weapon ? weapon.attackDice + 'D' : ''}</span>
          <span class="ur-status">${statusIcon}</span>
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

  _showDiceResult(result) {
    const panel = document.getElementById('dice-panel');
    if (!panel) return;

    const attUnit  = this.engine.getUnit(result.attacker);
    const defUnit  = this.engine.getUnit(result.target);
    const atkName  = attUnit?.name || '?';
    const defName  = defUnit?.name || '?';
    const wpnName  = result.weaponName || '';

    let html = `<div class="dice-result">`;
    html += `<div class="dr-title">${atkName} → ${defName}</div>`;
    if (wpnName) html += `<div class="dr-weapon">🔫 ${wpnName}</div>`;

    // Attack rolls
    html += `<div class="dr-label">Attack Dice (hit on ${result.hitTarget}+):</div>`;
    html += `<div class="dr-dice">`;
    (result.rolls || []).forEach(r => {
      const hit = r >= result.hitTarget;
      html += `<div class="die ${hit ? 'die-hit' : 'die-miss'}">${r}</div>`;
    });
    html += `</div>`;
    html += `<div class="dr-info">Need: ${result.hitTarget}+ · Hits: ${result.hitCount}</div>`;

    // Armour Saves
    if (result.armourSaves && result.armourSaves.length) {
      const ap = result.effectiveAP || 0;
      html += `<div class="dr-label">Armour Saves (AP ${ap >= 0 ? '+' : ''}${ap}) — 1-2: dmg · 3-4: pinned · 5-6: saved:</div>`;
      html += `<div class="dr-dice">`;
      result.armourSaves.forEach(s => {
        const mod = s.modified;
        let cls = 'die-save';
        let label = `${s.raw}`;
        if (ap !== 0) label += `→${mod}`;
        if (mod <= 2)      cls = 'die-hit';   // damage
        else if (mod <= 4) cls = 'die-pin';   // pinned
        // else saved
        html += `<div class="die die-small ${cls}" title="Raw ${s.raw} + AP ${ap} = ${mod}">${label}</div>`;
      });
      html += `</div>`;
    }

    // Sniper bonus damage
    if (result.sniperBonusDmg) {
      html += `<div class="dr-bonus">🎯 Sniper: +${result.sniperBonusDmg} bonus damage!</div>`;
    }

    // Outcome
    if (result.wounds > 0) {
      html += `<div class="dr-outcome wound">💀 ${result.wounds} wound${result.wounds > 1 ? 's' : ''}!</div>`;
    }
    if (result.pinned > 0) {
      html += `<div class="dr-outcome pin">📌 Pinned! Cannot move next activation.</div>`;
    }
    if (!result.wounds && !result.pinned) {
      if (result.hitCount > 0) html += `<div class="dr-outcome saved">🛡️ All saves passed!</div>`;
      else                     html += `<div class="dr-outcome miss">Miss!</div>`;
    }

    // Leader aura note
    if (result.hasLeaderAura && result.rerolled) {
      html += `<div class="dr-bonus">⭐ Leader Aura: rerolled die ${result.rerolled.from}→${result.rerolled.to}</div>`;
    }

    // Cover note
    if (result.coverType === 'light') html += `<div class="dr-info">🛡️ Light Cover applied (−1 to attack roll)</div>`;
    if (result.coverType === 'heavy') html += `<div class="dr-info">🛡️🛡️ Heavy Cover applied (−2 to attack roll)</div>`;

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

  _showUnitTooltip(unit) {
    const tt = document.getElementById('tooltip');
    if (!tt) return;
    const def    = UNIT_DEFS[unit.type];
    const weapon = WEAPON_DEFS[unit.weapon] || {};
    // For grenadier: show sidearm stats for Shoot, note grenade is via Ability
    const shootWpn = (unit.sidearm && weapon.perk === 'aoeSplash')
      ? (WEAPON_DEFS[unit.sidearm] || weapon) : weapon;
    const apStr  = shootWpn.ap ? ` AP${shootWpn.ap}` : '';
    const rngStr = shootWpn.minRange ? `${shootWpn.minRange}–${shootWpn.range}"` : `${shootWpn.range}"`;
    const grenadeNote = unit.sidearm ? `<br>💣 Grenade via Ability · ${WEAPON_DEFS[unit.weapon]?.name}` : '';
    const status = [];
    if (unit.pinned)       status.push('📌 Pinned');
    if (unit.inHeavyCover) status.push('🛡️🛡️ Heavy Cover');
    else if (unit.inCover) status.push('🛡️ Light Cover');
    if (unit.weaponJammed)  status.push('🔧 Jammed');
    if (unit.needsReload)   status.push('🔄 Needs Reload');
    tt.innerHTML = `
      <strong>${unit.name}</strong> (${this.engine.players[unit.team].name})<br>
      ❤️ ${unit.hp}/${unit.maxHp} Hearts · MA: ${unit.ma}"<br>
      🔫 ${shootWpn.name || '?'} · ${rngStr} · ${shootWpn.attackDice}D6${apStr}${grenadeNote}<br>
      ${status.length ? status.join(' · ') + '<br>' : ''}
      <em>${def?.desc || ''}</em>
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

  // ─── Mobile HUD ──────────────────────────────────────────
  _isMobile() {
    return window.innerWidth <= 768;
  },

  _mobCurrentTab: 'actions',

  // Called after startGame. Moves the real DOM panels into the HUD
  // so onclick handlers stay wired — no cloning needed.
  _mobSetupHUD() {
    if (!this._isMobile()) return;
    // Reparent action/deploy/team/log panels into the HUD content area
    // We do this by showing the HUD and pointing _updateAllPanels output
    // at the HUD content. The actual panels (#action-buttons etc.) remain
    // in the DOM but are now inside #mobile-hud-content for the active tab.
    this.mobTab('actions');
  },

  mobTab(tab) {
    this._mobCurrentTab = tab;
    if (!this._isMobile()) return;

    ['actions','teams','log'].forEach(t => {
      const btn = document.getElementById('mob-tab-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
    });

    const hud = document.getElementById('mobile-hud-content');
    if (!hud) return;
    // Clear
    hud.innerHTML = '';

    const state = this.engine;

    if (tab === 'actions') {
      if (state?.phase === 'deploy') {
        // Show deploy UI
        const title = document.createElement('div');
        title.className = 'panel-title';
        title.id = 'deploy-panel-title';
        title.textContent = document.getElementById('deploy-panel-title')?.textContent || 'DEPLOY';
        const inst = document.createElement('div');
        inst.className = 'deploy-instructions';
        inst.textContent = 'Tap a unit, then tap a highlighted tile on the map.';
        // Re-render a fresh deploy panel inside HUD
        const dp = document.createElement('div');
        dp.id = 'deploy-panel';
        const doneBtn = document.createElement('button');
        doneBtn.className = 'deploy-done-btn';
        doneBtn.id = 'deploy-done-btn';
        doneBtn.onclick = () => UI.finishDeployment();
        hud.append(title, inst, dp, doneBtn);
        // Now re-render deploy panel into the new element
        if (state) this._renderDeployPanel(this.myTeam ?? state.deployingTeam ?? 0);
      } else {
        const wrap = document.createElement('div');
        wrap.id = 'action-buttons';
        hud.appendChild(wrap);
        if (state) this._updateActionButtons(state.getActiveUnit());
      }
    } else if (tab === 'teams') {
      ['0','1'].forEach(t => {
        const h = document.createElement('div');
        h.className = 'panel-title';
        h.style.color = t === '0' ? '#3a9eff' : '#ff4545';
        h.textContent = t === '0' ? '🔵 ALPHA' : '🔴 BRAVO';
        const panel = document.createElement('div');
        panel.id = 'team-panel-' + t;
        panel.className = 'team-panel-inner';
        hud.append(h, panel);
      });
      if (state) this._updateTeamPanels();
    } else if (tab === 'log') {
      const dh = document.createElement('div');
      dh.className = 'panel-title'; dh.textContent = '🎲 DICE / LOG';
      const dp = document.createElement('div');
      dp.id = 'dice-panel';
      dp.style.cssText = 'overflow-y:auto; flex-shrink:0;';
      const lh = document.createElement('div');
      lh.className = 'panel-title'; lh.textContent = '📋 LOG';
      const lg = document.createElement('div');
      lg.id = 'combat-log';
      hud.append(dh, dp, lh, lg);
      if (state) this._updateLog();
    }
  },

  // Touch support — distinguishes tap from scroll on the canvas
  // ── Map zoom level (1.0 = 100%) ───────────────────────────
  _mapZoom: 1.0,

  _applyMapZoom() {
    const canvas  = document.getElementById('battlefield');
    const wrapper = document.getElementById('battlefield-wrapper');
    if (!canvas || !wrapper) return;

    const z = this._mapZoom;
    canvas.style.transform = `scale(${z})`;
    // Keep wrapper scrollable area in sync: the canvas occupies
    // its natural pixel size * zoom factor visually, but since
    // transform doesn't affect layout flow we need a spacer div.
    let spacer = wrapper.querySelector('.zoom-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'zoom-spacer';
      spacer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      wrapper.style.position = 'relative';
      wrapper.appendChild(spacer);
    }
    spacer.style.width  = (canvas.width  * z) + 'px';
    spacer.style.height = (canvas.height * z) + 'px';
  },

  mapZoom(dir) {
    const STEPS = [0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];
    let idx = STEPS.findIndex(s => s >= this._mapZoom - 0.01);
    if (idx < 0) idx = STEPS.length - 1;
    idx = Math.max(0, Math.min(STEPS.length - 1, idx + dir));
    this._mapZoom = STEPS[idx];
    this._applyMapZoom();
  },

  _setupTouchCanvas() {
    const canvas  = document.getElementById('battlefield');
    const wrapper = document.getElementById('battlefield-wrapper');
    if (!canvas || canvas._touchReady) return;
    canvas._touchReady = true;

    // Apply initial zoom so spacer is created
    this._applyMapZoom();

    // ── Pinch-zoom state ────────────────────────────────────
    let _pinchActive   = false;
    let _pinchDist0    = 0;
    let _pinchZoom0    = 1.0;
    // Midpoint of the pinch in wrapper-scroll space (for re-centering)
    let _pinchMidWX    = 0;
    let _pinchMidWY    = 0;

    const _touchDist = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // ── touchstart ─────────────────────────────────────────
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // Begin pinch
        _pinchActive = true;
        this._touchMoved = true;  // suppress tap
        _pinchDist0  = _touchDist(e.touches[0], e.touches[1]);
        _pinchZoom0  = this._mapZoom;
        // midpoint in viewport space
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const wr = wrapper.getBoundingClientRect();
        _pinchMidWX = mx - wr.left + wrapper.scrollLeft;
        _pinchMidWY = my - wr.top  + wrapper.scrollTop;
        e.preventDefault();
      } else {
        _pinchActive = false;
        const touch = e.changedTouches[0];
        this._touchStartX = touch.clientX;
        this._touchStartY = touch.clientY;
        this._touchMoved  = false;
      }
    }, { passive: false });

    // ── touchmove ──────────────────────────────────────────
    canvas.addEventListener('touchmove', (e) => {
      if (_pinchActive && e.touches.length === 2) {
        e.preventDefault();
        const dist   = _touchDist(e.touches[0], e.touches[1]);
        const STEPS  = [0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];
        let raw      = _pinchZoom0 * (dist / _pinchDist0);
        raw          = Math.max(STEPS[0], Math.min(STEPS[STEPS.length - 1], raw));
        // Snap to nearest step
        this._mapZoom = STEPS.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
        this._applyMapZoom();
        // Re-anchor scroll so the pinch midpoint stays fixed on screen
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const wr = wrapper.getBoundingClientRect();
        wrapper.scrollLeft = _pinchMidWX - (mx - wr.left);
        wrapper.scrollTop  = _pinchMidWY - (my - wr.top);
      } else {
        this._touchMoved = true;
      }
    }, { passive: false });

    // ── touchend ───────────────────────────────────────────
    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) _pinchActive = false;
      if (this._touchMoved) return;
      e.preventDefault();
      const touch = e.changedTouches[0];
      canvas.dispatchEvent(new MouseEvent('click', {
        clientX: touch.clientX, clientY: touch.clientY,
        bubbles: true, cancelable: true,
      }));
    }, { passive: false });
  },

  // ─── Scenario Editor ─────────────────────────────────────
  _scEngine:    null,
  _scSquads:    [[], []],
  _scMode:      'elimination',
  _scTheme:     'urban',
  _scObjectives: {},       // custom objective placements keyed by mode
  _scObjBrush:  null,      // which objective the user is currently placing

  showScenarioEditor() {
    this.showScreen('screen-scenario');
    if (!this._scEngine) this._scNewMap();
    this._scRenderAll();
    this._scRenderSquads();
    this.scSetMode(this._scMode);
  },

  _scNewMap() {
    this._scEngine = new Engine();
    this._scEngine.generateBoard(this._scTheme, 'medium');
    this._scEngine.theme = this._scTheme;
  },

  scSetMode(mode) {
    this._scMode = mode;
    document.querySelectorAll('[data-sc-mode]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-sc-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    this._scRenderObjectivePanel();
    this._scRenderAll();
  },

  scSetTheme(theme) {
    this._scTheme = theme;
    document.querySelectorAll('[data-sc-theme]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-sc-theme="${theme}"]`);
    if (btn) btn.classList.add('active');
    if (this._scEngine) { this._scEngine.theme = theme; this._scRenderAll(); }
  },

  scRerollMap() {
    this._scNewMap();
    this._scRenderAll();
    this._scSetStatus('New map generated.');
  },

  scOpenMapEditor() {
    const prev = this._previewEngine;
    this._previewEngine = this._scEngine;
    this.openMapEditor();
    const origClose = this.closeMapEditor.bind(this);
    this.closeMapEditor = () => {
      origClose();
      this._previewEngine = prev;
      this._scRenderAll();
      this.closeMapEditor = origClose;
    };
  },

  // ── Objective placement brush ────────────────────────────
  // Each mode has a set of placeable items. User clicks a brush button then
  // clicks on the preview canvas to place that item at a tile.
  _scObjDefs() {
    return {
      ctf:         [{ key:'flag',    label:'🚩 Flag',       desc:'Flag start position' }],
      bomb:        [{ key:'bomb',    label:'💣 Bomb',       desc:'Bomb start position' },
                   { key:'site_a',  label:'📍 Site A',     desc:'Bomb plant site A' },
                   { key:'site_b',  label:'📍 Site B',     desc:'Bomb plant site B' }],
      vip:         [{ key:'extract',label:'🚁 Extract',    desc:'VIP extraction point' }],
      elimination: [],
    };
  },

  scSetObjBrush(key) {
    this._scObjBrush = (this._scObjBrush === key) ? null : key; // toggle off if same
    this._scRenderObjectivePanel();
    this._scSetStatus(this._scObjBrush
      ? `Click on the map to place: ${key}`
      : 'Brush deselected.');
  },

  _scRenderObjectivePanel() {
    const el = document.getElementById('sc-obj-panel');
    if (!el) return;
    const defs = (this._scObjDefs()[this._scMode] || []);
    if (!defs.length) {
      el.innerHTML = '<span style="color:var(--text2);font-size:12px;">No objectives for this mode.</span>';
      this._scObjBrush = null;
      return;
    }
    el.innerHTML = '';
    defs.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'density-btn' + (this._scObjBrush === d.key ? ' active' : '');
      btn.textContent = d.label;
      btn.title = d.desc;
      btn.onclick = () => this.scSetObjBrush(d.key);
      // Show current placement if set
      const pos = this._scObjectives[d.key];
      const posStr = pos ? ` (${pos.x},${pos.y})` : ' — not placed';
      const info = document.createElement('span');
      info.style.cssText = 'font-size:11px;color:var(--text2);margin-left:4px;';
      info.textContent = posStr;
      el.appendChild(btn);
      el.appendChild(info);
      el.appendChild(document.createElement('br'));
    });
  },

  // ── Preview canvas (map + objectives) ───────────────────
  _scRenderAll() {
    this._scRenderPreview();
    this._scRenderObjectivePanel();
    this._scAttachPreviewClicks();
  },

  _scRenderPreview() {
    const eng = this._scEngine;
    if (!eng) return;
    const canvas = document.getElementById('sc-preview');
    if (!canvas) return;
    const T = 14;
    canvas.width  = CFG.COLS * T;
    canvas.height = CFG.ROWS * T;
    const ctx = canvas.getContext('2d');
    const thm = THEMES[eng.theme] || THEMES.urban;

    // Tiles
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

    // Deploy zone tints
    ctx.fillStyle = 'rgba(58,158,255,0.18)';
    ctx.fillRect(0, 0, T * 4, CFG.ROWS * T);
    ctx.fillStyle = 'rgba(255,69,69,0.18)';
    ctx.fillRect(T * (CFG.COLS - 4), 0, T * 4, CFG.ROWS * T);

    // Draw placed objectives
    const objIcons = { flag:'🚩', bomb:'💣', site_a:'🅰', site_b:'🅱', extract:'🚁' };
    Object.entries(this._scObjectives).forEach(([key, pos]) => {
      if (!pos) return;
      ctx.font = `${T - 2}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(objIcons[key] || '📍', pos.x * T + T / 2, pos.y * T + T / 2);
    });

    // Cursor highlight for active brush
    if (this._scObjBrush) {
      ctx.strokeStyle = 'rgba(255,220,0,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
      ctx.setLineDash([]);
    }

    canvas._T = T;
  },

  _scAttachPreviewClicks() {
    const canvas = document.getElementById('sc-preview');
    if (!canvas || canvas._scClickAttached) return;
    canvas._scClickAttached = true;
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('click', (e) => {
      if (!this._scObjBrush) return;
      const rect = canvas.getBoundingClientRect();
      const T    = canvas._T || 14;
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const tx = Math.floor((e.clientX - rect.left) * scaleX / T);
      const ty = Math.floor((e.clientY - rect.top)  * scaleY / T);
      if (!this._scEngine._inBounds(tx, ty)) return;
      if (this._scEngine.board[ty][tx].type === TILE.BUILDING) {
        this._scSetStatus('Cannot place on a building tile.'); return;
      }
      this._scObjectives[this._scObjBrush] = { x: tx, y: ty };
      this._scSetStatus(`${this._scObjBrush} placed at (${tx},${ty})`);
      this._scRenderAll();
    });
  },

  // ── Squads ───────────────────────────────────────────────
  scAddUnit(team, type) {
    if (this._scSquads[team].length >= 6) {
      this._scSetStatus('Max 6 units per team.'); return;
    }
    this._scSquads[team].push(type);
    this._scRenderSquads();
    this._scSetStatus('');
  },

  scRemoveUnit(team, idx) {
    this._scSquads[team].splice(idx, 1);
    this._scRenderSquads();
  },

  _scRenderSquads() {
    const icons  = { rifleman:'🔫', sniper:'🎯', medic:'💉', grenadier:'💣', leader:'⭐', scout:'🏹' };
    const colors = { rifleman:'#4a7fc1', sniper:'#7a5c2a', medic:'#2a7a4a',
                     grenadier:'#7a2a2a', leader:'#7a6a1a', scout:'#2a5a4a' };
    [0, 1].forEach(team => {
      const el = document.getElementById(`sc-squad-${team}`);
      if (!el) return;
      el.innerHTML = '';
      if (!this._scSquads[team].length) {
        el.innerHTML = '<span style="color:var(--text2);font-size:12px;padding:4px;">No units yet</span>';
        return;
      }
      this._scSquads[team].forEach((type, idx) => {
        const chip = document.createElement('div');
        chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:3px 8px;` +
          `border-radius:12px;background:${colors[type]||'#555'};font-size:12px;cursor:pointer;`;
        chip.title = 'Click to remove';
        chip.textContent = `${icons[type]||'?'} ${type}`;
        chip.onclick = () => this.scRemoveUnit(team, idx);
        el.appendChild(chip);
      });
    });
  },

  _scSetStatus(msg) {
    const el = document.getElementById('sc-status');
    if (el) el.textContent = msg;
  },

  // ── Validation & play ────────────────────────────────────
  _scValidate() {
    if (!this._scEngine)                          return 'Generate a map first.';
    if (!this._scSquads[0].length)                return 'Alpha team needs units.';
    if (!this._scSquads[1].length)                return 'Bravo team needs units.';
    if (!this._scSquads[0].includes('leader'))    return 'Alpha needs a Leader.';
    if (!this._scSquads[1].includes('leader'))    return 'Bravo needs a Leader.';
    const mode = this._scMode;
    const obj  = this._scObjectives;
    if (mode === 'ctf'  && !obj.flag)              return 'Place the CTF flag on the map.';
    if (mode === 'bomb' && !obj.bomb)              return 'Place the bomb on the map.';
    if (mode === 'bomb' && !obj.site_a)            return 'Place bomb site A on the map.';
    if (mode === 'bomb' && !obj.site_b)            return 'Place bomb site B on the map.';
    if (mode === 'vip'  && !obj.extract)           return 'Place the VIP extraction point.';
    return null;
  },

  scPlayScenario() {
    const err = this._scValidate();
    if (err) { this._scSetStatus('⚠️ ' + err); return; }

    const scEng = this._scEngine;

    // Stamp objective positions onto the engine so initObjectives uses them.
    // We do this by patching initObjectives to use our custom positions
    // for the one _beginBattle call, then restore it.
    scEng._scCustomObjectives = this._scObjectives;

    // Wire squads and mode
    scEng.players[0].squadDef = this._scSquads[0].slice();
    scEng.players[1].squadDef = this._scSquads[1].slice();
    scEng.mode           = 'ai';
    scEng.gameMode       = this._scMode;
    scEng.bombFuseLength = 8;
    scEng.bombAttackerTeam = (this.bombAttackerTeam === 1) ? 1 : 0;

    // Inject directly — bypass renderBattlefieldPreview which would overwrite the board
    this._previewEngine = scEng;
    this.armyDraft      = [scEng.players[0].squadDef, scEng.players[1].squadDef];
    this.mode           = 'ai';
    this.gameMode       = this._scMode;
    this.theme          = this._scTheme;
    this.ai             = new AIPlayer(1);

    this.startGame();
    this._scSetStatus('');
  },

  // ── Save / Load ──────────────────────────────────────────
  scSave() {
    const err = this._scValidate();
    if (err) { this._scSetStatus('⚠️ ' + err); return; }
    const name = (document.getElementById('sc-name')?.value.trim()) || 'scenario';
    const eng  = this._scEngine;
    const data = {
      version:    2,
      name,
      gameMode:   this._scMode,
      theme:      this._scTheme,
      squads:     [this._scSquads[0].slice(), this._scSquads[1].slice()],
      objectives: this._scObjectives,
      board:      eng.board,
      buildings:  eng.buildings,
      coverObjs:  eng.coverObjs,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    this._scSetStatus(`✅ Saved "${name}.json"`);
  },

  scLoad(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.board || !data.squads) throw new Error('Invalid scenario file.');
        const eng = new Engine();
        eng.board     = data.board;
        eng.buildings = data.buildings || [];
        eng.coverObjs = data.coverObjs || [];
        eng.theme     = data.theme || 'urban';
        this._scEngine     = eng;
        this._scSquads     = [data.squads[0] || [], data.squads[1] || []];
        this._scMode       = data.gameMode || 'elimination';
        this._scTheme      = data.theme    || 'urban';
        this._scObjectives = data.objectives || {};
        const nameEl = document.getElementById('sc-name');
        if (nameEl) nameEl.value = data.name || '';
        this.scSetMode(this._scMode);
        this.scSetTheme(this._scTheme);
        this._scRenderAll();
        this._scRenderSquads();
        this._scSetStatus(`✅ Loaded "${data.name}"`);
      } catch (err) {
        this._scSetStatus('❌ Failed to load: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  },

};
