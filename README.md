# NodeNGW

A BeamNG-style soft-body driving sandbox that runs entirely in the browser (plain HTML + JavaScript + [Three.js](https://threejs.org) from a CDN). No build step, so it works as-is on GitHub Pages.

## How it works
The car is a lattice of 24 mass points ("nodes") joined by ~200 springs ("beams"), simulated at 600 Hz in `physics.js`.

- Beams squashed or stretched past their yield strain permanently change length, which gives dents.
- Beams stretched too far snap.
- Wheels are single nodes with a tyre friction model (rear-wheel drive, steering, handbrake).
- Hull edges and nodes collide with the terrain and static obstacles, so the underbody scrapes and the nose crumples.
- The red body is drawn from the live node positions, so what you see deforms with the physics.

## Controls
| Key | Action |
|---|---|
| W / S or Up / Down | Gas / brake / reverse |
| A / D or Left / Right | Steer |
| Space | Handbrake |
| R | Reset upright where you are |
| T | Back to start |
| C | Change camera (chase / bonnet / far) |
| B | Show the beam skeleton (blue = fine, red = stressed or dented) |
| V | Slow motion |

Touch controls appear on phones and tablets.

## The map
Small kicker ramp, big jump, speed bumps, a mound, slalom pillars, crates, and a crash wall past the big jump (z = 130). Hit it fast.

## Run on GitHub Pages
1. Push these files to the repo root.
2. Settings -> Pages -> Deploy from branch -> `main` / `(root)`.
3. Open `https://<your-username>.github.io/nodengw/`.

To run locally: `python3 -m http.server` and open http://localhost:8000 (ES modules don't work from `file://`).

## Files
- `index.html` - page, HUD, touch buttons
- `main.js` - Three.js scene, rendering, input, camera, sound
- `physics.js` - the soft-body physics (no dependencies)
