# Scorched Reborn

A modern, polished 2D turn-based artillery battle game for the browser, inspired by
Scorched Earth and Worms. Pure HTML5 Canvas + CSS + vanilla JavaScript — no
dependencies, no build step, no external assets (all audio is synthesized live
via the Web Audio API).

## Play

Open `index.html` in any modern browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Controls

| Key | Action |
| --- | --- |
| ← / → | Aim turret (0°–180°) |
| ↑ / ↓ | Set fire power (1–100) |
| SPACE | Fire (hold to charge power, release to launch) |
| A / D | Drive left / right (costs fuel, limited by slope) |
| Q / E / Tab | Cycle weapons |
| X | Activate shield generator |
| ESC | Pause (controls reference, wrap/sound toggles, volume sliders, save & quit) |

## Features

- **Physics** — gravity + per-turn randomized wind, optional screen wrap-around,
  deformable heightmap terrain with smooth craters, dirt mounds that bury tanks,
  bedrock-deep fissures, and organic landslide slope relaxation. Fall damage with
  auto-deploying parachutes. A central flagpole wind vane flutters downwind and
  changes color with wind strength (green / yellow / red).
- **6 environment themes** cycling per round — Classic Hills, Alpine Peaks,
  Canyon Sandstone, Volcanic Wasteland (procedural branching lava veins),
  Cyberpunk Grid (scrolling binary rain, perspective grid), and Toxic Badlands —
  each with its own sky, celestial bodies, weather particles, soil fills and
  procedural textures.
- **17 weapons** — missiles, baby/tactical/thermonuclear nukes (full white-out
  flash + camera shake), MIRVs, orbital MASER strikes (marker shell + space
  beam), rolling napalm droplets
  that melt terrain, singularity vortices, kinetic rods from orbit, wind-immune
  railguns, dirt bombs, bouncers, rollers, homing missiles, leapfrogs, fissure
  charges — plus shields, parachutes, fuel packs, magnetic deflector shields,
  engine/tread upgrades, target computers and tank skins.
- **Progression** — persistent XP & levels (damage, direct hits, kills, survival)
  with level-gated shop items (Lv 1–5). Bots earn XP and respect the same gates.
  Full match state (scores, levels, inventories, terrain) is saved to
  localStorage for save / resume.
- **Speech bubbles** — context-appropriate launch quotes with a dramatic beat
  before firing, and programmer-themed last words on destruction.
- **Procedural audio** — synthesized explosions, launches, shield hums, purchase
  arpeggios, and a looping synthwave soundtrack (kick, snare, A-minor arpeggio
  bassline), all generated in real time with the Web Audio API.
- **4 AI difficulty profiles** — Novice (wild error, ignores wind), Amateur
  (wind-corrected power), Professional (fine-grained ballistic search, smart
  shopping), and John Wick (multi-stage perfect ballistic simulation, maxed
  upgrades, heavy ordnance).

## Architecture

```
index.html        shell + menu/shop/pause/game-over overlays
css/style.css     UI styling
js/
  utils.js        constants, math helpers, seeded RNG, level curve
  audio.js        Web Audio synthesis engine (SFX + music sequencer)
  sayings.js      speech-bubble quote banks
  items.js        armory catalog & level gates
  terrain.js      deformable heightmap (craters/mounds/fissures/landslides)
  themes.js       6 environment themes, sky & terrain texture rendering
  effects.js      particles, weather, camera shake, flash, speech bubbles
  tank.js         tank entity: physics, driving, shields, skins, rendering
  projectile.js   ballistic shells + special behaviors, hazards (napalm,
                  vortex, orbital MASER strike, rod strikes)
  ai.js           4 AI profiles, ballistic search, bot shopping
  persistence.js  localStorage match saves + XP profiles
  shop.js         intermission shop UI
  game.js         round/turn state machine, combat resolution, HUD, render
  main.js         bootstrap, input, menus, fixed-step game loop
tests/smoke.js    headless smoke test (node tests/smoke.js)
```

## Testing

```sh
node tests/smoke.js
```

Runs a full bot-vs-bot match (all four AI profiles), a save/restore round-trip,
and fires every weapon in the catalog through a stubbed canvas, asserting the
match reaches completion without runtime errors.
