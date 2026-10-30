# NodeNGW

A BeamNG-style soft-body driving sandbox that runs entirely in the browser (plain HTML + JavaScript + [Three.js](https://threejs.org) from a CDN). No build step, so it works as-is on GitHub Pages.

## Features
- **Soft-body physics** (`physics.js`): every vehicle is ~24 mass points joined by ~200 springs, simulated at 600 Hz. Squashed beams stay dented, stretched beams snap, suspension can be torn off, and the bodywork darkens and the glass cracks where it is damaged.
- **3 vehicles**: Sedan (RWD), Pickup (AWD, heavy), Coupe (light and fast), plus 7 paint colours.
- **Automatic gearbox** with RPM, gear display, rev limiter, and engine / tyre-squeal / wind / crash sound.
- **World**: ramps, a big jump, a skyline plateau drop, speed bumps, a mound, slalom pillars, crates, a crash wall, trees, and pushable balls.
- **Effects**: dust, tyre smoke, sparks, engine smoke and fire, skid marks, camera shake, speed FOV, headlights and brake lights.
- **Day / sunset / night**.
- **HUD**: speedo + rpm gauge, gear, damage meter and repair cost, jump distance and air time (best saved in your browser), minimap.
- **Cameras**: chase, bonnet, far, and a **mouse camera** (drag to orbit, scroll to zoom).
- Keyboard, touch buttons and gamepad.

## Controls
| Key | Action |
|---|---|
| W / S or Up / Down | Gas / brake / reverse |
| A / D or Left / Right | Steer |
| Space | Handbrake |
| M (or the **Mouse cam** button) | Toggle mouse camera: drag to look around, scroll to zoom |
| C | Cycle chase / bonnet / far camera |
| R | Reset upright where you are |
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
- `physics.js` - the soft-body physics (no dependencies, runs in Node too)
