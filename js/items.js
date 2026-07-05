'use strict';
/* ===== Armory catalog: weapons, utilities, upgrades, skins =====
 * Every item has a `level` gate (1-5). Locked items show in the shop
 * but cannot be purchased until the player reaches that level.
 */

const WEAPONS = [
  { id: 'missile',     name: 'Basic Missile',   price: 0,    level: 1, qty: 0, unlimited: true,
    dmg: 30,  radius: 24,  bubble: 'default',     desc: 'Reliable, free, unlimited.' },
  { id: 'dirt',        name: 'Dirt Bomb',       price: 1200,  level: 1, qty: 3, special: 'dirt',
    dmg: 0,   radius: 46,  bubble: 'dirt',        desc: 'Deposits a soil mound. Bury your enemies.' },
  { id: 'babynuke',    name: 'Baby Nuke',       price: 1800,  level: 1, qty: 2, nuclear: true,
    dmg: 48,  radius: 40,  shake: 8,  bubble: 'nuke', desc: 'Small nuke, big attitude.' },
  { id: 'bouncer',     name: 'Bouncer',         price: 1500,  level: 1, qty: 3, special: 'bouncer',
    dmg: 35,  radius: 26,  bubble: 'bouncer',     desc: 'Reflects off slopes up to 3 times.' },
  { id: 'roller',      name: 'Roller',          price: 2500,  level: 2, qty: 3, special: 'roller',
    dmg: 45,  radius: 30,  bubble: 'roller',      desc: 'Rolls downhill, detonates on contact or rest.' },
  { id: 'megadirt',    name: 'Mega Dirt Bomb',  price: 3000,  level: 2, qty: 2, special: 'dirt',
    dmg: 0,   radius: 85,  bubble: 'dirt',        desc: 'A truly offensive amount of soil.' },
  { id: 'tacnuke',     name: 'Tactical Nuke',   price: 4500,  level: 2, qty: 2, nuclear: true,
    dmg: 72,  radius: 60,  shake: 14, bubble: 'nuke', desc: 'City-block demolition in a shell.' },
  { id: 'napalm',      name: 'Napalm',          price: 4000,  level: 2, qty: 2, special: 'napalm',
    dmg: 0,   radius: 18,  bubble: 'napalm',      desc: 'Burning droplets roll downhill and melt terrain.' },
  { id: 'leapfrog',    name: 'LeapFrog',        price: 5000,  level: 3, qty: 2, special: 'leapfrog',
    dmg: 32,  radius: 28,  bubble: 'leapfrog',    desc: 'Hops and detonates three times.' },
  { id: 'fissure',     name: 'Fissure Charge',  price: 6000,  level: 3, qty: 2, special: 'fissure',
    dmg: 22,  radius: 18,  bubble: 'fissure',     desc: 'Splits the earth down to the bedrock.' },
  { id: 'mirv',        name: 'MIRV',            price: 7500,  level: 3, qty: 2, special: 'mirv', splitCount: 3,
    dmg: 34,  radius: 28,  bubble: 'mirv',        desc: 'Splits into 3 warheads at apex.' },
  { id: 'laser',       name: 'Orbital MASER',   price: 8000,  level: 3, qty: 2, special: 'maser',
    dmg: 60,  radius: 26,  bubble: 'laser',       desc: 'Shell marks the target; a MASER strike fires from orbit.' },
  { id: 'homing',      name: 'Homing Missile',  price: 9500,  level: 4, qty: 2, special: 'homing',
    dmg: 45,  radius: 30,  bubble: 'homing',      desc: 'Steers toward the nearest enemy mid-air.' },
  { id: 'railgun',     name: 'Railgun',         price: 10000, level: 4, qty: 2, special: 'railgun',
    dmg: 55,  radius: 24,  bubble: 'rail',        desc: 'Hypervelocity slug. Immune to wind.' },
  { id: 'kinetic',     name: 'Kinetic Rods',    price: 15000, level: 5, qty: 1, special: 'kinetic',
    dmg: 45,  radius: 30,  bubble: 'kinetic',     desc: 'Marks a target for rods dropped from orbit.' },
  { id: 'singularity', name: 'Singularity',     price: 18000, level: 5, qty: 1, special: 'singularity',
    dmg: 70,  radius: 60,  bubble: 'singularity', desc: 'Gravity vortex draws in everything, then detonates.' },
  { id: 'thermo',      name: 'Thermonuclear',   price: 25000, level: 5, qty: 1, nuclear: true,
    dmg: 120, radius: 115, shake: 30, flash: true, bubble: 'thermo', desc: 'Map-carving apocalypse.' },
  { id: 'neutron',     name: 'Neutron Bomb',    price: 60000, level: 5, qty: 1, nuclear: true,
    special: 'neutron', confirm: true, maxQty: 1,
    dmg: 210, radius: 195, radNear: 90, radFar: 40, shake: 64, flash: true, bubble: 'neutron',
    desc: 'THE GRANDDADDY. A colossal blast plus shield-piercing radiation across the ENTIRE map.' },
  { id: 'decoy',       name: 'Decoy Tank',      price: 3500,  level: 2, qty: 2, special: 'decoy',
    dmg: 0,   radius: 10,  bubble: 'decoy',       desc: 'Deploys an inflatable tank that draws enemy fire.' },
  { id: 'grapple',     name: 'Grappling Shot',  price: 4000,  level: 2, qty: 3, special: 'grapple',
    dmg: 10,  radius: 18,  pullRadius: 150, bubble: 'grapple',
    desc: 'Yanks nearby tanks toward the impact point.' },
  { id: 'glacier',     name: 'Glacier Bomb',    price: 5500,  level: 3, qty: 2, special: 'glacier',
    dmg: 10,  radius: 22,  freezeHalf: 110, bubble: 'ice',
    desc: 'Freezes the ground into slick, blast-proof ice for the round.' },
  { id: 'quake',       name: 'Quake Charge',    price: 6500,  level: 3, qty: 2, special: 'quake',
    dmg: 18,  radius: 20,  quakeRange: 260, bubble: 'quake',
    desc: 'Ripples the terrain in a shockwave, tossing tanks about.' },
  { id: 'teleport',    name: 'Teleporter Round', price: 7000, level: 3, qty: 2, special: 'teleport',
    dmg: 0,   radius: 10,  bubble: 'teleport',
    desc: 'You appear wherever the shell lands. Choose wisely.' },
  { id: 'acidrain',    name: 'Acid Rain Shell', price: 8500,  level: 4, qty: 2, special: 'acid',
    dmg: 8,   radius: 16,  bubble: 'acid',
    desc: 'Seeds a corrosive downpour that drifts with the wind.' },
  { id: 'napalmmirv',  name: 'Napalm MIRV',     price: 9000,  level: 4, qty: 2, special: 'mirv',
    subSpecial: 'napalm', splitCount: 3, napalmCount: 14,
    dmg: 20,  radius: 24,  bubble: 'napalm',
    desc: 'Splits at apex into three napalm payloads. Sleep well.' },
  { id: 'emp',         name: 'EMP Burst',       price: 9500,  level: 4, qty: 2, special: 'emp',
    dmg: 12,  radius: 26,  empRadius: 140, empDrain: 60, bubble: 'emp',
    desc: 'Drains shields and fries electronics (mag-shield, targeting) for a turn.' },
  { id: 'carpet',      name: 'Carpet Bomb',     price: 11000, level: 4, qty: 1, special: 'carpet',
    dmg: 10,  radius: 16,  subDmg: 22, subRadius: 22, bombs: 8, bubble: 'carpet',
    desc: 'Calls a bomber to lay a stick of bombs across the mark.' },
  { id: 'meteor',      name: 'Meteor Shower',   price: 14000, level: 5, qty: 1, special: 'meteor',
    dmg: 15,  radius: 20,  subDmg: 20, subRadius: 26, count: 10, bubble: 'meteor',
    desc: 'Ten meteors, anywhere, everywhere. Chaos as a service.' },
  { id: 'refund',      name: 'The Refund',      price: 1,     level: 5, qty: 1, maxQty: 2, gamble: true,
    dmg: 30,  radius: 24,  jackpotDmg: 90, selfDmg: 45, bubble: 'refund',
    desc: '50% triple damage. 50% detonates in the barrel. You get what you pay for.' },
];

const UTILITIES = [
  { id: 'parachute', name: 'Parachute',         price: 1000, level: 1, qty: 2,
    desc: 'Auto-deploys on dangerous falls. Consumed on landing.' },
  { id: 'superfuel', name: 'Super Fuel Pack',   price: 1000, level: 1, qty: 1,
    desc: '+100 fuel at the start of the next round.' },
  { id: 'shield',    name: 'Shield Generator',  price: 2500, level: 1, qty: 1,
    desc: 'Energy dome absorbing 100 damage. Activate with [X].' },
  { id: 'battery',   name: 'Shield Battery',    price: 1500, level: 2, qty: 1,
    desc: 'Recharges an active shield by 50. Press [X] while shielded.' },
  { id: 'predeploy', name: 'Pre-Deploy Shield', price: 3000, level: 2, checkbox: true,
    desc: 'Spawn next round with a shield already active.' },
];

const UPGRADES = [
  { id: 'targetcomp', name: 'Target Computer',   price: 4000,  level: 1,
    desc: 'Shows a basic trajectory line while aiming.' },
  { id: 'engine',     name: 'Engine Upgrade',    price: 6000,  level: 2,
    desc: 'Halves fuel consumption when driving.' },
  { id: 'treads',     name: 'Tread Upgrade',     price: 7000,  level: 3,
    desc: 'Doubles slope-climbing capacity.' },
  { id: 'reticle',    name: 'Advanced Reticle',  price: 9000,  level: 3,
    desc: 'Marks the predicted ground impact point.' },
  { id: 'weather',    name: 'Weather Predictor', price: 11000, level: 4,
    desc: 'Trajectory preview factors in wind drift.' },
  { id: 'magshield',  name: 'Magnetic Shield',   price: 12000, level: 4,
    desc: 'Passively deflects incoming enemy shells. Yours fly free.' },
];

const SKINS = [
  { id: 'default', name: 'Military Drab', price: 0,    level: 1, desc: 'Factory paint. Smells of diesel.' },
  { id: 'chroma',  name: 'Chroma Steel',  price: 5000,  level: 3, desc: 'Iridescent polished plating.' },
  { id: 'carbon',  name: 'Carbon Fiber',  price: 8000,  level: 4, desc: 'Woven composite weave finish.' },
  { id: 'neon',    name: 'Neon Grid',     price: 10000, level: 5, desc: 'Wireframe glow straight from the grid.' },
];

const ItemCatalog = (() => {
  const byId = {};
  for (const list of [WEAPONS, UTILITIES, UPGRADES, SKINS]) {
    for (const it of list) byId[it.id] = it;
  }
  return {
    byId,
    weapon(id) { return byId[id]; },
    weaponsSorted() { return [...WEAPONS].sort((a, b) => a.price - b.price); },
    utilitiesSorted() { return [...UTILITIES].sort((a, b) => a.price - b.price); },
    upgradesSorted() { return [...UPGRADES].sort((a, b) => a.price - b.price); },
    skinsSorted() { return [...SKINS].sort((a, b) => a.price - b.price); },
  };
})();
