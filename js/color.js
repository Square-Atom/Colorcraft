/* Color space conversions.
 *
 * Everything here works with sRGB components in 0..1 (not 0..255).
 * "linear" means linear-light sRGB, i.e. gamma decoded.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /* ---------------------------------------------------------------- Oklab
   * Björn Ottosson's Oklab. L is 0..1, a/b roughly -0.4..0.4.
   */
  function linearToOklab(r, g, b, out) {
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);

    out[0] = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    out[1] = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    out[2] = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    return out;
  }

  function oklabToLinear(L, a, b, out) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;

    out[0] = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return out;
  }

  /* --------------------------------------------------------------- CIELAB
   * sRGB primaries, D65 white point. L is 0..100.
   */
  var Xn = 0.9504559271, Yn = 1.0, Zn = 1.0890577508;
  var EPS = 216 / 24389, KAPPA = 24389 / 27;

  function labF(t) {
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }

  function labFInv(t) {
    var t3 = t * t * t;
    return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
  }

  /* XYZ is the hub: it is the only space every gamut can be compared in, so the
   * Lab and Oklab paths both route through it rather than straight to sRGB. */
  function linearToXyz(r, g, b, out) {
    out[0] = 0.4123907993 * r + 0.3575843394 * g + 0.1804807884 * b;
    out[1] = 0.2126390059 * r + 0.7151686788 * g + 0.0721923154 * b;
    out[2] = 0.0193308187 * r + 0.1191947798 * g + 0.9505321522 * b;
    return out;
  }

  function xyzToLinear(X, Y, Z, out) {
    out[0] = +3.2409699419 * X - 1.5373831776 * Y - 0.4986107603 * Z;
    out[1] = -0.9692436363 * X + 1.8759675015 * Y + 0.0415550574 * Z;
    out[2] = +0.0556300797 * X - 0.2039769589 * Y + 1.0569715142 * Z;
    return out;
  }

  function xyzToLab(X, Y, Z, out) {
    var fx = labF(X / Xn), fy = labF(Y / Yn), fz = labF(Z / Zn);
    out[0] = 116 * fy - 16;
    out[1] = 500 * (fx - fy);
    out[2] = 200 * (fy - fz);
    return out;
  }

  function labToXyz(L, a, b, out) {
    var fy = (L + 16) / 116;
    var fx = fy + a / 500;
    var fz = fy - b / 200;
    out[0] = Xn * labFInv(fx);
    out[1] = Yn * labFInv(fy);
    out[2] = Zn * labFInv(fz);
    return out;
  }

  var xyzScratch = [0, 0, 0];

  function linearToLab(r, g, b, out) {
    linearToXyz(r, g, b, xyzScratch);
    return xyzToLab(xyzScratch[0], xyzScratch[1], xyzScratch[2], out);
  }

  function labToLinear(L, a, b, out) {
    labToXyz(L, a, b, xyzScratch);
    return xyzToLinear(xyzScratch[0], xyzScratch[1], xyzScratch[2], out);
  }

  /* ------------------------------------------------------------- HSV / HSL
   * h in turns (0..1) for these two helpers, converted at the model layer.
   */
  function hsvToRgb(h, s, v, out) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: out[0] = v; out[1] = t; out[2] = p; break;
      case 1: out[0] = q; out[1] = v; out[2] = p; break;
      case 2: out[0] = p; out[1] = v; out[2] = t; break;
      case 3: out[0] = p; out[1] = q; out[2] = v; break;
      case 4: out[0] = t; out[1] = p; out[2] = v; break;
      default: out[0] = v; out[1] = p; out[2] = q; break;
    }
    return out;
  }

  function rgbToHsv(r, g, b, out) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d > 1e-12) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    out[0] = h;
    out[1] = max <= 1e-12 ? 0 : d / max;
    out[2] = max;
    return out;
  }

  function rgbToHsl(r, g, b, out) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var l = (max + min) / 2;
    var h = 0;
    if (d > 1e-12) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    out[0] = h;
    out[1] = d <= 1e-12 ? 0 : d / (1 - Math.abs(2 * l - 1));
    out[2] = l;
    return out;
  }

  function hslToRgb(h, s, l, out) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h * 6;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    out[0] = r + m; out[1] = g + m; out[2] = b + m;
    return out;
  }

  /* ------------------------------------------------------------- utilities */

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function inUnitRange(rgb, tol) {
    return rgb[0] >= -tol && rgb[0] <= 1 + tol &&
           rgb[1] >= -tol && rgb[1] <= 1 + tol &&
           rgb[2] >= -tol && rgb[2] <= 1 + tol;
  }

  function toHex(r, g, b) {
    var n = (Math.round(clamp01(r) * 255) << 16) |
            (Math.round(clamp01(g) * 255) << 8) |
            Math.round(clamp01(b) * 255);
    return '#' + ('000000' + n.toString(16)).slice(-6);
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* Relative luminance, used to pick readable overlay text on any background. */
  function luminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  CC.color = {
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    linearToOklab: linearToOklab,
    oklabToLinear: oklabToLinear,
    linearToLab: linearToLab,
    labToLinear: labToLinear,
    linearToXyz: linearToXyz,
    xyzToLinear: xyzToLinear,
    labToXyz: labToXyz,
    xyzToLab: xyzToLab,
    hsvToRgb: hsvToRgb,
    rgbToHsv: rgbToHsv,
    hslToRgb: hslToRgb,
    rgbToHsl: rgbToHsl,
    clamp01: clamp01,
    inUnitRange: inUnitRange,
    toHex: toHex,
    hexToRgb: hexToRgb,
    luminance: luminance
  };
})(this);
