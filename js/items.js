'use strict';
/* ===== Armory catalog: weapons, utilities, upgrades, skins =====
 * Every item has a `level` gate (1-5). Locked items show in the shop
 * but cannot be purchased until the player reaches that level.
 */

const WEAPONS = [
  { id: 'missile',     name: 'Basic Missile',   price: 0,    level: 1, qty: 0, unlimited: true,
    dmg: 30,  radius: 24,  bubble: 'default',     desc: 'Reliable, free, unlimited.' },
  { id: 'dirt',        name: 'Dirt Bomb',       price: 120,  level: 1, qty: 3, special: 'dirt',
    dmg: 0,   radius: 46,  bubble: 'dirt',        desc: 'Deposits a soil mound. Bury your enemies.' },
  { id: 'babynuke',    name: 'Baby Nuke',       price: 150,  level: 1, qty: 2, nuclear: true,
    dmg: 48,  radius: 40,  shake: 8,  bubble: 'nuke', desc: 'Small nuke, big attitude.' },
  { id: 'bouncer',     name: 'Bouncer',         price: 200,  level: 1, qty: 3, special: 'bouncer',
    dmg: 35,  radius: 26,  bubble: 'bouncer',     desc: 'Reflects off slopes up to 3 times.' },
  { id: 'roller',      name: 'Roller',          price: 300,  level: 2, qty: 3, special: 'roller',
    dmg: 45,  radius: 30,  bubble: 'roller',      desc: 'Rolls downhill, detonates on contact or rest.' },
  { id: 'megadirt',    name: 'Mega Dirt Bomb',  price: 350,  level: 2, qty: 2, special: 'dirt',
    dmg: 0,   radius: 85,  bubble: 'dirt',        desc: 'A truly offensive amount of soil.' },
  { id: 'tacnuke',     name: 'Tactical Nuke',   price: 400,  level: 2, qty: 2, nuclear: true,
    dmg: 72,  radius: 60,  shake: 14, bubble: 'nuke', desc: 'City-block demolition in a shell.' },
  { id: 'napalm',      name: 'Napalm',          price: 450,  level: 2, qty: 2, special: 'napalm',
    dmg: 0,   radius: 18,  bubble: 'napalm',      desc: 'Burning droplets roll downhill and melt terrain.' },
  { id: 'leapfrog',    name: 'LeapFrog',        price: 500,  level: 3, qty: 2, special: 'leapfrog',
    dmg: 32,  radius: 28,  bubble: 'leapfrog',    desc: 'Hops and detonates three times.' },
  { id: 'fissure',     name: 'Fissure Charge',  price: 600,  level: 3, qty: 2, special: 'fissure',
    dmg: 22,  radius: 18,  bubble: 'fissure',     desc: 'Splits the earth down to the bedrock.' },
  { id: 'mirv',        name: 'MIRV',            price: 700,  level: 3, qty: 2, special: 'mirv', splitCount: 3,
    dmg: 34,  radius: 28,  bubble: 'mirv',        desc: 'Splits into 3 warheads at apex.' },
  { id: 'laser',       name: 'Orbital MASER',   price: 800,  level: 3, qty: 2, special: 'maser',
    dmg: 60,  radius: 26,  bubble: 'laser',       desc: 'Shell marks the target; a MASER strike fires from orbit.' },
  { id: 'homing',      name: 'Homing Missile',  price: 900,  level: 4, qty: 2, special: 'homing',
    dmg: 45,  radius: 30,  bubble: 'homing',      desc: 'Steers toward the nearest enemy mid-air.' },
  { id: 'railgun',     name: 'Railgun',         price: 1000, level: 4, qty: 2, special: 'railgun',
    dmg: 55,  radius: 24,  bubble: 'rail',        desc: 'Hypervelocity slug. Immune to wind.' },
  { id: 'kinetic',     name: 'Kinetic Rods',    price: 1500, level: 5, qty: 1, special: 'kinetic',
    dmg: 45,  radius: 30,  bubble: 'kinetic',     desc: 'Marks a target for rods dropped from orbit.' },
  { id: 'singularity', name: 'Singularity',     price: 1800, level: 5, qty: 1, special: 'singularity',
    dmg: 70,  radius: 60,  bubble: 'singularity', desc: 'Gravity vortex draws in everything, then detonates.' },
  { id: 'thermo',      name: 'Thermonuclear',   price: 2000, level: 5, qty: 1, nuclear: true,
    dmg: 120, radius: 115, shake: 30, flash: true, bubble: 'thermo', desc: 'Map-carving apocalypse.' },
  { id: 'neutron',     name: 'Neutron Bomb',    price: 3500, level: 5, qty: 1, nuclear: true,
    special: 'neutron', confirm: true,
    dmg: 130, radius: 100, radNear: 58, radFar: 24, shake: 44, flash: true, bubble: 'neutron',
    desc: 'THE GRANDDADDY. Shield-piercing radiation scours the ENTIRE battlefield.' },
];

const UTILITIES = [
  { id: 'parachute', name: 'Parachute',         price: 100, level: 1, qty: 2,
    desc: 'Auto-deploys on dangerous falls. Consumed on landing.' },
  { id: 'superfuel', name: 'Super Fuel Pack',   price: 100, level: 1, qty: 1,
    desc: '+100 fuel at the start of the next round.' },
  { id: 'shield',    name: 'Shield Generator',  price: 250, level: 1, qty: 1,
    desc: 'Energy dome absorbing 100 damage. Activate with [X].' },
  { id: 'predeploy', name: 'Pre-Deploy Shield', price: 300, level: 2, checkbox: true,
    desc: 'Spawn next round with a shield already active.' },
];

const UPGRADES = [
  { id: 'targetcomp', name: 'Target Computer',   price: 400,  level: 1,
    desc: 'Shows a basic trajectory line while aiming.' },
  { id: 'engine',     name: 'Engine Upgrade',    price: 600,  level: 2,
    desc: 'Halves fuel consumption when driving.' },
  { id: 'treads',     name: 'Tread Upgrade',     price: 700,  level: 3,
    desc: 'Doubles slope-climbing capacity.' },
  { id: 'reticle',    name: 'Advanced Reticle',  price: 900,  level: 3,
    desc: 'Marks the predicted ground impact point.' },
  { id: 'weather',    name: 'Weather Predictor', price: 1100, level: 4,
    desc: 'Trajectory preview factors in wind drift.' },
  { id: 'magshield',  name: 'Magnetic Shield',   price: 1200, level: 4,
    desc: 'Passively deflects incoming enemy shells. Yours fly free.' },
];

const SKINS = [
  { id: 'default', name: 'Military Drab', price: 0,    level: 1, desc: 'Factory paint. Smells of diesel.' },
  { id: 'chroma',  name: 'Chroma Steel',  price: 500,  level: 3, desc: 'Iridescent polished plating.' },
  { id: 'carbon',  name: 'Carbon Fiber',  price: 800,  level: 4, desc: 'Woven composite weave finish.' },
  { id: 'neon',    name: 'Neon Grid',     price: 1000, level: 5, desc: 'Wireframe glow straight from the grid.' },
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
