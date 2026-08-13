/* Color solid models.
 *
 * Every model exposes the same generic interface so the point-cloud builder and
 * the renderer never need to know which one is active:
 *
 *   toRGB(L, C, h, out)   L in 0..1, C normalised to 0..1, h in radians.
 *                         May return out-of-gamut components; callers decide.
 *   fromRGB(r, g, b, out) -> [L, C, h]
 *   maxC(L, h)            gamut boundary: the largest in-gamut C at this L and h.
 *
 * Geometry then follows directly: radius = C, height = L - 0.5, angle = h.
 *
 * The perceptual models (Oklch, CIE LCh) are the interesting ones. Because they
 * describe how bright a hue actually looks, their gamut boundary sits at a
 * different height for every hue -- yellow reaches its most saturated form near
 * the top of the solid, blue near the bottom. HSV and HSL are included for
 * contrast: they force every hue onto the same level, which is exactly the
 * flattening this app is meant to show.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});
  var color = CC.color;

  var TAU = Math.PI * 2;
  var scratch = [0, 0, 0];

  /* Largest chroma any sRGB color reaches in each space, used to normalise the
   * radius to 0..1 so all models share one set of geometry sliders. */
  var OKLAB_CMAX = 0.3225;   /* sRGB magenta */
  var LAB_CMAX = 134.0;      /* sRGB blue */

  var GAMUT_TOL = 1e-4;

  /* Bisection against a gamut boundary. Any RGB gamut is star-shaped about the
   * neutral axis in both Oklab and CIELAB, so a plain binary search on C is
   * safe: in-gamut is a single contiguous interval [0, maxC].
   *
   * `hi` is the search ceiling in normalised chroma. It is 1 for sRGB by
   * construction, but wider gamuts reach past that -- Rec. 2020 green sits well
   * outside sRGB's most saturated color -- so callers can raise it. */
  function bisect(inside, hi) {
    if (inside(hi)) return hi;

    var lo = 0, mid;
    for (var i = 0; i < 22; i++) {
      mid = (lo + hi) * 0.5;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function bisectMaxC(model, L, h) {
    return bisect(function (C) {
      return color.inUnitRange(model.toRGB(L, C, h, scratch), GAMUT_TOL);
    }, 1);
  }

  /* ---------------------------------------------------------------- Oklch */

  var oklch = {
    id: 'oklch',
    name: 'Oklch  (Oklab)',
    blurb: 'Perceptually uniform. Yellow peaks near the top, blue near the bottom.',
    lLabel: 'L',
    cLabel: 'C',
    chromaMax: OKLAB_CMAX,
    perceptual: true,

    /* Routed through linear sRGB, which is just a coordinate system here -- the
     * values are free to fall outside 0..1 on the way to XYZ. */
    toXYZ: function (L, C, h, out) {
      var c = C * OKLAB_CMAX;
      color.oklabToLinear(L, c * Math.cos(h), c * Math.sin(h), out);
      return color.linearToXyz(out[0], out[1], out[2], out);
    },

    toRGB: function (L, C, h, out) {
      var c = C * OKLAB_CMAX;
      color.oklabToLinear(L, c * Math.cos(h), c * Math.sin(h), out);
      out[0] = color.linearToSrgb(out[0]);
      out[1] = color.linearToSrgb(out[1]);
      out[2] = color.linearToSrgb(out[2]);
      return out;
    },

    fromRGB: function (r, g, b, out) {
      color.linearToOklab(
        color.srgbToLinear(r), color.srgbToLinear(g), color.srgbToLinear(b), out);
      var a = out[1], bb = out[2];
      var h = Math.atan2(bb, a);
      out[1] = Math.sqrt(a * a + bb * bb) / OKLAB_CMAX;
      out[2] = h < 0 ? h + TAU : h;
      return out;
    },

    maxC: function (L, h) { return bisectMaxC(oklch, L, h); }
  };

  /* --------------------------------------------------------------- CIE LCh */

  var cielch = {
    id: 'cielch',
    name: 'CIE LCh  (L*a*b*)',
    blurb: 'The classic 1976 chroma model. Same idea as Oklch, older math.',
    lLabel: 'L*',
    cLabel: 'C*',
    chromaMax: LAB_CMAX,
    perceptual: true,

    toXYZ: function (L, C, h, out) {
      var c = C * LAB_CMAX;
      return color.labToXyz(L * 100, c * Math.cos(h), c * Math.sin(h), out);
    },

    toRGB: function (L, C, h, out) {
      var c = C * LAB_CMAX;
      color.labToLinear(L * 100, c * Math.cos(h), c * Math.sin(h), out);
      out[0] = color.linearToSrgb(out[0]);
      out[1] = color.linearToSrgb(out[1]);
      out[2] = color.linearToSrgb(out[2]);
      return out;
    },

    fromRGB: function (r, g, b, out) {
      color.linearToLab(
        color.srgbToLinear(r), color.srgbToLinear(g), color.srgbToLinear(b), out);
      var a = out[1], bb = out[2];
      var h = Math.atan2(bb, a);
      out[0] = out[0] / 100;
      out[1] = Math.sqrt(a * a + bb * bb) / LAB_CMAX;
      out[2] = h < 0 ? h + TAU : h;
      return out;
    },

    maxC: function (L, h) { return bisectMaxC(cielch, L, h); }
  };

  /* ------------------------------------------------------------------ HSV */

  var hsv = {
    id: 'hsv',
    name: 'HSV  (cylinder)',
    blurb: 'Every hue forced to the same height. Note how flat and even it looks.',
    lLabel: 'V',
    cLabel: 'S',
    chromaMax: 1,

    toRGB: function (L, C, h, out) {
      return color.hsvToRgb(h / TAU, C, L, out);
    },

    fromRGB: function (r, g, b, out) {
      color.rgbToHsv(r, g, b, out);
      var hh = out[0];
      out[0] = out[2];        /* V -> height */
      out[2] = hh * TAU;      /* hue -> radians */
      return out;
    },

    maxC: function () { return 1; }
  };

  /* ------------------------------------------------------------------ HSL */

  var hsl = {
    id: 'hsl',
    name: 'HSL  (bicone)',
    blurb: 'Correctly tapers to black and white, but still ignores real brightness.',
    lLabel: 'L',
    cLabel: 'S',
    chromaMax: 1,

    /* Radius carries HSL chroma, s * (1 - |2L-1|), which is what produces the
     * bicone rather than a cylinder. */
    toRGB: function (L, C, h, out) {
      var span = 1 - Math.abs(2 * L - 1);
      var s = span < 1e-9 ? 0 : C / span;
      return color.hslToRgb(h / TAU, s > 1 ? 1 : s, L, out);
    },

    fromRGB: function (r, g, b, out) {
      color.rgbToHsl(r, g, b, out);
      var hh = out[0], s = out[1], l = out[2];
      out[0] = l;
      out[1] = s * (1 - Math.abs(2 * l - 1));
      out[2] = hh * TAU;
      return out;
    },

    maxC: function (L) { return 1 - Math.abs(2 * L - 1); }
  };

  var list = [oklch, cielch, hsv, hsl];
  var byId = {};
  for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];

  CC.models = {
    list: list,
    get: function (id) { return byId[id] || oklch; },
    bisect: bisect
  };
})(this);
