// ============================================================
//  ROGUE WARRIORS DIGITAL — CONFIG
// ============================================================

const CFG = {
  TILE:    52,
  COLS:    20,
  ROWS:    15,
  MAX_SQUAD: 8,
  MIN_SQUAD: 4,
};

// ─── Weapon definitions (from Rogue Warriors rulebook) ───────
// range in tiles (1 tile ≈ 1"), attackDice, damage, ap (negative = worse save for target)
// perk/drawback strings are handled in engine resolveShoot()
const WEAPON_DEFS = {
  pistol: {
    name: 'Pistol / Revolver', range: 6, attackDice: 2, damage: 1, ap: 0,
    perk: 'dualWield',   // If two pistols: Attack Dice = 4
    drawback: null,
    desc: 'Sidearm. Dual-wield two pistols for 4 Attack Dice.',
  },
  shotgun: {
    name: 'Shotgun', range: 8, attackDice: 3, damage: 1, ap: -1,
    perk: 'knockback',   // If Hit, knock back target 1"
    drawback: null,
    desc: 'Powerful close-range weapon. Hits knock the target back 1 tile.',
  },
  smg: {
    name: 'Submachine Gun', range: 12, attackDice: 5, damage: 1, ap: 0,
    perk: null,
    drawback: 'minusOneShoot',  // -1 to Shooting Attacks (attack roll needs +1 to target)
    desc: 'High rate of fire but harder to control. -1 to Shooting Attack rolls.',
  },
  assaultRifle: {
    name: 'Assault Rifle', range: 18, attackDice: 3, damage: 1, ap: 0,
    perk: 'triSixAP',    // 3x Natural 6s = -1 Armour Piercing
    drawback: 'weaponJam', // 3x Natural 1s = Weapon Jam (spend Shoot action to clear)
    desc: 'Versatile standard weapon. Three 6s deals -1 AP; three 1s causes a Jam.',
  },
  lmg: {
    name: 'Light Machine Gun', range: 24, minRange: 3, attackDice: 4, damage: 1, ap: 0,
    perk: 'autoPin',     // Natural 6 = Auto Pin (Target still makes Armour Save)
    drawback: 'minusOneMA', // -1 to MA (Scout can't equip)
    desc: 'Ranged 3–24". Natural 6 to hit auto-Pins target. -1 MA. Scout cannot use.',
  },
  sniperRifle: {
    name: 'Sniper Rifle', range: 36, minRange: 6, attackDice: 1, damage: 1, ap: -1,
    perk: 'auto1D3Dmg',  // Auto 1D3 damage if hit (Target still makes Armour Save)
    drawback: 'mustReload', // Must Reload as a Shoot action after firing
    desc: 'Ranged 6–36". On a hit, target takes 1D3 damage. Must reload after each shot.',
  },
  meleeCMW: {
    name: 'Combat Melee Weapon', range: 1, attackDice: 1, damage: 1, ap: 0,
    perk: 'extraMDPDice', // Add 1 dice to starting MDP
    drawback: null,
    desc: 'Melee weapon (base contact). Grants an extra starting MDP die.',
  },
  fragGrenade: {
    name: 'Frag Grenade', range: 6, attackDice: 1, damage: 1, ap: -2,
    perk: 'aoeSplash',   // Auto-hit everyone within 3" of landing spot; ignores cover
    drawback: 'dud',     // Attack roll of 1 → roll 1D6; on 1 = detonates in hand
    desc: 'Thrown 6". Scatter 1D3" on miss. Hits everyone within 3". Ignores cover. Dud on 1.',
  },
};

// ─── Unit definitions ────────────────────────────────────────
// All Warriors have MA 5" and 1 Heart (hp). Weapons give the combat stats.
// ma: Movement Allowance in tiles. hp: Hearts (health).
const UNIT_DEFS = {
  rifleman: {
    name: 'Rifleman', cost: 1,
    ma: 5, hp: 6,
    weapon: 'assaultRifle',
    color: '#3a86ff', ability: null, icon: 'rifle',
    desc: 'Standard warrior with Assault Rifle. Reliable at all ranges.',
  },
  sniper: {
    name: 'Sniper', cost: 2,
    ma: 5, hp: 6,
    weapon: 'sniperRifle',
    color: '#2dc653', ability: 'overwatch', icon: 'scope',
    desc: 'Long-range specialist. Sniper Rifle deals 1D3 damage on a hit. Must reload after firing.',
  },
  medic: {
    name: 'Medic', cost: 2,
    ma: 5, hp: 6,
    weapon: 'smg',
    color: '#e63946', ability: 'heal', icon: 'cross',
    desc: 'Armed with SMG. Can heal wounds or revive an adjacent ally once per game.',
  },
  grenadier: {
    name: 'Grenadier', cost: 2,
    ma: 5, hp: 6,
    weapon: 'fragGrenade',
    sidearm: 'pistol',      // Can Shoot with pistol; uses Grenade only via Ability
    color: '#fb8500', ability: 'blast', icon: 'grenade',
    desc: 'Frag Grenades hit everyone within 3", ignore cover. Careful — a 1 means a dud!',
  },
  leader: {
    name: 'Leader', cost: 2,
    ma: 5, hp: 6,
    weapon: 'assaultRifle',
    color: '#ffbe0b', ability: 'command', icon: 'star',
    desc: 'Command Aura: allies within 3 tiles may reroll one failed attack die.',
  },
  scout: {
    name: 'Scout', cost: 2,
    ma: 6, hp: 6,           // Scout has MA 6 as a perk (cannot use LMG)
    weapon: 'smg',
    color: '#8338ec', ability: 'stealth', icon: 'arrow',
    desc: 'Fast mover (MA 6). SMG-armed. Stealth: enemies need 6 to hit while in cover.',
  },
};

// ─── Terrain themes ──────────────────────────────────────────
const THEMES = {
  desert: {
    label: 'Desert',
    base:  '#c4a044',
    baseAlt:'#b89038',
    buildingColor:'#8b6914',
    buildingRoof:'#a07820',
    coverColor:'#9a7a28',
    groundVariant: 'sand',
  },
  urban: {
    label: 'Urban',
    base:  '#6b6b6b',
    baseAlt:'#5e5e5e',
    buildingColor:'#444444',
    buildingRoof:'#3a3a3a',
    coverColor:'#555555',
    groundVariant: 'concrete',
  },
  arctic: {
    label: 'Arctic',
    base:  '#d4e8f0',
    baseAlt:'#c8dde8',
    buildingColor:'#8aabbf',
    buildingRoof:'#7090a0',
    coverColor:'#a0c0d0',
    groundVariant: 'snow',
  },
  forest: {
    label: 'Forest',
    base:  '#3c7a3c',
    baseAlt:'#357035',
    buildingColor:'#5a4020',
    buildingRoof:'#4a3418',
    coverColor:'#284820',
    groundVariant: 'grass',
  },
};

// ─── Team colours ────────────────────────────────────────────
const TEAM_COLORS = ['#3a9eff', '#ff4545'];
const TEAM_NAMES  = ['Alpha Team', 'Bravo Team'];

// ─── Tile types ──────────────────────────────────────────────
const TILE = {
  OPEN:     'open',
  BUILDING: 'building',
  COVER:    'cover',   // low cover objects (sandbags, crates, walls)
  WATER:    'water',
  RUBBLE:   'rubble',
};

// ─── Action list ─────────────────────────────────────────────
const ACTIONS = {
  MOVE:    { id:'move',    label:'Move',      cost:1, icon:'👣', desc:'Move up to your MA (Movement Allowance) in tiles.' },
  RUN:     { id:'run',     label:'Run',       cost:1, icon:'🏃', desc:'Run an additional 1D6 tiles after moving. Cannot shoot this activation.' },
  SHOOT:   { id:'shoot',   label:'Shoot',     cost:1, icon:'🎯', desc:'Fire at an enemy in range and LOS. Hits on 4+ (modified by cover, aim, range).' },
  AIM:     { id:'aim',     label:'Aim',       cost:1, icon:'🔭', desc:'+1 to Shooting Attack rolls on your next Shoot action.' },
  COVER:   { id:'cover',   label:'Take Cover',cost:1, icon:'🛡️', desc:'Take Light Cover (−1 attacks) on cover tile, or Heavy Cover (−2) when hunkered down.' },
  CHARGE:  { id:'charge',  label:'Charge',    cost:2, icon:'⚔️', desc:'Move into base contact and make a melee attack.' },
  ABILITY: { id:'ability', label:'Ability',   cost:1, icon:'⚡', desc:'Use your specialist ability.' },
  END:     { id:'end',     label:'End',       cost:0, icon:'✅', desc:'End this activation early.' },
};

const MAX_ACTIONS = 2;

// ─── Game modes ──────────────────────────────────────────────
const GAME_MODES = {
  elimination: {
    id: 'elimination',
    label: 'Elimination',
    icon: '💀',
    desc: 'Eliminate all enemy units to win.',
  },
  ctf: {
    id: 'ctf',
    label: 'Capture the Flag',
    icon: '🚩',
    desc: 'Carry the flag from the centre back to your deployment zone.',
  },
  bomb: {
    id: 'bomb',
    label: 'Plant the Bomb',
    icon: '💣',
    desc: 'Attackers plant the bomb at a site. Defenders must defuse it within 8 rounds.',
  },
  vip: {
    id: 'vip',
    label: 'VIP Escort',
    icon: '👑',
    desc: 'Alpha escorts the VIP across the map. Bravo must eliminate the VIP.',
  },
};
