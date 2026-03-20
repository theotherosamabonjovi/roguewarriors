# ⚔ Rogue Warriors Digital

A browser-based tactical skirmish game adapted from the *Rogue Warriors: A Modern Warfare Skirmish Game* ruleset by Tabletop Skirmish Games.

## 🚀 Deploying to GitHub Pages

### Step 1 — Create a GitHub repository
1. Go to [github.com](https://github.com) and sign in
2. Click **+** → **New repository**
3. Name it `rogue-warriors` (or anything you like)
4. Set it to **Public**
5. Click **Create repository**

### Step 2 — Upload the files
Upload all these files, preserving the folder structure:
```
index.html
css/
  game.css
js/
  config.js
  engine.js
  renderer.js
  ai.js
  multiplayer.js
  ui.js
```

**Via GitHub web UI:**
1. On your repo page, click **Add file → Upload files**
2. Drag the entire folder contents in, or upload files individually
3. Make sure `css/` and `js/` folders are maintained
4. Click **Commit changes**

**Via Git CLI:**
```bash
git init
git add .
git commit -m "Initial Rogue Warriors deploy"
git remote add origin https://github.com/YOUR_USERNAME/rogue-warriors.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages
1. Go to your repo → **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Choose branch: `main`, folder: `/ (root)`
4. Click **Save**
5. Wait ~2 minutes, then visit: `https://YOUR_USERNAME.github.io/rogue-warriors/`

Share that URL with friends to play!

---

## 🎮 How to Play

### Game Modes
- **vs AI** — Solo play against the computer
- **Local 2-Player** — Pass-and-play on the same device
- **Online Multiplayer** — P2P via PeerJS, no server needed
  - Player 1 clicks **Host** → shares the Room Code
  - Player 2 enters the code → clicks **Join**

### Rules Summary
- Build a Fire Team (4–8 units, must include 1 Leader, 10pt budget)
- **Alternate Activations** — players take turns activating one unit
- Each unit gets **2 Actions**: Move, Sprint, Shoot, Aim, Take Cover, Charge, or Ability
- **Shooting**: Roll dice vs your Shoot Skill. Hits trigger defender saves
- **Cover** gives +1 Defense. Being in cover helps both movement and shooting
- **Win** by eliminating all enemy units

### Unit Types
| Unit       | Move | Hit  | Range | Dice | Def | Ability   |
|------------|------|------|-------|------|-----|-----------|
| Rifleman   | 4    | 4+   | 10    | 1d6  | 4+  | —         |
| Sniper     | 3    | 3+   | 16    | 1d6  | 5+  | Overwatch |
| Medic      | 4    | 5+   | 8     | 1d6  | 4+  | Heal      |
| Grenadier  | 4    | 4+   | 6     | 2d6  | 4+  | Blast     |
| Leader     | 4    | 4+   | 10    | 1d6  | 3+  | Command   |
| Scout      | 6    | 5+   | 10    | 1d6  | 4+  | Stealth   |

---

## 🛠 Tech Stack
- Vanilla HTML/CSS/JavaScript — no frameworks, no build tools
- Canvas API for battlefield rendering
- [PeerJS](https://peerjs.com) for peer-to-peer multiplayer

---

*This is a fan adaptation for personal/educational use. The original Rogue Warriors rules are by Lee Fox-Smith / Tabletop Skirmish Games.*
