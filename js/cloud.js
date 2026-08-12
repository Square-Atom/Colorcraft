/* Point cloud construction.
 *
 * Produces flat typed arrays rather than objects: the renderer walks these every
 * frame, and an array of a few thousand small objects would thrash the GC.
 *
 *   pos  [x, y, z]           unit geometry, before the scale sliders
 *   rgb  [r, g, b]           0..255, ready to serialise
 *   meta [L, C, h]           kept so the filter sliders can work without rebuilding
 *   css  "r,g,b"             prebuilt string fragment; avoids per-frame formatting
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});
  var TAU = Math.PI * 2;

  function Builder() {
    this.pos = [];
    this.rgb = [];
    this.meta = [];
    this.css = [];
  }

  Builder.prototype.push = function (L, C, h, rgb) {
    var r = Math.round(CC.color.clamp01(rgb[0]) * 255);
    var g = Math.round(CC.color.clamp01(rgb[1]) * 255);
    var b = Math.round(CC.color.clamp01(rgb[2]) * 255);

    this.pos.push(C * Math.cos(h), L - 0.5, C * Math.sin(h));
    this.rgb.push(r, g, b);
    this.meta.push(L, C, h);
    this.css.push(r + ',' + g + ',' + b);
  };

  Builder.prototype.finish = function () {
    return {
      count: this.css.length,
      pos: new Float32Array(this.pos),
      rgb: new Uint8Array(this.rgb),
      meta: new Float32Array(this.meta),
      css: this.css
    };
  };

  /* Sample on a hue/lightness/chroma lattice.
   *
   * Each lightness level gets the same number of chroma rings, but the rings are
   * placed at that level's real gamut radius. So the point *count* stays even
   * while the silhouette still bulges wherever the display can actually produce
   * saturated color -- high for yellow, low for blue.
   */
  function buildLattice(model, o) {
    var b = new Builder();
    var rgb = [0, 0, 0];
    var Ln = o.lightSteps, Hn = o.hueSteps, Cn = o.chromaSteps;

    for (var li = 0; li < Ln; li++) {
      var L = Ln === 1 ? 0.5 : li / (Ln - 1);

      if (o.showAxis) {
        model.toRGB(L, 0, 0, rgb);
        b.push(L, 0, 0, rgb);
      }

      for (var hj = 0; hj < Hn; hj++) {
        var h = TAU * hj / Hn;
        var cmax = model.maxC(L, h);
        if (cmax < 1e-4) continue;

        /* The shell is the gamut boundary itself, not whichever ring happens to
         * land nearest it -- otherwise coarse uniform spacing produces an empty
         * hull, since most hues never reach a round chroma value. */
        if (o.surfaceOnly) {
          model.toRGB(L, cmax, h, rgb);
          b.push(L, cmax, h, rgb);
          continue;
        }

        for (var k = 1; k <= Cn; k++) {
          var t = k / Cn;
          var C;

          if (o.chromaFill) {
            /* Rings ride the gamut boundary: the outer ring is always the most
             * saturated color available at this level. */
            C = cmax * t;
          } else {
            /* Uniform chroma spacing instead, clipped at the boundary. Gives a
             * ragged edge but an honest sense of absolute chroma. */
            C = t;
            if (C > cmax) break;
          }

          model.toRGB(L, C, h, rgb);
          b.push(L, C, h, rgb);
        }
      }
    }
    return b.finish();
  }

  /* Sample the sRGB cube uniformly and let each color fall where the model puts
   * it. Shows the true distribution of displayable colors rather than an even
   * lattice -- the clumping is the point. */
  function buildCube(model, o) {
    var b = new Builder();
    var out = [0, 0, 0];
    var rgb = [0, 0, 0];
    var n = o.cubeSteps;

    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        for (var k = 0; k < n; k++) {
          var r = i / (n - 1), g = j / (n - 1), bl = k / (n - 1);
          model.fromRGB(r, g, bl, out);
          if (!o.showAxis && out[1] < 1e-6) continue;
          rgb[0] = r; rgb[1] = g; rgb[2] = bl;
          b.push(out[0], out[1], out[2], rgb);
        }
      }
    }
    return b.finish();
  }

  CC.cloud = {
    build: function (model, opts) {
      return opts.sampling === 'cube' ? buildCube(model, opts) : buildLattice(model, opts);
    }
  };
})(this);
