# ⚔ Rogue Warriors Digital

https://theotherosamabonjovi.github.io/roguewarriors/

A browser-based tactical skirmish game adapted from the *Rogue Warriors: A Modern Warfare Skirmish Game* ruleset by Tabletop Skirmish Games
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
