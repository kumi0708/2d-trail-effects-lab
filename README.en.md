# 2D Trail Effects Lab — snow, grass and water trails

[日本語](README.md) | **English**

▶ **Play in your browser: https://kumi0708.github.io/2d-trail-effects-lab/**

A single small "trail canvas" (an 8-bit grayscale render texture) drives three ground effects at once:

- ❄ **Snow**: footprints dent the snow pixel by pixel, with lit walls, shadows and a bright lip
- 🌾 **Grass**: trampled tufts flatten, lean away from the trail and spring back
- 💧 **Water**: ripples start only on the frame a boot lands, spread as anisotropic waves and die at the shore

This is a plain-JavaScript re-implementation (Canvas 2D plus a hand-written pixel buffer, no engine) of the technique in SpriteCook's article
[*2D trail render texture: snow, grass, water*](https://www.spritecook.ai/blog/2d-trail-render-texture-snow-grass-water).
All art (terrain, sky, character, trees, animals) is generated in code. There are no image assets.

| Snow | Grass | Water |
|---|---|---|
| ![snow](docs/snow.jpg) | ![grass](docs/grass.jpg) | ![water](docs/water.jpg) |

## Controls

| Input | Action |
|---|---|
| `←↑↓→` / `WASD` | Walk (turns autopilot off) |
| Click / drag | Poke the ground (stamps a dot there) |
| `P` | Autopilot on/off |
| `M` | Overlay the trail canvas on the ground in red |
| `F` | Snowfall on/off |
| `R` | Reset trails, waves and grass |
| `1` `2` `3` | Warp to snowfield / meadow / lake |
| Slider | Fade per frame (the article uses 3; this demo starts at 2) |

Below the game, the live trail canvas (384×104) and the water height field are shown.

## Running locally

There is no build step. Open `index.html` directly, or serve the folder with any static server:

```bash
python3 -m http.server 8000
```

---

## How it works

### Overview

```
 input / AI ──▶ list of gaussian dots ──▶ trail canvas (Uint8, 384×104, ping-pong)
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
          snow: thresholds +         grass: each tuft reads        water: "new paint" →
          neighbour checks           the canvas on the CPU          wave simulation
```

- The game renders at **320×180** into a `Uint32Array` pixel buffer, calls `putImageData`, and is scaled up by an integer factor with CSS `image-rendering: pixelated`.
- The simulation runs at a **fixed 30 fps** (`DT = 1/30`), because the article's numbers (fade per frame, lifetimes) are per 30 fps frame. Drawing uses `requestAnimationFrame`.
- All code is in one file, [`src/main.js`](src/main.js).

### 1. The trail canvas (shared data)

| Item | Detail |
|---|---|
| Format | `Uint8Array`, one canvas pixel per world pixel, values 0–255 |
| Size | 384×104 (320 view width + 32 px margin on each side, × 104 px of ground) |
| Double buffer | `trailA` / `trailB` ping-pong. This mirrors the GPU rule that a shader can't read the texture it writes to |
| Following | origin = `integer camera x − 32`. Each frame `scroll = origin − lastOrigin`, and the new canvas reads the old one at `x + scroll` (0 when out of range). Without this shift the footprints would slide along with the player |
| Fade | `v = max(v − FADE, 0)`, in whole 8-bit levels |
| Stamping | gaussian `min(1, peak · exp(−(dx/sx)² − (dy/sy)²))`, **max-combined** (the brighter value wins) |
| New paint | `newPaint = written − faded`: how much was painted *this frame*. Only water uses it |

Stamps:

| Stamp | When | Where | sx, sy | peak |
|---|---|---|---|---|
| Body dab | every frame | feet + (facing×1, 1) | 4.5, 4.2 | 0.30 (= level 76, below the 90 snow threshold) |
| Boot | only on the frame the walk cycle **enters** a contact frame | feet + (facing×3, 0); far boot (facing×3, −1) | 2.7, 1.8 | 1.3 (flat white centre) |
| Hare | on landing from a hop | two hind feet + one front | 1.6, 0.9 etc. | 1.0–1.15 |
| Duck | periodic paddle strokes, dives | tail / head | 1.6–2.0 | 0.42 / 0.95 |
| Fish | jump and splash-down | fish position | 2.0–2.3 | 0.9–1.0 |
| Mouse | while held | cursor | 3.0, 2.4 | 1.3 |

The body dab is tuned so that it never digs into snow (76 < 90) but still fully flattens grass (44 and up is fully flat).
The walk cycle has 8 frames at 12 fps, with contact frames 2 and 6.

### 2. Snow: depth from thresholds and neighbours alone

Each ground pixel is coloured from its own trail value plus the values of its **upper and left neighbours** (light comes from the top left):

| Condition | Colour |
|---|---|
| value ≥ 166 (deep dent) | DEEP `#92ace0` |
| 90 ≤ value < 166 (shallow dent) | INSIDE `#bad0f4` |
| dent, left neighbour isn't a dent | DEEP (left wall shade) |
| deep dent whose upper neighbour is a shallow but not deep dent | WALL `#647cba` |
| dent, upper neighbour isn't a dent | WALL (top wall, the darkest shadow) |
| not a dent, but the upper neighbour is | LIP `#fafdff` (bright rim pushed up below the dent) |
| otherwise | snow base `#dff1ff` (+ noise drifts and sparkles) |

As the canvas fades, pixels drop below the thresholds from the outside in, so **the dents shrink one pixel at a time and disappear** with no extra code.
Sand uses the same thresholds (with dry and wet print colours), and dirt shows faint prints.

**Snow on the boots**: stepping on snow sets a counter to 5. The next 5 steps on dirt or sand drop snow clumps of size 3, 3, 2, 2, 1, and each clump shrinks one size every `3.2 / (size+1)` seconds. These are timed decals, not canvas data, and none are dropped on grass.

### 3. Grass: each tuft reads the canvas on the CPU

Grass is not a shader. It is a set of Y-sorted tuft objects (about 2,000, plus reeds and dry stalks in the snow). Every frame, each tuft:

1. **Pressure**: takes the max value `v` over an **11 px wide × 8 row** box around its base (6 rows above to 1 below), then
   `press = smoothstep(clamp((v − 0.02) / 0.15))`. Level 44 or more is fully flat, and 5 or less stands upright.
2. **Lean**: compares the canvas, blurred over 3 rows × 7 columns, at ±2 px:
   `slope = (b(x+2) − b(x−2)) / 4`, `lean = −clamp(slope × 140, −7, 7)` px, so blades fall away from the centre of the trail.
3. **Recovery**: pressing down happens at once. When the trail is gone, the held value lets go over 0.08 s, and the tuft then returns through a **1.6 Hz spring with damping ratio 0.28**. It overshoots (floored at −0.18), so for a moment it stands taller than normal and seems to pop back up. Lean has its own spring.
4. **Drawing**: height × (1 − 0.45·press), so at most 55% of the height. Above press 0.5 the tuft is one shade darker, and the tips shift up to 5 px forward so it looks like it's lying down. Ambient wind sway is added on top.

Characters and tufts share one Y-sort, so grass in front hides the feet.

### 4. Water: a height-field simulation fed only by new paint

The water uses two `Float32Array`s (height `h` and velocity `v`) the same size as the trail canvas, scrolled the same way.

1. **Source**: only where `newPaint ≥ 64` (a boot landing and similar big writes this frame), `h −= newPaint/255`.
   If the fading trail value itself were the source, the lingering footprint would keep emitting and the rings would appear to shrink inward.
   The body dab adds only a little each frame even while moving, so it never becomes a source.
2. **Integration** (2 substeps per frame):
   ```
   v += 0.30 · lap_x(h) + 0.12 · lap_y(h)     // faster sideways (√(0.30/0.12) ≈ 1.6×)
   v *= 0.982 · soak
   h  = (h + 0.5 · v) · soak
   ```
   Then 5% of a 3×3 box blur is blended in to remove high-frequency noise. Waves travel faster sideways to match ground that is squashed in depth by the top-down view.
3. **Shore damping**: the distance to shore (computed with a BFS at world generation) makes `soak` 0.92 at the shore, rising to 1.0 four pixels inland.
4. **Drawing**: the height field itself is never painted. Pixels with `h > 0.035` that are a local max along x or y become a light 1 px **crest line**, and pixels with `h < −0.035` that are a local min become a one-shade-darker **trough line**.
   Connected pieces (8-neighbour) under 3 px are dropped, which keeps the rings crisp and pixel-art clean.
5. **Wading**: the character sinks up to 4 px depending on distance from shore. Submerged sprite pixels are replaced with the water below, one shade darker, and two foam pixels are drawn on each side at the waterline.

### 5. Art (all procedural)

- **Sky**: a 7-stop gradient quantized to 18 bands and blended with a 4×4 Bayer dither, plus a sunset glow, twinkling stars and noise clouds shaded in 3 tones by their top and bottom edges.
- **Background**: 4 parallax layers: far mountains and near mountains (ridge noise, lit from the top left, snow lines), a conifer forest and a hedge row. Treetops near the snowfield carry snow.
- **Ground**: fBm noise for snow drifts, dirt and pebbles, patchy meadow, and dry and wet sand. The lake has 4 depth shades by distance from shore, drifting glints, the sunset reflection and shore foam.
- **Sprites**: the player (8-frame walk, bob, fluttering scarf, blinking), hares, ducks, fish, snowy pines, rocks, bushes and signposts are drawn pixel by pixel in code and get an automatic outline.
- **Particles**: snow puffs, splashes, dust, leaves, 3-layer parallax snowfall and meadow fireflies.
- **Critter AI**: hares hop away from the player and leave Y-shaped tracks. Ducks paddle (each stroke makes a small ripple) and sometimes dive. Fish jump now and then, making two ripples.

### Differences from the article

- The article targets Godot 4.6 (GPU shaders + SubViewports). Here everything runs on the CPU in JavaScript. The canvas is small (about 40k pixels), so this is fast enough.
- The canvas follows the **camera** rather than the player and covers the whole view plus a margin. The article uses 120 px behind and 40 px ahead of the player.
- The default fade is 2 (the article uses 3). The slider can set it back to 3.
- Contact frames are 2 and 6 to match this demo's own walk cycle (2 and 5 in the article's sprite sheet).

## License

MIT
