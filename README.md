# Kick The Arham 🥊

A browser remake of *Kick the Buddy*, built with plain HTML5 canvas and JavaScript. No libraries and no build step.

## Play
Open **`KickTheArham.html`** in any modern browser. It's a single self-contained file, works offline,
and can be shared as-is (desktop mouse or mobile touch). The game starts with a password screen;
the password is the same as the developer vault password.

For development, edit `index.html`, `style.css` and `game.js`, then run `python3 build.py`
to regenerate `KickTheArham.html`.

## Features
- **Ragdoll physics** (Verlet). Arham stands, wobbles, gets knocked flat, and climbs back up.
- **Shop 🏪** run by Gus (restyle him via `SHOPKEEPER` in `game.js`), with 5 phases. Each pain-meter fill unlocks the next:
  1. **Starter Stuff**: Hand, Punch, Knife, Bowling ball, Pistol, Bomb, Flamethrower, Anvil, Zeus, Boodie
  2. **Inferno**: Molotov, Firework, Fireball, Lava Rain, Napalm strike
  3. **Warzone**: Grenade, Landmine, SMG, Rocket launcher, Airstrike, Tank
  4. **Cosmic**: Laser, Gravity Flip, Black Hole, Meteor, UFO abduction
  5. **Cartoon Chaos**: Rubber Chicken, Cream Pie, Bees, Piano, Nuke
  - **🚗 Vehicles** (always open): Dirt Bike, Car, Ice Cream Truck, Truck, Monster Truck, Steamroller, Rocket Car, Freight Train, Orbital Cannon
  - **🤪 Wacky** (always open): Giant Boot, Boxing Glove, Giant Fan, Tornado, Giant Magnet, Falling Whale
- **Original weapons**: Hand (grab and fling), Punch, Knife, Bowling ball, Pistol, Bomb, Flamethrower, Anvil, Zeus lightning
- **Boodie** ($1500): a blonde brawler who spawns in and beats up Arham with jabs, kicks, slaps, headbutts and stomps. Any harm to her KOs her instantly, and a KO'd Boodie fades away after a few seconds (🧹 also removes her); her icon stays red until she is KO'd, and spawning a new one replaces the old one.
- **Bucks 💰**: earn money by hurting the buddy and spend it in the shop
- **Combos**: chain hits for ranks (NICE → GREAT → BRUTAL → SAVAGE → INSANE → MASSACRE → GODLIKE → UNSTOPPABLE), a rising money multiplier and a cash-out bonus
- **Pain meter LIMIT BREAK**: each fill breaks the meter to the next multiplier (2X, 3X, 4X, 5X, 10X … 100X); it drains and drops a tier if you stop
- **Hit feel**: freeze frames, camera punch, critical hits, damage numbers, impact lines
- **Gore**: every body part takes damage separately, going from exposed muscle to exposed bone to a broken bone. Ribs and guts show through the torso and the skull cracks. Flesh chunks, organs, intestines and bone shards fly, and blood pools, drips and splatters.
- **Broken bones can be ripped out**: grab a broken limb with the Hand and yank hard. The bone drops as a prop you can throw, and the stump spurts blood.
- **Nurse station 🏥**: Nurse Nancy walks in to bandage him (stops the bleeding) or do full surgery (sets bones and reattaches limbs)
- Expressions, speech bubbles, bruises, cuts, bullet holes, scorch marks, screen shake
- Synthesized sound effects (Web Audio API)
- 📌 **Pin**: nail any body part in place; pin him mid-air and wail on him. Tap a pin again to release it
- 🔐 **Vault**: enter the developer password for infinite money (can be turned off again)
- ✏️ Rename the buddy, 📷 use any photo as his face
- Progress (bucks, unlocks, name, face) is saved in `localStorage`
