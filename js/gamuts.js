/* RGB working spaces, for comparing what different displays can actually show.
 *
 * Each gamut is defined by its primaries and white point as CIE xy chromaticities
 * -- the published, authoritative numbers -- and the XYZ matrices are derived
 * from those at load time. Deriving beats transcribing: the matrices are long
 * strings of digits that are easy to get subtly wrong, and this way adding a
 * gamut means adding eight numbers you can check against a spec.
 *
 * Only the primaries matter here. A gamut's *volume* is fixed by its primaries
 * and white point; the transfer curve only affects how values are encoded within
 * it. Since every test in this file happens in linear light, no transfer function
 * is needed at all.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});

  var D65 = [0.3127, 0.3290];

  function inv3(m) {
    var a = m[0], b = m[1], c = m[2],
        d = m[3], e = m[4], f = m[5],
        g = m[6], h = m[7], i = m[8];

    var A =  (e * i - f * h), B = -(d * i - f * g), C =  (d * h - e * g);
    var det = a * A + b * B + c * C;

    return [
      A / det, -(b * i - c * h) / det,  (b * f - c * e) / det,
      B / det,  (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det,  (a * e - b * d) / det
    ];
  }

  function apply(m, x, y, z, out) {
    out[0] = m[0] * x + m[1] * y + m[2] * z;
    out[1] = m[3] * x + m[4] * y + m[5] * z;
    out[2] = m[6] * x + m[7] * y + m[8] * z;
    return out;
  }

  /* Bruce Lindbloom's derivation: build the unscaled primary matrix, solve for
   * the per-primary scale factors that put the white point at RGB (1,1,1), then
   * fold those factors back in. */
  function primariesToXyz(r, g, b, w) {
    function tri(xy) {
      return [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
    }
    var R = tri(r), G = tri(g), B = tri(b), W = tri(w);

    var M = [R[0], G[0], B[0],
             R[1], G[1], B[1],
             R[2], G[2], B[2]];

    var S = apply(inv3(M), W[0], W[1], W[2], [0, 0, 0]);

    return [R[0] * S[0], G[0] * S[1], B[0] * S[2],
            R[1] * S[0], G[1] * S[1], B[1] * S[2],
            R[2] * S[0], G[2] * S[1], B[2] * S[2]];
  }

  function makeGamut(id, name, note, r, g, b, w) {
    var toXyz = primariesToXyz(r, g, b, w || D65);
    return { id: id, name: name, note: note, toXyz: toXyz, fromXyz: inv3(toXyz) };
  }

  var list = [
    makeGamut('srgb', 'sRGB', 'The baseline: ordinary monitors and the web.',
      [0.640, 0.330], [0.300, 0.600], [0.150, 0.060]),

    makeGamut('p3', 'Display P3', 'Apple screens and most recent laptops and phones.',
      [0.680, 0.320], [0.265, 0.690], [0.150, 0.060]),

    makeGamut('adobe', 'Adobe RGB (1998)', 'Print-oriented. Same red and blue as sRGB, far greener green.',
      [0.640, 0.330], [0.210, 0.710], [0.150, 0.060]),

    makeGamut('rec2020', 'Rec. 2020', 'The UHD broadcast target. No display covers it fully yet.',
      [0.708, 0.292], [0.170, 0.797], [0.131, 0.046])
  ];

  var byId = {};
  for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];

  var scratch = [0, 0, 0];

  function containsXyz(gamut, X, Y, Z, tol) {
    apply(gamut.fromXyz, X, Y, Z, scratch);
    return scratch[0] >= -tol && scratch[0] <= 1 + tol &&
           scratch[1] >= -tol && scratch[1] <= 1 + tol &&
           scratch[2] >= -tol && scratch[2] <= 1 + tol;
  }

  CC.gamuts = {
    list: list,
    get: function (id) { return byId[id] || byId.srgb; },
    containsXyz: containsXyz,
    primariesToXyz: primariesToXyz,
    inv3: inv3
  };
})(this);
