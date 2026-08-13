/* Cross-sections cut through the colour solid.
 *
 * Three colours sit at three positions in the solid, and three positions define
 * a plane. That plane slices the solid open, and the cut face carries every
 * colour the plane passes through -- not just a blend of the three you picked.
 * Those three only choose the angle of the cut.
 *
 * Everything here works in unscaled model space, so the radial and vertical
 * spread sliders cannot change which colours a plane passes through. Scaling is
 * linear, so a plane stays a plane once the renderer applies it.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});

  /* The solid fits inside a sphere of radius hypot(1, 0.5); a little margin on
   * top guarantees any planar cut is fully covered by the raster. */
  var RADIUS = 1.16;

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }

  function norm(a) {
    var l = Math.sqrt(dot(a, a));
    return l < 1e-9 ? null : [a[0] / l, a[1] / l, a[2] / l];
  }

  /* Where a colour sits in the solid, in the same geometry the cloud builder
   * uses: radius is chroma, height is lightness, angle is hue. */
  function positionOf(model, rgb) {
    var lch = [0, 0, 0];
    model.fromRGB(rgb[0], rgb[1], rgb[2], lch);
    return [lch[1] * Math.cos(lch[2]), lch[0] - 0.5, lch[1] * Math.sin(lch[2])];
  }

  /* An orthonormal frame for the plane through three positions, or null if they
   * are collinear and so define no plane at all. */
  function frameOf(p1, p2, p3) {
    var e1 = norm(sub(p2, p1));
    var n = norm(cross(sub(p2, p1), sub(p3, p1)));
    if (!e1 || !n) return null;

    var e2 = norm(cross(n, e1));

    /* Centre the raster on the solid rather than on the triangle, so the cut
     * face is framed even when the three colours huddle in one corner. */
    var d = dot(p1, n);
    return {
      e1: e1, e2: e2, n: n,
      centre: [n[0] * d, n[1] * d, n[2] * d],
      points: [p1, p2, p3]
    };
  }

  function pointAt(f, u, v) {
    return [f.centre[0] + f.e1[0] * u + f.e2[0] * v,
            f.centre[1] + f.e1[1] * u + f.e2[1] * v,
            f.centre[2] + f.e1[2] * u + f.e2[2] * v];
  }

  /* Plane coordinates of a 3D position, used to mark the anchors on the cut. */
  function uvOf(f, p) {
    var d = sub(p, f.centre);
    return [dot(d, f.e1), dot(d, f.e2)];
  }

  /* The three points lie on their own plane by construction, so their plane
   * coordinates are exact and the triangle they bound is a plain 2D one. */
  function triangleOf(f) {
    var a = uvOf(f, f.points[0]);
    var b = uvOf(f, f.points[1]);
    var c = uvOf(f, f.points[2]);
    return {
      a: a, b: b, c: c,
      det: (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    };
  }

  function insideTriangle(t, u, v) {
    if (Math.abs(t.det) < 1e-12) return false;
    var l1 = ((t.b[1] - t.c[1]) * (u - t.c[0]) + (t.c[0] - t.b[0]) * (v - t.c[1])) / t.det;
    if (l1 < 0) return false;
    var l2 = ((t.c[1] - t.a[1]) * (u - t.c[0]) + (t.a[0] - t.c[0]) * (v - t.c[1])) / t.det;
    return l2 >= 0 && l1 + l2 <= 1;
  }

  /* The solid's colour at a position, or false where the plane has passed
   * outside the gamut. Fills lch as a side effect for callers that need it. */
  function sample(model, p, rgb, lch) {
    var L = p[1] + 0.5;
    if (L < -1e-6 || L > 1 + 1e-6) return false;

    var C = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
    /* atan2 gives (-pi, pi]; models expect hue on [0, tau), which is also what
     * the cloud's own points carry. */
    var h = Math.atan2(p[2], p[0]);
    if (h < 0) h += Math.PI * 2;

    lch[0] = L; lch[1] = C; lch[2] = h;
    model.toRGB(L, C, h, rgb);
    return CC.color.inUnitRange(rgb, 1e-4);
  }

  /* Rasterise the cut face. Transparent wherever the plane is outside the
   * solid, which is what gives each slice its characteristic silhouette.
   *
   * With clip on, the three points bound the face as well as orienting it: only
   * the triangle between them survives. */
  function raster(model, frame, size, clip) {
    var data = new Uint8ClampedArray(size * size * 4);
    var rgb = [0, 0, 0], lch = [0, 0, 0];
    var tri = clip ? triangleOf(frame) : null;

    for (var j = 0; j < size; j++) {
      /* Negated so +v points up on screen rather than down. */
      var v = -((j / (size - 1)) * 2 - 1) * RADIUS;

      for (var i = 0; i < size; i++) {
        var u = ((i / (size - 1)) * 2 - 1) * RADIUS;
        if (tri && !insideTriangle(tri, u, v)) continue;
        if (!sample(model, pointAt(frame, u, v), rgb, lch)) continue;

        var k = (j * size + i) * 4;
        data[k] = rgb[0] * 255;
        data[k + 1] = rgb[1] * 255;
        data[k + 2] = rgb[2] * 255;
        data[k + 3] = 255;
      }
    }
    return data;
  }

  /* Every way of choosing three points from n, capped so a long point list
   * cannot detonate into hundreds of rasters. */
  function combinations(n, cap) {
    var out = [];
    for (var a = 0; a < n - 2; a++)
      for (var b = a + 1; b < n - 1; b++)
        for (var c = b + 1; c < n; c++) {
          out.push([a, b, c]);
          if (out.length >= cap) return out;
        }
    return out;
  }

  var MAX_PLANES = 40;

  /* One entry per combination, each with its frame and a thumbnail raster. */
  function build(model, anchors, thumbSize, clip) {
    if (!anchors || anchors.length < 3) return [];

    var pos = anchors.map(function (a) { return positionOf(model, a.rgb); });
    var combos = combinations(anchors.length, MAX_PLANES);

    return combos.map(function (c) {
      var frame = frameOf(pos[c[0]], pos[c[1]], pos[c[2]]);
      return {
        combo: c,
        frame: frame,
        thumb: frame ? raster(model, frame, thumbSize, clip) : null
      };
    });
  }

  /* Scatter the cut face into the 3D cloud so the slice can be seen in place,
   * embedded in the solid it was cut from. */
  function appendTo(b, model, o) {
    if (!o.sliceIn3D || o.rampKind !== 'plane') return;

    var planes = o.planes || [];
    var plane = planes[o.planeIndex];
    if (!plane || !plane.frame) return;

    var res = o.slice3DRes;
    var rgb = [0, 0, 0], lch = [0, 0, 0];
    var tri = o.sliceClip ? triangleOf(plane.frame) : null;

    for (var j = 0; j <= res; j++) {
      var v = ((j / res) * 2 - 1) * RADIUS;
      for (var i = 0; i <= res; i++) {
        var u = ((i / res) * 2 - 1) * RADIUS;
        if (tri && !insideTriangle(tri, u, v)) continue;
        if (!sample(model, pointAt(plane.frame, u, v), rgb, lch)) continue;
        b.push(lch[0], lch[1], lch[2], rgb, CC.KIND.SLICE, 0);
      }
    }
  }

  CC.slice = {
    RADIUS: RADIUS,
    MAX_PLANES: MAX_PLANES,
    build: build,
    raster: raster,
    appendTo: appendTo,
    positionOf: positionOf,
    uvOf: uvOf,
    triangleOf: triangleOf,
    insideTriangle: insideTriangle,
    combinations: combinations
  };
})(this);
