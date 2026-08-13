/* Canvas 2D renderer: orbit camera, painter's algorithm, no dependencies.
 *
 * Canvas 2D rather than WebGL because the cloud tops out in the tens of
 * thousands of points, and back-to-front alpha blending -- which is what makes
 * the interior legible -- needs a depth sort either way. Sorting is a counting
 * sort into depth buckets, so it stays O(n) as density climbs.
 */
(function (global) {
  'use strict';

  var CC = global.CC || (global.CC = {});
  var TAU = Math.PI * 2;
  var BUCKETS = 512;

  /* Drawn as ring labels so each hue's real height is readable at a glance. */
  var PRIMARIES = [
    { name: 'R', rgb: [1, 0, 0] },
    { name: 'Y', rgb: [1, 1, 0] },
    { name: 'G', rgb: [0, 1, 0] },
    { name: 'C', rgb: [0, 1, 1] },
    { name: 'B', rgb: [0, 0, 1] },
    { name: 'M', rgb: [1, 0, 1] }
  ];

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0;
    this.h = 0;
    this.dpr = 1;

    /* Reused across frames; grown on demand. */
    this.cap = 0;
    this.sx = null;
    this.sy = null;
    this.ss = null;
    this.sd = null;
    this.src = null;
    this.order = null;
    this.counts = new Int32Array(BUCKETS);
    this.starts = new Int32Array(BUCKETS);
    this.visible = 0;
  }

  Renderer.prototype.ensure = function (n) {
    if (n <= this.cap) return;
    this.cap = n;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.ss = new Float32Array(n);
    this.sd = new Float32Array(n);
    this.src = new Int32Array(n);
    this.order = new Int32Array(n);
  };

  Renderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));

    if (w === this.w && h === this.h && dpr === this.dpr) return;

    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* Hue wedge removal, so you can cut the solid open and look inside. */
  function inCut(h, start, size) {
    if (size <= 0) return false;
    if (size >= TAU) return true;
    var d = h - start;
    d -= TAU * Math.floor(d / TAU);
    return d < size;
  }

  Renderer.prototype.render = function (cloud, s) {
    var ctx = this.ctx;
    var W = this.w, H = this.h;

    var bg = CC.color.hexToRgb(s.background) || [0.1, 0.1, 0.11];
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, W, H);

    if (!cloud || !cloud.count) { this.visible = 0; this.cloud = null; return; }
    this.cloud = cloud;
    this.ensure(cloud.count);

    var cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    var cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    var focal = (H * 0.5) / Math.tan(s.fov * Math.PI / 360);
    var cxp = W * 0.5 + s.panX, cyp = H * 0.5 + s.panY;
    var rs = s.radiusScale, hs = s.heightScale;

    var self = this;
    function project(x, y, z, out) {
      var x1 = x * cy + z * sy;
      var z1 = -x * sy + z * cy;
      var y2 = y * cp - z1 * sp;
      var z2 = y * sp + z1 * cp;
      var d = s.dist - z2;
      if (d < 0.05) return false;
      var k = focal / d;
      out[0] = cxp + x1 * k;
      out[1] = cyp - y2 * k;
      out[2] = d;
      out[3] = k;
      return true;
    }
    this.project = project;

    if (s.guides) this.drawGuides(project, s, bg);

    var pos = cloud.pos, meta = cloud.meta, kinds = cloud.kind;
    var n = cloud.count;
    var KIND = CC.KIND;
    var sxA = this.sx, syA = this.sy, ssA = this.ss, sdA = this.sd, srcA = this.src;
    var tmp = [0, 0, 0, 0];
    var vis = 0;
    var dmin = Infinity, dmax = -Infinity;
    var margin = 64;

    for (var i = 0; i < n; i++) {
      var m3 = i * 3;
      var L = meta[m3], C = meta[m3 + 1], hAng = meta[m3 + 2];
      var kind = kinds[i];

      /* Points the user put there are never filtered away -- having a colour you
       * typed silently vanish behind a slider would be baffling. */
      if (kind < KIND.RAMP) {
        if (L < s.lMin || L > s.lMax) continue;
        if (C < s.cMin || C > s.cMax) continue;
        if (inCut(hAng, s.cutStart, s.cutSize)) continue;
      }

      if (!project(pos[m3] * rs, pos[m3 + 1] * hs, pos[m3 + 2] * rs, tmp)) continue;

      var px = tmp[0], py = tmp[1];
      if (px < -margin || px > W + margin || py < -margin || py > H + margin) continue;

      var grow = kind === KIND.ANCHOR ? 2.4 : kind === KIND.RAMP ? 1.35 : 1;

      sxA[vis] = px;
      syA[vis] = py;
      ssA[vis] = Math.max(0.75, s.pointSize * tmp[3] * 0.01) * grow;
      sdA[vis] = tmp[2];
      srcA[vis] = i;
      if (tmp[2] < dmin) dmin = tmp[2];
      if (tmp[2] > dmax) dmax = tmp[2];
      vis++;
    }
    this.visible = vis;
    if (!vis) return;

    /* Counting sort, far bucket first. */
    var counts = this.counts, starts = this.starts, order = this.order;
    counts.fill(0);
    var span = dmax - dmin || 1;
    var scale = (BUCKETS - 1) / span;

    for (i = 0; i < vis; i++) counts[(sdA[i] - dmin) * scale | 0]++;

    var acc = 0;
    for (var b = BUCKETS - 1; b >= 0; b--) { starts[b] = acc; acc += counts[b]; }
    for (i = 0; i < vis; i++) order[starts[(sdA[i] - dmin) * scale | 0]++] = i;

    this.drawPoints(cloud, s, bg, vis, dmin, span);
  };

  Renderer.prototype.drawPoints = function (cloud, s, bg, vis, dmin, span) {
    var ctx = this.ctx;
    var order = this.order, sxA = this.sx, syA = this.sy, ssA = this.ss, sdA = this.sd;
    var srcA = this.src, rgb = cloud.rgb, css = cloud.css;
    var kinds = cloud.kind, clipped = cloud.clipped, meta = cloud.meta;
    var KIND = CC.KIND;
    var round = s.shape === 'round';
    var cue = s.depthCue, alpha = s.opacity;

    /* Fast path: no per-point color maths, so the prebuilt strings can be used
     * directly. This is the common case and roughly doubles throughput. The
     * envelope always needs alpha, so its presence rules the fast path out. */
    var plain = cue <= 0.001 && alpha >= 0.999 && !cloud.hasOuter;

    var bgR = bg[0] * 255, bgG = bg[1] * 255, bgB = bg[2] * 255;
    var aStr = alpha.toFixed(3);
    var outerAlpha = s.outerOpacity == null ? 0.32 : s.outerOpacity;
    var ink = CC.color.luminance(bg[0], bg[1], bg[2]) < 0.35 ? '255,255,255' : '0,0,0';

    for (var k = 0; k < vis; k++) {
      var i = order[k];
      var src = srcA[i];
      var sz = ssA[i];
      var kind = kinds[src];
      var ring = 0;

      if (kind === KIND.ENVELOPE) {
        /* Neutral, but tracking the point's own lightness so the envelope still
         * reads as a shape rather than a flat silhouette. Clamped away from the
         * extremes so it stays visible on both black and white backgrounds. */
        var v = 0.16 + 0.72 * meta[src * 3];
        var g8 = (v * 255) | 0;
        ctx.fillStyle = 'rgba(' + g8 + ',' + g8 + ',' + g8 + ',' + outerAlpha + ')';
      } else if (kind >= KIND.RAMP) {
        /* Always full strength: the cloud's opacity and depth fade are there to
         * let you see through the solid, not to dim what you added. A ring marks
         * anchors, and also ramp points whose true colour left sRGB. */
        ctx.fillStyle = 'rgb(' + css[src] + ')';
        ring = kind === KIND.ANCHOR ? 1 : (clipped[src] ? 2 : 0);
      } else if (plain) {
        ctx.fillStyle = 'rgb(' + css[src] + ')';
      } else {
        var t = cue * ((sdA[i] - dmin) / span);
        var c3 = src * 3;
        var r = rgb[c3] + (bgR - rgb[c3]) * t;
        var g = rgb[c3 + 1] + (bgG - rgb[c3 + 1]) * t;
        var b = rgb[c3 + 2] + (bgB - rgb[c3 + 2]) * t;
        ctx.fillStyle = 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + aStr + ')';
      }

      if (round || ring) {
        ctx.beginPath();
        ctx.arc(sxA[i], syA[i], sz * 0.5, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(sxA[i] - sz * 0.5, syA[i] - sz * 0.5, sz, sz);
      }

      if (ring) {
        /* Solid outline for an anchor, dashed for a clipped ramp point, so the
         * two stay distinguishable at a glance. */
        ctx.strokeStyle = 'rgba(' + ink + ',' + (ring === 1 ? 0.95 : 0.8) + ')';
        ctx.lineWidth = ring === 1 ? 1.6 : 1.1;
        if (ring === 2) ctx.setLineDash([2, 2]);
        ctx.stroke();
        if (ring === 2) ctx.setLineDash([]);
      }
    }
  };

  Renderer.prototype.drawGuides = function (project, s, bg) {
    var ctx = this.ctx;
    var light = CC.color.luminance(bg[0], bg[1], bg[2]) < 0.35;
    var ink = light ? '255,255,255' : '0,0,0';
    var a = [0, 0, 0, 0], b = [0, 0, 0, 0];
    var rs = s.radiusScale, hs = s.heightScale;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + ink + ',0.28)';

    /* Neutral axis: black at the bottom, white at the top. */
    if (project(0, -0.5 * hs, 0, a) && project(0, 0.5 * hs, 0, b)) {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    /* Equator, marking mid lightness. */
    ctx.beginPath();
    for (var i = 0; i <= 96; i++) {
      var t = TAU * i / 96;
      if (!project(Math.cos(t) * rs, 0, Math.sin(t) * rs, a)) continue;
      if (i === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
    }
    ctx.stroke();

    if (!s.labels) return;

    /* Each primary is labelled at the height the active model gives it, which
     * is the whole point of the exercise: in Oklch, Y sits far above B. */
    var model = s.model;
    var out = [0, 0, 0];
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var p = 0; p < PRIMARIES.length; p++) {
      var pr = PRIMARIES[p];
      model.fromRGB(pr.rgb[0], pr.rgb[1], pr.rgb[2], out);
      var L = out[0], C = out[1], h = out[2];
      var r = (C + 0.16) * rs;
      if (!project(Math.cos(h) * r, (L - 0.5) * hs, Math.sin(h) * r, a)) continue;

      ctx.fillStyle = 'rgba(' + ink + ',0.75)';
      ctx.fillText(pr.name, a[0], a[1]);
    }
  };

  /* Nearest visible point to the cursor, or -1. Uses the projection cached by
   * the last render, so it costs one linear scan and no re-projection. */
  Renderer.prototype.pick = function (mx, my, radius) {
    var best = -1, bestD = radius * radius, bestDepth = Infinity;
    var sxA = this.sx, syA = this.sy, sdA = this.sd, srcA = this.src;
    /* Envelope points are skipped: they sit outside sRGB, so there is no honest
     * hex to report for them. */
    var kinds = this.cloud && this.cloud.kind;

    for (var i = 0; i < this.visible; i++) {
      if (kinds && kinds[srcA[i]] === CC.KIND.ENVELOPE) continue;
      var dx = sxA[i] - mx, dy = syA[i] - my;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestD && sdA[i] < bestDepth) {
        bestD = d2;
        bestDepth = sdA[i];
        best = srcA[i];
      }
    }
    return best;
  };

  CC.Renderer = Renderer;
})(this);
