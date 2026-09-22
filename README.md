# Kick The Arham 🥊

A browser remake of *Kick the Buddy*, built with plain HTML5 canvas and JavaScript. No libraries and no build step.

## Play
Open `index.html` in any modern browser. It works on desktop (mouse) and mobile (touch).
To host it, push to GitHub Pages or any static host.

## Features
- **Ragdoll physics** (Verlet). Arham stands, wobbles, gets knocked flat, and climbs back up.
- **Weapons**: Hand (grab and fling), Punch, Knife, Bowling ball, Pistol, Bomb, Flamethrower, Anvil, Zeus lightning
- **Boodie** ($1500): a blonde brawler who spawns in and beats up Arham with jabs, kicks, slaps, headbutts and stomps. Any harm to her KOs her instantly; her icon stays red until she is KO'd, and spawning a new one replaces the old one.
- **Bucks 💰**: earn money (slowly!) by hurting the buddy and spend it to unlock weapons
- **Pain meter**: fills slowly as Arham takes damage; when full, bucks are doubled for 30 seconds while it drains
- Expressions, speech bubbles, bruises, cuts, bullet holes, scorch marks, screen shake
- Synthesized sound effects (Web Audio API)
- ✏️ Rename the buddy, 📷 use any photo as his face
- Progress (bucks, unlocks, name, face) is saved in `localStorage`
