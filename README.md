# Colorcraft

An interactive 3D view of color space. Hue runs around the circle, chroma runs
outward from a neutral core, and lightness runs bottom to top — black at the
floor, white at the ceiling.

The point of the thing is the shape. In a perceptual model, each hue reaches its
most saturated form at a *different* height: yellow peaks near the top, blue near
the bottom, red somewhere in between. So the solid is a lopsided blob rather than
a tidy cylinder — which is what real color actually looks like.

## Running it

Open `index.html`. That's it — no build step, no dependencies, no server. The
scripts are plain classic scripts specifically so `file://` works.

If you'd rather serve it:

```bash
python -m http.server 5580
```

## Models

| Model | Shape |
| --- | --- |
| **Oklch** (default) | Perceptually uniform, modern. Yellow high, blue low. |
| **CIE LCh** | The 1976 L\*a\*b\* equivalent. Same idea, older math. |
| **HSV** | A flat cylinder — every hue forced to the same level. |
| **HSL** | A bicone. Tapers correctly to black and white, still ignores real brightness. |

Switch between Oklch and HSV to see the difference the perceptual model makes:
HSV puts pure yellow and pure blue at exactly the same height, which is why it
looks so even and reads so poorly as a picture of brightness.

## Seeing inside a dense solid

The cloud gets thick fast, so several controls exist purely to open it up:

- **Outer shell only** — draw just the gamut boundary, leaving the interior hollow
- **Cutaway wedge / position** — slice a wedge out and look into the core
- **Lightness range**, **Chroma range** — clip to a horizontal slab or a ring
- **Opacity** — see through the outer layers
- **Depth fade** — fade distant points toward the background for depth
- **Radial spread**, **Vertical spread** — stretch the geometry so points separate

Density is controlled by **Hue steps**, **Lightness levels** and **Chroma rings**.

**Rings ride the gamut edge** decides how chroma is sampled. When on, the outer
ring always sits exactly on the most saturated color available at that lightness,
so the silhouette traces the true gamut. When off, rings are spaced at uniform
absolute chroma and simply stop where they run out of gamut — a ragged edge, but
an honest sense of how much chroma each hue really has.

## Sampling

Three ways to populate the same space.

**Hue / lightness lattice** walks the model's own coordinates and asks what color
sits at each position. Even rings and spokes; a diagram of the model.

**sRGB cube** walks the display's colors instead and asks where each one lands.
Every point is displayable by construction, and the clumping is real information —
it shows how unevenly RGB is spread through perceptual space.

**sRGB inside a wider gamut** draws sRGB in full color wrapped in a greyed shell
marking a larger space: Display P3, Adobe RGB (1998), Rec. 2020, or the raw LCh
coordinate cylinder. Turn on *Outer shell only* and add a cutaway wedge to see
how much room is left between them.

The envelope is deliberately neutral rather than colored. Those are by definition
colors sRGB cannot show, so painting them in sRGB would be a lie; grey says "there
is color out here your screen cannot reach", which is the honest claim.

This mode needs a perceptual model — HSV and HSL have no fixed position in CIE
space, so there is nothing to nest them inside.

## Palette tab

The panel has two tabs. **Display** holds everything about how the solid is
drawn; **Palette** is where you add colors and build things from them.

### Adding colors

Dial one in with the picker — a live preview, an HSV/RGB toggle, and three
sliders whose tracks show what moving that one slider would do. Or type it:

```
#ff8800   f80   255 136 0   rgb(255,136,0)   hsv 30 100 100   hsl(30,100,50)
```

Bare triples are read as 0–255 unless they look normalised (`0.5 0.2 0.9`).
Enter adds immediately; the button adds whatever the sliders hold.

Each color becomes a ringed marker in the solid, and the points are numbered so
the plane list can refer to them.

### Plane slices

Three points define a plane, and that plane cuts the solid open. The **cut face**
panel shows what the cut exposes — *every* color the plane passes through, not
just a blend of the three you picked. Those three only choose the angle.

The face is drawn flat beside the 3D view, transparent wherever the plane has
passed outside the gamut, which is what gives each cut its silhouette. The three
colors are ringed on it and the triangle they bound is outlined. Turn on **Show
the cut in 3D** to see the same face embedded in the solid it came from.

**Hide color outside the border** clips the face to that triangle, so the three
points bound the slice as well as orienting it. The border is drawn either way,
so you can see what turning it on would cut away before you do. Clipping applies
to the thumbnails and the 3D cut too, not just the flat view.

With four or more points, every combination of three becomes its own plane. Five
points give ten cuts, and the thumbnail grid lets you flip between them — each is
a genuinely different cross-section. Combinations are capped at 40 so a long
point list cannot detonate into hundreds of rasters. Three collinear points
define no plane; that combination is marked rather than silently skipped.

### Ramps between points

**Line** joins the points with a gradient. **Blend fill** takes the older
approach for three or more: fan the polygon into triangles from its centroid and
fill each barycentrically, so every corner keeps exactly the color you typed.
Unlike a plane slice, a blend fill contains only colors mixed from your points.

### Blend in

This is the control worth playing with. A gradient has no single correct path —
it depends entirely on which space you average in, and the difference is large.
Blue `#0033ff` to yellow `#ffdd00`, same endpoints every time:

| Blend space | Midpoint | |
| --- | --- | --- |
| Oklab — straight line | `#7ca1be` | a chord straight through the solid |
| Oklch — polar arc | `#00c6a4` | bows outward through teal, keeping chroma up |
| CIELAB — straight line | `#c684a3` | |
| CIE LCh — polar arc | `#ff0066` | arcs the *other* way, through magenta |
| Linear RGB | `#bca5bc` | physically correct light mixing |
| sRGB — naive | `#808880` | the muddy grey midpoint everyone complains about |

Watching those six paths take visibly different routes between the same two
points is the clearest explanation of why gradient code cares about color space.

Polar arcs keep chroma high through the middle, which is usually what you want
from a ramp — but it also pushes the path outside sRGB. Those colors are clamped
back in and marked with a dashed ring in the view and a dashed cap in the swatch
strip, so you can see exactly where the ramp left the gamut.

Generated ramps appear as a swatch strip along the bottom. Click any swatch to
copy its hex, or **Copy all** for the whole list. Long fills are subsampled for
display; copy still gives you everything.

User points and their ramps ignore the slice and filter sliders — a color you
typed should never quietly vanish behind a slider.

## Controls

| Input | Action |
| --- | --- |
| Drag | Rotate |
| Shift-drag / right-drag | Pan |
| Wheel | Zoom |
| Hover | Read off hex and coordinates |
| Click | Copy hex |
| `R` / double-click | Reset view |
| `Space` | Auto-rotate |
| `H` | Hide the panel |

## Layout

```
index.html
css/style.css
js/color.js       sRGB, Oklab, CIELAB, XYZ, HSV, HSL conversions
js/gamuts.js      RGB working spaces, matrices derived from chromaticities
js/models.js      the four solids behind one generic interface
js/cloud.js       point cloud construction
js/ramp.js        color parsing, blend spaces, gradients and blend fills
js/slice.js       plane geometry and cross-section rasters
js/renderer.js    orbit camera, painter's algorithm, picking
js/app.js         controls, input, frame loop
serve.py          optional no-cache dev server
```

`js/color.js` is deliberately written as pure, allocation-free functions with no
dependencies, so it ports to C, GLSL, or anything else more or less mechanically.

`js/models.js` is where the geometry lives. Every model exposes the same three
operations — `toRGB`, `fromRGB`, `maxC` — so the cloud builder and renderer never
branch on which model is active. Adding a fifth model means adding one object.

## Notes

Rendering is Canvas 2D rather than WebGL. Back-to-front alpha blending is what
makes the interior readable, and that needs a depth sort either way; the sort is
a counting sort into depth buckets, so it stays linear as density climbs. Points
carry prebuilt color strings so the common full-opacity path does no per-frame
string formatting.

The gamut boundary is found by bisection on chroma. Any RGB gamut is star-shaped
about the neutral axis in both Oklab and CIELAB, so in-gamut is a single
contiguous interval and a plain binary search is safe.

Gamuts are defined by their published CIE xy chromaticities, and the XYZ matrices
are derived from those at load time rather than transcribed. Deriving beats
copying: the matrices are long strings of digits that are easy to get subtly
wrong, and adding a gamut becomes eight numbers you can check against a spec. The
derived sRGB matrix agrees with the published one to six decimal places.

Only primaries matter for this, incidentally — a gamut's volume is fixed by its
primaries and white point, and the transfer curve only affects encoding within it.
Every gamut test happens in linear light, so no transfer function is involved.
