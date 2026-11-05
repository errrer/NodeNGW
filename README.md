# NodeNGW

A BeamNG-style soft-body driving sandbox that runs entirely in the browser (plain HTML + JavaScript + [Three.js](https://threejs.org) from a CDN). No build step, so it works as-is on GitHub Pages.

## Features
- **BeamNG-style soft-body physics** (`physics.js`): every vehicle is ~265 mass points joined by ~1,400 springs, simulated at 1500 Hz.
  - A stiff passenger cell with crumple zones front and rear. Beams yield plastically and harden as they crush (about 0.7 m of nose crush at 60 km/h, 1.5 m at 100 km/h), and snap when over-stretched.
  - **Real suspension**: wishbone arms plus a spring/damper strut per wheel with bump stops, droop limits, and different damping in compression and rebound. Ride height self-calibrates at start-up.
  - **Independent body parts**: bumpers, hood, trunk, roof, doors, fenders, quarter panels, skirts and glass are each their own node grid held on by breakable hinges and clips. When the mounts fail the part comes off as rigid tumbling debris and exposes the steel frame, engine, radiator, fuel tank and seats underneath. Wheels can be torn off too. Grille, tail panel and underbody panels cover the rest of the car. The engine is a 16-node deformable block that dents when the frame is driven into it. Parts only collide with the world, never with each other.
  - **Wheels fall off** when their suspension arms are torn out or crushed, then roll away on their own.
  - **Slicing**: thin poles and the steel blades on the map cut straight through beams that cross them. Panels are cut at low speed, the frame and suspension at high speed (a 120 km/h blade hit can take both front wheels off). Cut sheet metal tears open instead of stretching.
  - **Breakable glass**: panes crack as the frame flexes, then shatter into flying shards.
  - Panels are heavily damped so they stay stiff instead of wobbling, and dent permanently where hit.
- **8 vehicles**: Sedan (RWD), Pickup (AWD, heavy), Coupe (light and fast), Hatchback (FWD), SUV (AWD, tall), Muscle (huge torque), Van (big box), Mini (tiny and fragile), plus 7 paint colours.
- **Automatic gearbox** with RPM, gear display, rev limiter, and engine / tyre-squeal / wind / crash sound.
- **World**: ramps, a big jump, a skyline plateau drop, speed bumps, a mound, slalom pillars, crates, a crash wall, trees, and pushable balls.
- **Effects**: dust, tyre smoke, sparks, glass shards, crash dust and flying chunks, coolant steam, oil drips, engine smoke and fire, skid marks, headlights and brake lights.
- **Day / sunset / night**, graphics quality (low / med / high, auto-lowered if the frame rate drops) and km/h or mph.
- **Damage readout** listing lost, cracked and dented parts, flip-upright without repairing, horn, headlight toggle and screenshots.
- **HUD**: speedo + rpm gauge, gear, damage meter and repair cost, jump distance and air time (best saved in your browser), minimap.
- **Cameras**: mouse orbit camera on by default (drag to orbit, scroll to zoom, M or the button to toggle), plus chase, bonnet and far. No shake or zoom effects.
- Keyboard, touch buttons and gamepad.

## More to crash into
A pole field (east), lone poles, a crate pyramid, brick wall, jersey-barrier chicane, an arch (west), heavy blocks, four sharp steel blades, and a second kicker ramp. Poles are wrapped around by the nose instead of pushing through.

## Controls
| Key | Action |
|---|---|
| W / S or Up / Down | Gas / brake / reverse |
| A / D or Left / Right | Steer |
| Space | Handbrake |
| M (or the **Mouse cam** button) | Toggle mouse camera: drag to look around, scroll to zoom |
| C | Cycle chase / bonnet / far camera |
| R | Repair and reset where you are |
| U | Flip upright, keeping the damage |
| H | Horn |
| L | Headlights on / auto |
| K | Save a screenshot |
| T | Back to start (also resets the balls) |
| B | Beam skeleton view (blue = fine, red = stressed or dented) |
| N | Cycle day / sunset / night |
| V | Slow motion |
| Esc or P | Menu (vehicle, paint, time of day) |

Gamepad: left stick steer, RT gas, LT brake/reverse, B handbrake, Y reset, X camera, Start menu.

## Run on GitHub Pages
1. Push these files to the repo root.
2. Settings -> Pages -> Deploy from branch -> `main` / `(root)`.
3. Open `https://<your-username>.github.io/<repo-name>/`.

To run locally: `python3 -m http.server` and open http://localhost:8000 (ES modules don't work from `file://`).

## Files
- `index.html` - page, HUD, menu
- `main.js` - Three.js scene, rendering, input, camera, sound, UI
- `fx.js` - particles and skid marks
- `physics.js` - the soft-body physics (no dependencies, runs in Node too; headless tests are easy to write against it)

## More physics
- **Lake** (east of the big jump): buoyancy, water drag, splashes. Water floods the engine and kills power.
- **Wrecking ball** on a gantry swings across the road on a rope.
- **Fuel leaks, fire and explosions** after heavy tank/engine damage; sparks ignite leaks.
- **Engine damage** reduces power; **flat tyres** from blades/poles or hard rim strikes (squashed wheel, rim sparks, less grip).
- **Hinged hood/doors** buckle and pop upward; panels keep a stand-off so they never sink into each other (but don't collide).
- Real-car proportions and detail meshes (bumpers, lamps, plates, mirrors, handles).

## Multiplayer
Open the menu, press **Host room** and send the 4-letter code to friends (or send `?room=CODE` on the page link); they type it under **Join**. Up to 6 players, peer-to-peer over WebRTC (PeerJS public signalling, no server of your own). Everyone simulates their own car and sees the others with live dents, torn panels, cracked glass and name tags; cars collide with each other. Rolling balls and the swinging ball are not shared between players.
