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

// ─── Unit definitions ────────────────────────────────────────
const UNIT_DEFS = {
  rifleman:   { name:'Rifleman',   cost:1, move:4, skill:4, range:10, dice:1, defense:4, hp:1, color:'#3a86ff', ability:null,       icon:'rifle',   desc:'Versatile standard infantry. Reliable at all ranges.' },
  sniper:     { name:'Sniper',     cost:2, move:3, skill:3, range:16, dice:1, defense:5, hp:1, color:'#2dc653', ability:'overwatch', icon:'scope',   desc:'Long-range specialist. Can set Overwatch to react to enemy moves.' },
  medic:      { name:'Medic',      cost:2, move:4, skill:5, range:8,  dice:1, defense:4, hp:1, color:'#e63946', ability:'heal',      icon:'cross',   desc:'Can attempt to revive one fallen squad member per game.' },
  grenadier:  { name:'Grenadier',  cost:2, move:4, skill:4, range:6,  dice:2, defense:4, hp:1, color:'#fb8500', ability:'blast',     icon:'grenade', desc:'Blast weapon hits target tile and all adjacent tiles.' },
  leader:     { name:'Leader',     cost:2, move:4, skill:4, range:10, dice:1, defense:3, hp:1, color:'#ffbe0b', ability:'command',   icon:'star',    desc:'Command Aura: allies within 3 tiles reroll one failed die.' },
  scout:      { name:'Scout',      cost:2, move:6, skill:5, range:10, dice:1, defense:4, hp:1, color:'#8338ec', ability:'stealth',   icon:'arrow',   desc:'Fast mover. Enemies need double-6 to target while in cover.' },
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
  MOVE:    { id:'move',    label:'Move',     cost:1, icon:'👣', desc:'Move up to your Move value in tiles.' },
  SPRINT:  { id:'sprint',  label:'Sprint',   cost:2, icon:'🏃', desc:'Move up to 2× your Move value. Cannot shoot this activation.' },
  SHOOT:   { id:'shoot',   label:'Shoot',    cost:1, icon:'🎯', desc:'Fire at an enemy in range and line of sight.' },
  AIM:     { id:'aim',     label:'Aim',      cost:1, icon:'🔭', desc:'Gain +1 to hit on your next Shoot action this activation.' },
  COVER:   { id:'cover',   label:'Take Cover',cost:1,icon:'🛡️', desc:'Take Cover: +1 Defense until your next activation.' },
  CHARGE:  { id:'charge',  label:'Charge',   cost:2, icon:'⚔️', desc:'Move into melee range and make a close-combat attack.' },
  ABILITY: { id:'ability', label:'Ability',  cost:1, icon:'⚡', desc:'Use your specialist ability.' },
  END:     { id:'end',     label:'End',      cost:0, icon:'✅', desc:'End this activation early.' },
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
