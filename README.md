# NodeNGW

A BeamNG-style soft-body driving sandbox that runs entirely in the browser (plain HTML + JavaScript + [Three.js](https://threejs.org) from a CDN). No build step, so it works as-is on GitHub Pages.

## Features
- **BeamNG-style soft-body physics** (`physics.js`): every vehicle is 66 mass points (10 body cross-sections, engine, fuel tank, 4 hubs) joined by 416 springs, simulated at 1500 Hz. Beams yield plastically and harden as they crush, so the front and rear crumple (about 0.5 m at 60 km/h, ~1.8 m at 100 km/h) while the passenger cell holds. Stretched beams snap, suspension can tear off, and the bodywork darkens and the glass whitens where it is damaged.
- **3 vehicles**: Sedan (RWD), Pickup (AWD, heavy), Coupe (light and fast), plus 7 paint colours.
- **Automatic gearbox** with RPM, gear display, rev limiter, and engine / tyre-squeal / wind / crash sound.
- **World**: ramps, a big jump, a skyline plateau drop, speed bumps, a mound, slalom pillars, crates, a crash wall, trees, and pushable balls.
- **Effects**: dust, tyre smoke, sparks, engine smoke and fire, skid marks, camera shake, speed FOV, headlights and brake lights.
- **Day / sunset / night**.
- **HUD**: speedo + rpm gauge, gear, damage meter and repair cost, jump distance and air time (best saved in your browser), minimap.
- **Cameras**: mouse orbit camera on by default (drag to orbit, scroll to zoom, M or the button to toggle), plus chase, bonnet and far. No shake or zoom effects.
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
