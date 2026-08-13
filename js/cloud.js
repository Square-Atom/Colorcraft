/* Point cloud construction.
 *
 * Produces flat typed arrays rather than objects: the renderer walks these every
 * frame, and an array of a few thousand small objects would thrash the GC.
 *
 *   pos     [x, y, z]        unit geometry, before the scale sliders
 *   rgb     [r, g, b]        0..255, ready to serialise
 *   meta    [L, C, h]        kept so the filter sliders can work without rebuilding
 *   css     "r,g,b"          prebuilt string fragment; avoids per-frame formatting
 *   kind    0..3             see CC.KIND; decides how the renderer draws the point
 *   clipped 0 or 1           1 means the true colour fell outside sRGB
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});
  var TAU = Math.PI * 2;

  /* Anything at RAMP or above was put there by the user, which is what the
   * renderer keys off to draw it at full strength and exempt it from filters. */
  var KIND = CC.KIND = {
    SOLID: 0,     /* the colour solid itself */
    ENVELOPE: 1,  /* greyed hull of a wider gamut */
    RAMP: 2,      /* generated gradient or blend fill */
    ANCHOR: 3,    /* a colour the user typed in */
    SLICE: 4      /* the cut face of a plane through the solid */
  };

  function Builder() {
    this.pos = [];
    this.rgb = [];
    this.meta = [];
    this.css = [];
    this.kind = [];
    this.clipped = [];
    this.hasOuter = false;
    this.hasSlice = false;
    /* Tracked so the camera can frame whatever was built. A wide-gamut envelope
     * reaches well past the sRGB solid, and a fixed distance would clip it. */
    this.maxC = 0;
    this.maxY = 0;
  }

  Builder.prototype.push = function (L, C, h, rgb, kind, clipped) {
    var r = Math.round(CC.color.clamp01(rgb[0]) * 255);
    var g = Math.round(CC.color.clamp01(rgb[1]) * 255);
    var b = Math.round(CC.color.clamp01(rgb[2]) * 255);

    this.pos.push(C * Math.cos(h), L - 0.5, C * Math.sin(h));
    this.rgb.push(r, g, b);
    this.meta.push(L, C, h);
    this.css.push(r + ',' + g + ',' + b);
    this.kind.push(kind || 0);
    this.clipped.push(clipped ? 1 : 0);
    if (kind === KIND.ENVELOPE) this.hasOuter = true;
    if (kind === KIND.SLICE) this.hasSlice = true;

    if (C > this.maxC) this.maxC = C;
    var y = Math.abs(L - 0.5);
    if (y > this.maxY) this.maxY = y;
  };

  Builder.prototype.finish = function () {
    return {
      count: this.css.length,
      pos: new Float32Array(this.pos),
      rgb: new Uint8Array(this.rgb),
      meta: new Float32Array(this.meta),
      css: this.css,
      kind: new Uint8Array(this.kind),
      clipped: new Uint8Array(this.clipped),
      hasOuter: this.hasOuter,
      hasSlice: this.hasSlice,
      maxC: this.maxC || 1,
      maxY: this.maxY || 0.5
    };
  };

  /* Sample on a hue/lightness/chroma lattice.
   *
   * Each lightness level gets the same number of chroma rings, but the rings are
   * placed at that level's real gamut radius. So the point *count* stays even
   * while the silhouette still bulges wherever the display can actually produce
   * saturated color -- high for yellow, low for blue.
   */
  function latticeInto(b, model, o) {
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
    return b;
  }

  /* Sample the sRGB cube uniformly and let each color fall where the model puts
   * it. Shows the true distribution of displayable colors rather than an even
   * lattice -- the clumping is the point. */
  function cubeInto(b, model, o) {
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
          b.push(out[0], out[1], out[2], rgb, KIND.SOLID, 0);
        }
      }
    }
    return b;
  }

  /* The greyed shell of a wider gamut, wrapped around the sRGB solid.
   *
   * Drawn neutral rather than colored on purpose: those colors are by definition
   * ones sRGB cannot show, so painting them in sRGB would be a lie. Grey says
   * "there is color out here that your screen cannot reach", which is the honest
   * claim.
   */
  function addEnvelope(b, model, o) {
    var rgb = [0, 0, 0];
    var xyz = [0, 0, 0];
    var Ln = o.lightSteps, Hn = o.hueSteps;
    var cylinder = o.envelope === 'cylinder';
    var gamut = cylinder ? null : CC.gamuts.get(o.envelope);

    for (var li = 0; li < Ln; li++) {
      var L = Ln === 1 ? 0.5 : li / (Ln - 1);

      for (var hj = 0; hj < Hn; hj++) {
        var h = TAU * hj / Hn;
        var cmax;

        if (cylinder) {
          /* The raw coordinate range, not a real color space: chroma simply runs
           * to its normalising maximum at every lightness. */
          cmax = 1;
        } else {
          /* Wider gamuts reach past sRGB's most saturated color, so the search
           * ceiling has to sit above the 1.0 that normalises sRGB. */
          cmax = CC.models.bisect(function (C) {
            model.toXYZ(L, C, h, xyz);
            return CC.gamuts.containsXyz(gamut, xyz[0], xyz[1], xyz[2], 1e-4);
          }, 2.5);
        }

        if (cmax < 1e-4) continue;
        model.toRGB(L, cmax, h, rgb);
        b.push(L, cmax, h, rgb, KIND.ENVELOPE, 0);
      }
    }
  }

  CC.Builder = Builder;

  CC.cloud = {
    build: function (model, opts) {
      var b;
      if (opts.sampling === 'cube') b = cubeInto(new Builder(), model, opts);
      else {
        b = latticeInto(new Builder(), model, opts);
        if (opts.sampling === 'nest' && model.perceptual) addEnvelope(b, model, opts);
      }

      /* User points, ramps and slices join the same cloud so they depth-sort
       * against the solid instead of floating in front of it. */
      if (CC.slice) CC.slice.appendTo(b, model, opts);
      var generated = CC.ramp ? CC.ramp.appendTo(b, model, opts) : [];

      var out = b.finish();
      out.rampColors = generated;
      return out;
    }
  };
})(this);
