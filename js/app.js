/* UI wiring, camera input and the frame loop.
 *
 * Controls are declared as data and the panel is generated from that list, so
 * adding a slider means adding one line rather than editing HTML, CSS and an
 * event handler in three places.
 */
(function (global) {
  'use strict';

  var CC = global.CC;
  var DEG = Math.PI / 180;

  var state = {
    /* what to build */
    modelId: 'oklch',
    sampling: 'lattice',
    hueSteps: 36,
    lightSteps: 17,
    chromaSteps: 5,
    chromaFill: true,
    surfaceOnly: false,
    showAxis: true,
    cubeSteps: 12,

    /* how it looks */
    pointSize: 5,
    opacity: 1,
    depthCue: 0.35,
    shape: 'square',
    radiusScale: 1.15,
    heightScale: 1.6,

    /* what is hidden */
    lMin: 0, lMax: 1,
    cMin: 0, cMax: 1,
    cutStartDeg: 0, cutSizeDeg: 0,

    /* scene */
    background: '#12131a',
    guides: true,
    labels: true,
    autoRotate: false,

    /* camera */
    yaw: 0.7, pitch: 0.28, dist: 3.1, panX: 0, panY: 0, fov: 55
  };

  var VIEW_DEFAULTS = { yaw: 0.7, pitch: 0.28, dist: 3.1, panX: 0, panY: 0 };

  var canvas = document.getElementById('view');
  var renderer = new CC.Renderer(canvas);
  var model = CC.models.get(state.modelId);
  var cloud = null;
  var dirty = true;

  function isLattice() { return state.sampling === 'lattice'; }

  /* ------------------------------------------------------------- controls */

  var CONTROLS = [
    { sec: 'model', type: 'select', key: 'modelId', label: 'Color model', rebuild: true,
      options: CC.models.list.map(function (m) { return { value: m.id, label: m.name }; }) },
    { sec: 'model', type: 'note', note: function () { return model.blurb; } },
    { sec: 'model', type: 'select', key: 'sampling', label: 'Sampling', rebuild: true,
      options: [
        { value: 'lattice', label: 'Hue / lightness lattice' },
        { value: 'cube', label: 'sRGB cube (true distribution)' }
      ] },

    { sec: 'density', type: 'range', key: 'hueSteps', label: 'Hue steps',
      min: 6, max: 72, step: 1, rebuild: true, when: isLattice },
    { sec: 'density', type: 'range', key: 'lightSteps', label: 'Lightness levels',
      min: 3, max: 33, step: 1, rebuild: true, when: isLattice },
    { sec: 'density', type: 'range', key: 'chromaSteps', label: 'Chroma rings',
      min: 1, max: 12, step: 1, rebuild: true, when: isLattice },
    { sec: 'density', type: 'check', key: 'chromaFill', label: 'Rings ride the gamut edge',
      rebuild: true, when: isLattice },
    { sec: 'density', type: 'check', key: 'surfaceOnly', label: 'Outer shell only',
      rebuild: true, when: isLattice },
    { sec: 'density', type: 'check', key: 'showAxis', label: 'Include neutral axis',
      rebuild: true },
    { sec: 'density', type: 'range', key: 'cubeSteps', label: 'Cube steps per channel',
      min: 4, max: 24, step: 1, rebuild: true, when: function () { return !isLattice(); } },

    { sec: 'appearance', type: 'range', key: 'pointSize', label: 'Point size',
      min: 1, max: 16, step: 0.5 },
    { sec: 'appearance', type: 'range', key: 'opacity', label: 'Opacity',
      min: 0.1, max: 1, step: 0.01 },
    { sec: 'appearance', type: 'range', key: 'depthCue', label: 'Depth fade',
      min: 0, max: 1, step: 0.01 },
    { sec: 'appearance', type: 'select', key: 'shape', label: 'Point shape',
      options: [{ value: 'square', label: 'Square (faster)' }, { value: 'round', label: 'Round' }] },
    { sec: 'appearance', type: 'range', key: 'radiusScale', label: 'Radial spread',
      min: 0.3, max: 2.5, step: 0.01 },
    { sec: 'appearance', type: 'range', key: 'heightScale', label: 'Vertical spread',
      min: 0.3, max: 3, step: 0.01 },

    { sec: 'slice', type: 'range2', keys: ['lMin', 'lMax'], label: 'Lightness range',
      min: 0, max: 1, step: 0.01 },
    { sec: 'slice', type: 'range2', keys: ['cMin', 'cMax'], label: 'Chroma range',
      min: 0, max: 1, step: 0.01 },
    { sec: 'slice', type: 'range', key: 'cutSizeDeg', label: 'Cutaway wedge',
      min: 0, max: 340, step: 1, unit: '°' },
    { sec: 'slice', type: 'range', key: 'cutStartDeg', label: 'Cutaway position',
      min: 0, max: 359, step: 1, unit: '°' },

    { sec: 'view', type: 'color', key: 'background', label: 'Background' },
    { sec: 'view', type: 'presets', key: 'background',
      values: ['#000000', '#12131a', '#3a3a3e', '#808080', '#d8d8dc', '#ffffff'] },
    { sec: 'view', type: 'check', key: 'guides', label: 'Axis and equator' },
    { sec: 'view', type: 'check', key: 'labels', label: 'Hue labels' },
    { sec: 'view', type: 'check', key: 'autoRotate', label: 'Auto rotate' },
    { sec: 'view', type: 'button', label: 'Reset view', action: resetView }
  ];

  var registry = [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmt(v, step) {
    return step >= 1 ? String(v) : v.toFixed(step >= 0.1 ? 1 : 2);
  }

  function buildControl(def) {
    var row = el('div', 'row');
    var entry = { def: def, row: row, sync: null };

    if (def.type === 'note') {
      row.className = 'note';
      entry.sync = function () { row.textContent = def.note(); };
    } else if (def.type === 'button') {
      var btn = el('button', 'btn', def.label);
      btn.addEventListener('click', def.action);
      row.appendChild(btn);
    } else if (def.type === 'presets') {
      row.className = 'row swatches';
      def.values.forEach(function (hex) {
        var sw = el('button', 'swatch');
        sw.style.background = hex;
        sw.title = hex;
        sw.addEventListener('click', function () { setValue(def.key, hex, false); });
        row.appendChild(sw);
      });
    } else if (def.type === 'check') {
      var lab = el('label', 'check');
      var box = document.createElement('input');
      box.type = 'checkbox';
      lab.appendChild(box);
      lab.appendChild(el('span', null, def.label));
      row.appendChild(lab);
      box.addEventListener('change', function () { setValue(def.key, box.checked, def.rebuild); });
      entry.sync = function () { box.checked = !!state[def.key]; };
    } else if (def.type === 'select') {
      row.appendChild(el('label', 'lbl', def.label));
      var sel = document.createElement('select');
      def.options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        sel.appendChild(op);
      });
      row.appendChild(sel);
      sel.addEventListener('change', function () { setValue(def.key, sel.value, def.rebuild); });
      entry.sync = function () { sel.value = state[def.key]; };
    } else if (def.type === 'color') {
      row.appendChild(el('label', 'lbl', def.label));
      var col = document.createElement('input');
      col.type = 'color';
      row.appendChild(col);
      col.addEventListener('input', function () { setValue(def.key, col.value, false); });
      entry.sync = function () { col.value = state[def.key]; };
    } else if (def.type === 'range' || def.type === 'range2') {
      var head = el('div', 'head');
      head.appendChild(el('label', 'lbl', def.label));
      var val = el('span', 'val');
      head.appendChild(val);
      row.appendChild(head);

      var keys = def.type === 'range2' ? def.keys : [def.key];
      var inputs = keys.map(function (key) {
        var r = document.createElement('input');
        r.type = 'range';
        r.min = def.min; r.max = def.max; r.step = def.step;
        row.appendChild(r);
        r.addEventListener('input', function () {
          var v = parseFloat(r.value);
          /* Keep the pair ordered so the range can never invert. */
          if (def.type === 'range2') {
            if (key === keys[0] && v > state[keys[1]]) v = state[keys[1]];
            if (key === keys[1] && v < state[keys[0]]) v = state[keys[0]];
            r.value = v;
          }
          setValue(key, v, def.rebuild);
        });
        return r;
      });

      entry.sync = function () {
        keys.forEach(function (key, i) { inputs[i].value = state[key]; });
        var unit = def.unit || '';
        val.textContent = keys.length === 2
          ? fmt(state[keys[0]], def.step) + ' – ' + fmt(state[keys[1]], def.step) + unit
          : fmt(state[def.key], def.step) + unit;
      };
    }

    registry.push(entry);
    return row;
  }

  function buildPanel() {
    CONTROLS.forEach(function (def) {
      var host = document.getElementById('sec-' + def.sec);
      if (host) host.appendChild(buildControl(def));
    });
  }

  function syncPanel() {
    registry.forEach(function (e) {
      if (e.sync) e.sync();
      if (e.def.when) e.row.classList.toggle('hidden', !e.def.when());
    });
  }

  function setValue(key, value, rebuild) {
    state[key] = value;
    if (key === 'modelId') model = CC.models.get(value);
    if (rebuild) rebuild_();
    syncPanel();
    dirty = true;
  }

  /* --------------------------------------------------------------- build */

  function rebuild_() {
    var t0 = performance.now();
    cloud = CC.cloud.build(model, state);
    var ms = performance.now() - t0;
    document.getElementById('count').textContent =
      cloud.count.toLocaleString() + ' points · ' + ms.toFixed(0) + ' ms';
    dirty = true;
  }

  function resetView() {
    for (var k in VIEW_DEFAULTS) state[k] = VIEW_DEFAULTS[k];
    dirty = true;
  }

  /* ------------------------------------------------------------- camera */

  var drag = null;

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    drag = {
      x: e.clientX,
      y: e.clientY,
      pan: e.button === 1 || e.button === 2 || e.shiftKey
    };
  });

  canvas.addEventListener('pointerup', function (e) {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drag = null;
  });

  canvas.addEventListener('pointermove', function (e) {
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;

      if (drag.pan) {
        state.panX += dx;
        state.panY += dy;
      } else {
        state.yaw += dx * 0.008;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.008));
      }
      dirty = true;
      hideReadout();
    } else {
      hover(e);
    }
  });

  canvas.addEventListener('pointerleave', hideReadout);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    state.dist = Math.max(0.6, Math.min(14, state.dist * Math.exp(e.deltaY * 0.0012)));
    dirty = true;
  }, { passive: false });

  canvas.addEventListener('dblclick', resetView);

  global.addEventListener('keydown', function (e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === 'r') resetView();
    else if (k === 'h') document.body.classList.toggle('panel-hidden');
    else if (e.code === 'Space') { e.preventDefault(); setValue('autoRotate', !state.autoRotate, false); }
  });

  /* ------------------------------------------------------------ readout */

  var readout = document.getElementById('readout');
  var hovered = -1;

  function describe(L, C, h) {
    var deg = (h * 180 / Math.PI).toFixed(0) + '°';
    if (model.id === 'oklch')
      return 'L ' + L.toFixed(3) + '   C ' + (C * model.chromaMax).toFixed(3) + '   h ' + deg;
    if (model.id === 'cielch')
      return 'L* ' + (L * 100).toFixed(1) + '   C* ' + (C * model.chromaMax).toFixed(1) + '   h ' + deg;
    return model.lLabel + ' ' + (L * 100).toFixed(0) + '%   ' +
           model.cLabel + ' ' + (C * 100).toFixed(0) + '%   h ' + deg;
  }

  function hover(e) {
    if (!cloud) return;
    var rect = canvas.getBoundingClientRect();
    var i = renderer.pick(e.clientX - rect.left, e.clientY - rect.top, 14);
    if (i < 0) { hideReadout(); return; }

    hovered = i;
    var c3 = i * 3;
    var hex = CC.color.toHex(cloud.rgb[c3] / 255, cloud.rgb[c3 + 1] / 255, cloud.rgb[c3 + 2] / 255);

    readout.classList.remove('hidden');
    readout.querySelector('.chip').style.background = hex;
    readout.querySelector('.hex').textContent = hex.toUpperCase();
    readout.querySelector('.coords').textContent =
      describe(cloud.meta[c3], cloud.meta[c3 + 1], cloud.meta[c3 + 2]);
  }

  function hideReadout() {
    hovered = -1;
    readout.classList.add('hidden');
  }

  canvas.addEventListener('click', function () {
    if (hovered < 0) return;
    var c3 = hovered * 3;
    copyText(CC.color.toHex(
      cloud.rgb[c3] / 255, cloud.rgb[c3 + 1] / 255, cloud.rgb[c3 + 2] / 255).toUpperCase());
  });

  var toast = document.getElementById('toast');
  var toastTimer = 0;

  function copyText(text) {
    /* execCommand fallback matters here: the clipboard API is unavailable on
     * file:// in several browsers, and this app is meant to run by double-click. */
    var done = function () {
      toast.textContent = 'Copied ' + text;
      toast.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 1400);
    };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else legacy();

    function legacy() {
      var ta = el('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  /* --------------------------------------------------------------- loop */

  document.getElementById('panelToggle').addEventListener('click', function () {
    document.body.classList.toggle('panel-hidden');
  });

  global.addEventListener('resize', function () { dirty = true; });

  var params = {};

  function frame() {
    renderer.resize();
    if (state.autoRotate) { state.yaw += 0.0035; dirty = true; }

    if (dirty) {
      for (var k in state) params[k] = state[k];
      params.model = model;
      params.cutStart = state.cutStartDeg * DEG;
      params.cutSize = state.cutSizeDeg * DEG;
      renderer.render(cloud, params);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  buildPanel();
  syncPanel();
  rebuild_();
  frame();
})(this);
