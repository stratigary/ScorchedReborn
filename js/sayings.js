'use strict';
/* ===== Speech bubble quote banks ===== */

const SAYINGS = {
  fire: {
    default: [
      "Incoming! Probably.",
      "Catch!",
      "This one's got your name on it!",
      "Off you go, little buddy!",
      "Standard issue pain, delivered!",
      "Heads up! No, really. Up.",
    ],
    nuke: [
      "Mushroom season!",
      "Duck and cover, darling!",
      "Tactical solutions for tactical problems.",
      "Approved by zero safety boards!",
      "It's getting warm in here...",
    ],
    thermo: [
      "I am become death, destroyer of terrain.",
      "Goodbye, geography.",
      "LET THERE BE LIGHT.",
      "The sun called. It's jealous.",
      "This seemed proportionate.",
    ],
    laser: [
      "Pew pew, but professional.",
      "Coherent light, incoherent screaming.",
      "Frickin' laser beams!",
      "Photons, assemble!",
    ],
    dirt: [
      "Special delivery: one landscape!",
      "Have some free real estate!",
      "Gardening time!",
      "Dirt nap, anyone?",
    ],
    napalm: [
      "It's grilling season!",
      "Extra crispy, coming right up.",
      "I love the smell of napalm on turn six.",
      "Who ordered the flambé?",
    ],
    singularity: [
      "Hope you packed an event horizon.",
      "Gravity always wins.",
      "Spaghettification time!",
      "Enjoy the attraction!",
    ],
    homing: [
      "It's not stalking, it's guidance.",
      "Running only adds drama.",
      "This one does the aiming for me.",
    ],
    rail: [
      "Wind? Never heard of her.",
      "F = ma, and a is ENORMOUS.",
      "Delivered at unreasonable velocity.",
    ],
    roller: [
      "It rolls downhill. So does pain.",
      "Bowling for tanks!",
      "Gravity-assisted customer service.",
    ],
    bouncer: [
      "Bank shot!",
      "Geometry is my co-pilot.",
      "Angle of incidence, meet angle of OW.",
    ],
    mirv: [
      "Five for the price of one!",
      "Sharing is caring.",
      "It's raining warheads, hallelujah!",
    ],
    kinetic: [
      "Rods from the gods!",
      "Orbit says hi.",
      "No explosives. Just physics.",
    ],
    fissure: [
      "Mind the gap!",
      "Let's split.",
      "Geology, but faster.",
    ],
    leapfrog: [
      "Hop. Hop. BOOM.",
      "Three for flinching!",
      "It skips. You won't.",
    ],
  },

  death: [
    "Delete my browser history!",
    "Segfault... in my soul...",
    "I should've written tests...",
    "404: tank not found.",
    "Tell my GPU... I loved her...",
    "KERNEL PANIC!!",
    "sudo rm -rf me",
    "Blue screen of de—",
    "Out of memory... of you all.",
    "Stack overflow'd and out.",
    "My warranty JUST expired.",
    "Garbage collected...",
    "Connection reset by shell.",
    "Going off the grid... permanently.",
    "Worked on my machine...",
    "Ctrl+Z! CTRL+Z!!",
  ],
};

function pickFireSaying(category) {
  const bank = SAYINGS.fire[category] || SAYINGS.fire.default;
  return Utils.choice(bank);
}

function pickDeathSaying() {
  return Utils.choice(SAYINGS.death);
}
