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

  // Host a game — returns room code via callback
  host(onCode, onConnect) {
    this.isHost = true;
    this.peer   = new Peer(undefined, { debug: 0 });

    this.peer.on('open', (id) => {
      this.roomCode = id;
      if (onCode) onCode(id);
    });

    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._setupConn(conn, onConnect);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS host error:', err);
      UI.showNotif('Connection error: ' + err.type, 'error');
    });
  }

  // Join a game by room code
  join(code, onConnect) {
    this.isHost = false;
    this.peer   = new Peer(undefined, { debug: 0 });

    this.peer.on('open', () => {
      this.conn = this.peer.connect(code, { reliable: true });
      this._setupConn(this.conn, onConnect);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS join error:', err);
      UI.showNotif('Could not connect to room: ' + code, 'error');
    });
  }

  _setupConn(conn, onConnect) {
    conn.on('open', () => {
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
