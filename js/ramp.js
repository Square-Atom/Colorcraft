/* User-entered colors, and the ramps built between them.
 *
 * The interesting part is that a gradient has no single correct path. Two colors
 * joined by an even blend trace a completely different route through the solid
 * depending on which space you average in: a straight chord in Oklab, an arc that
 * bows outward in Oklch, a bright bulge in linear light, a muddy sag in plain
 * sRGB. All of them are offered, because seeing those paths side by side is the
 * clearest way to understand why gradient code picks a space.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});
  var color = CC.color;
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------- parsing */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Accepts #a1b2c3, #abc, "255 136 0", "rgb(255,136,0)", "hsv 30 100 100",
   * "hsl(30,100,50)". Bare triples are 0..255 unless they look normalised. */
  function parseColor(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase();
    if (!s) return null;

    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (m) {
      var hx = m[1];
      if (hx.length === 3) hx = hx[0] + hx[0] + hx[1] + hx[1] + hx[2] + hx[2];
      return color.hexToRgb('#' + hx);
    }

    var out = [0, 0, 0];
    var tri = '\\s*\\(?\\s*(-?[\\d.]+)\\s*[,\\s]\\s*(-?[\\d.]+)%?\\s*[,\\s]\\s*(-?[\\d.]+)%?\\s*\\)?$';

    m = new RegExp('^(?:hsv|hsb)' + tri).exec(s);
    if (m) {
      var hv = parseFloat(m[1]) / 360;
      color.hsvToRgb(hv - Math.floor(hv), clamp01(parseFloat(m[2]) / 100),
        clamp01(parseFloat(m[3]) / 100), out);
      return out;
    }

    m = new RegExp('^hsl' + tri).exec(s);
    if (m) {
      var hl = parseFloat(m[1]) / 360;
      color.hslToRgb(hl - Math.floor(hl), clamp01(parseFloat(m[2]) / 100),
        clamp01(parseFloat(m[3]) / 100), out);
      return out;
    }

    m = new RegExp('^(?:rgb)?' + tri).exec(s);
    if (m) {
      var v = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      /* "0.5 0.2 0.9" is clearly normalised; "1 1 1" is ambiguous, so treat
       * whole numbers as 0..255 -- the far more common way to type a color. */
      var normalised = v.every(function (x) { return x >= 0 && x <= 1; }) &&
                       v.some(function (x) { return x % 1 !== 0; });
      var k = normalised ? 1 : 255;
      return [clamp01(v[0] / k), clamp01(v[1] / k), clamp01(v[2] / k)];
    }

    return null;
  }

  /* -------------------------------------------------------------- spaces */

  function rgbToLinear3(rgb, out) {
    out[0] = color.srgbToLinear(rgb[0]);
    out[1] = color.srgbToLinear(rgb[1]);
    out[2] = color.srgbToLinear(rgb[2]);
    return out;
  }

  function linear3ToRgb(c, out) {
    out[0] = color.linearToSrgb(c[0]);
    out[1] = color.linearToSrgb(c[1]);
    out[2] = color.linearToSrgb(c[2]);
    return out;
  }

  var tmp = [0, 0, 0];

  function toPolar(c, out) {
    var a = c[1], b = c[2];
    out[0] = c[0];
    out[1] = Math.sqrt(a * a + b * b);
    out[2] = Math.atan2(b, a);
    return out;
  }

  function fromPolar(c, out) {
    out[0] = c[0];
    out[1] = c[1] * Math.cos(c[2]);
    out[2] = c[1] * Math.sin(c[2]);
    return out;
  }

  function cartesian(id, name, from, to) {
    return { id: id, name: name, polar: false, from: from, to: to };
  }

  function polar(id, name, from, to) {
    return {
      id: id, name: name, polar: true,
      from: function (rgb, out) { from(rgb, out); return toPolar(out, out); },
      to: function (c, out) { fromPolar(c, tmp); return to(tmp, out); }
    };
  }

  function rgbToOklab(rgb, out) {
    return color.linearToOklab(color.srgbToLinear(rgb[0]), color.srgbToLinear(rgb[1]),
      color.srgbToLinear(rgb[2]), out);
  }

  function oklabToRgb(c, out) {
    color.oklabToLinear(c[0], c[1], c[2], out);
    return linear3ToRgb(out, out);
  }

  function rgbToLab(rgb, out) {
    return color.linearToLab(color.srgbToLinear(rgb[0]), color.srgbToLinear(rgb[1]),
      color.srgbToLinear(rgb[2]), out);
  }

  function labToRgb(c, out) {
    color.labToLinear(c[0], c[1], c[2], out);
    return linear3ToRgb(out, out);
  }

  var SPACES = [
    cartesian('oklab', 'Oklab — straight line', rgbToOklab, oklabToRgb),
    polar('oklch', 'Oklch — polar arc', rgbToOklab, oklabToRgb),
    cartesian('lab', 'CIELAB — straight line', rgbToLab, labToRgb),
    polar('lch', 'CIE LCh — polar arc', rgbToLab, labToRgb),
    cartesian('linear', 'Linear RGB — light mixing', rgbToLinear3, linear3ToRgb),
    cartesian('srgb', 'sRGB — naive', function (rgb, out) {
      out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; return out;
    }, function (c, out) {
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out;
    })
  ];

  var spaceById = {};
  for (var i = 0; i < SPACES.length; i++) spaceById[SPACES[i].id] = SPACES[i];

  /* ------------------------------------------------------------ blending */

  function shortestArc(from, to) {
    var d = to - from;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  /* Two-colour blend. Polar spaces take the shortest way round the hue circle,
   * and a neutral endpoint borrows the other's hue -- otherwise a ramp into grey
   * would sweep through arbitrary hues on the way. */
  function mix2(space, ca, cb, t, out) {
    if (!space.polar) {
      out[0] = ca[0] + (cb[0] - ca[0]) * t;
      out[1] = ca[1] + (cb[1] - ca[1]) * t;
      out[2] = ca[2] + (cb[2] - ca[2]) * t;
      return out;
    }

    var ha = ca[2], hb = cb[2];
    if (ca[1] < 1e-6) ha = hb;
    if (cb[1] < 1e-6) hb = ha;

    out[0] = ca[0] + (cb[0] - ca[0]) * t;
    out[1] = ca[1] + (cb[1] - ca[1]) * t;
    out[2] = ha + shortestArc(ha, hb) * t;
    return out;
  }

  /* Weighted blend of any number of colours, for filling a triangle. Polar hue
   * is averaged as a vector weighted by chroma, so near-neutral corners do not
   * drag the hue of the patch around. */
  function mixN(space, cols, w, out) {
    var n = cols.length, k;

    if (!space.polar) {
      out[0] = out[1] = out[2] = 0;
      for (k = 0; k < n; k++) {
        out[0] += w[k] * cols[k][0];
        out[1] += w[k] * cols[k][1];
        out[2] += w[k] * cols[k][2];
      }
      return out;
    }

    var L = 0, C = 0, x = 0, y = 0;
    for (k = 0; k < n; k++) {
      L += w[k] * cols[k][0];
      C += w[k] * cols[k][1];
      var wc = w[k] * cols[k][1];
      x += wc * Math.cos(cols[k][2]);
      y += wc * Math.sin(cols[k][2]);
    }
    out[0] = L;
    out[1] = C;
    out[2] = (x === 0 && y === 0) ? 0 : Math.atan2(y, x);
    return out;
  }

  var GAMUT_TOL = 0.0015;

  function emit(space, coords, list) {
    var rgb = [0, 0, 0];
    space.to(coords, rgb);
    var clipped = !color.inUnitRange(rgb, GAMUT_TOL);
    list.push({
      rgb: [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])],
      clipped: clipped
    });
  }

  /* --------------------------------------------------------------- ramps */

  /* A polyline through the anchors in order; two anchors give a plain gradient. */
  function buildLine(anchors, space, steps) {
    var list = [];
    var mixed = [0, 0, 0];
    var coords = anchors.map(function (a) { return space.from(a.rgb, [0, 0, 0]); });

    for (var seg = 0; seg < coords.length - 1; seg++) {
      var last = seg === coords.length - 2;
      var n = last ? steps : steps - 1;
      for (var i = 0; i <= n; i++) {
        mix2(space, coords[seg], coords[seg + 1], i / steps, mixed);
        emit(space, mixed, list);
      }
    }
    return list;
  }

  /* Fan the polygon into triangles from its centroid and fill each one with
   * barycentric samples. Three anchors give a flat triangle; more give a curved
   * surface that still follows the outline the anchors make, and every anchor
   * keeps exactly the colour that was entered. */
  function buildPatch(anchors, space, res) {
    var list = [];
    var coords = anchors.map(function (a) { return space.from(a.rgb, [0, 0, 0]); });
    var n = coords.length;

    var even = [];
    for (var q = 0; q < n; q++) even.push(1 / n);
    var centre = mixN(space, coords, even, [0, 0, 0]);

    var w = [0, 0, 0];
    var mixed = [0, 0, 0];

    for (var e = 0; e < n; e++) {
      var tri = [centre, coords[e], coords[(e + 1) % n]];

      for (var i = 0; i <= res; i++) {
        for (var j = 0; j <= res - i; j++) {
          w[0] = i / res;
          w[1] = j / res;
          w[2] = 1 - w[0] - w[1];
          mixN(space, tri, w, mixed);
          emit(space, mixed, list);
        }
      }
    }
    return list;
  }

  /* Ordered by hue so the polygon traced by the anchors never self-intersects.
   * Oklab hue specifically, not the active model's, so the ordering does not
   * shift when you switch models. */
  function orderByHue(anchors) {
    var lab = [0, 0, 0];
    return anchors.map(function (a) {
      rgbToOklab(a.rgb, lab);
      return { a: a, h: Math.atan2(lab[2], lab[1]) };
    }).sort(function (p, q) { return p.h - q.h; })
      .map(function (p) { return p.a; });
  }

  /* Pushes anchors and ramp points into a cloud builder, and hands back the
   * generated colours so the UI can show them as swatches. */
  function appendTo(b, model, o) {
    var anchors = (o.anchors || []).filter(function (a) { return a && a.rgb; });
    if (!anchors.length) return [];

    var space = spaceById[o.rampSpace] || SPACES[0];
    var meta = [0, 0, 0];
    var list = [];

    /* The caller resolves which kind of ramp is wanted; a plane slice produces
     * no ramp points at all, since the cut face carries its own colours. */
    if (o.rampKind === 'line' || o.rampKind === 'blend') {
      list = o.rampKind === 'blend'
        ? buildPatch(orderByHue(anchors), space, o.rampRes)
        : buildLine(anchors, space, o.rampSteps);

      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        model.fromRGB(p.rgb[0], p.rgb[1], p.rgb[2], meta);
        b.push(meta[0], meta[1], meta[2], p.rgb, CC.KIND.RAMP, p.clipped);
      }
    }

    /* Anchors last so they sit on top of their own ramp. */
    for (var k = 0; k < anchors.length; k++) {
      var rgb = anchors[k].rgb;
      model.fromRGB(rgb[0], rgb[1], rgb[2], meta);
      b.push(meta[0], meta[1], meta[2], rgb, CC.KIND.ANCHOR, 0);
    }

    return list;
  }

  CC.ramp = {
    spaces: SPACES,
    parseColor: parseColor,
    appendTo: appendTo,
    buildLine: buildLine,
    buildPatch: buildPatch
  };
})(this);
