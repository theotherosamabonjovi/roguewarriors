// ============================================================
//  ROGUE WARRIORS DIGITAL — MULTIPLAYER (PeerJS)
// ============================================================

class MultiplayerManager {
  constructor() {
    this.peer      = null;
    this.conn      = null;
    this.isHost    = false;
    this.roomCode  = null;
    this.connected = false;
    this.onAction  = null;   // callback(action)
    this.onConnect = null;   // callback()
    this.onDisconnect = null;
  }

  // Create a PeerJS peer with an auto-generated ID.
  // We call new Peer() with no arguments — the safest form across all 1.x versions.
  // Passing objects or undefined as the first argument has inconsistent behaviour
  // across PeerJS versions and signaling server implementations.
  _makePeer() {
    return new Peer();
  }

  // Host a game — calls onCode(roomCode) once the signaling server assigns an
  // ID, then calls onConnect() when the joiner's connection opens.
  host(onCode, onConnect) {
    this.isHost = true;
    this.peer   = this._makePeer();

    // If the signaling server doesn't respond within 10 s, surface an error
    // instead of leaving the user staring at a blank lobby.
    const hostTimeout = setTimeout(() => {
      if (!this.roomCode) {
        const statusEl = document.getElementById('lobby-status');
        if (statusEl) statusEl.textContent = '❌ Timed out — signaling server unreachable. Try again.';
      }
    }, 10000);

    this.peer.on('open', (id) => {
      clearTimeout(hostTimeout);
      this.roomCode = id;
      if (onCode) onCode(id);
    });

    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._setupConn(conn, onConnect);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS host error:', err);
      const statusEl = document.getElementById('lobby-status');
      if (statusEl) statusEl.textContent = '❌ Could not create room — check your connection and try again.';
      UI.showNotif('Connection error: ' + err.type, 'error');
    });
  }

  // Join a game by room code
  join(code, onConnect) {
    this.isHost = false;
    this.peer   = this._makePeer();

    const joinTimeout = setTimeout(() => {
      if (!this.connected) {
        const statusEl = document.getElementById('lobby-status');
        if (statusEl) statusEl.textContent = '❌ Timed out — could not reach signaling server. Try again.';
      }
    }, 10000);

    this.peer.on('open', () => {
      clearTimeout(joinTimeout);
      this.conn = this.peer.connect(code, { reliable: true });

      // Second timeout: peer reached the signaling server but the P2P
      // DataChannel may never open (wrong code, host gone, NAT failure).
      // Without this the joiner hangs on "Connecting…" forever.
      const connTimeout = setTimeout(() => {
        if (!this.connected) {
          const statusEl = document.getElementById('lobby-status');
          if (statusEl) statusEl.textContent = '❌ Could not reach host — check the room code and try again.';
          UI.showNotif('Could not connect to host', 'error');
        }
      }, 10000);

      this._setupConn(this.conn, onConnect, connTimeout);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS join error:', err);
      const statusEl = document.getElementById('lobby-status');
      if (statusEl) statusEl.textContent = '❌ Could not connect — check the room code and try again.';
      const safeCode = String(code).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32);
      UI.showNotif('Could not connect to room: ' + safeCode, 'error');
    });
  }

  _setupConn(conn, onConnect, connTimeout) {
    conn.on('open', () => {
      if (connTimeout) clearTimeout(connTimeout);
      this.connected = true;
      if (onConnect) onConnect();
    });

    conn.on('data', (data) => {
      if (this.onAction) this.onAction(data);
    });

    conn.on('close', () => {
      this.connected = false;
      if (this.onDisconnect) this.onDisconnect();
      UI.showNotif('Opponent disconnected', 'error');
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      const statusEl = document.getElementById('lobby-status');
      if (statusEl) statusEl.textContent = '❌ Connection error — check the room code and try again.';
    });
  }

  send(action) {
    if (this.conn && this.connected) {
      this.conn.send(action);
    }
  }

  destroy() {
    if (this.peer) { this.peer.destroy(); this.peer = null; }
    this.conn = null;
    this.connected = false;
  }
}
