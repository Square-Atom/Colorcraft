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
    envelope: 'p3',
    outerOpacity: 0.32,

    /* user colors and the ramp between them */
    anchors: [],
    rampSpace: 'oklab',
    rampMode: 'auto',
    rampSteps: 16,
    rampRes: 10,

    /* plane slices */
    planes: [],
    planeIndex: 0,
    sliceIn3D: true,
    /* Inverted for the UI: the cut is bounded by its border unless asked
     * otherwise. sliceClip is derived from this at rebuild. */
    showOutside: false,
    soloPlane: false,
    slice3DRes: 58,

    /* editing */
    selected: -1,
    pickerMode: 'hsv',

    /* how it looks */
    pointSize: 5,
    opacity: 1,
    depthCue: 0.35,
    shape: 'round',
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

  var VIEW_DEFAULTS = { yaw: 0.7, pitch: 0.28, panX: 0, panY: 0 };

  var canvas = document.getElementById('view');
  var renderer = new CC.Renderer(canvas);
  var model = CC.models.get(state.modelId);
  var cloud = null;
  var dirty = true;

  /* Nesting mode builds an sRGB lattice and adds a shell, so it shares every
   * lattice control. */
  function usesLattice() { return state.sampling !== 'cube'; }
  function isNested() { return state.sampling === 'nest'; }
  function nestReady() { return isNested() && model.perceptual; }

  function hasPair() { return state.anchors.length >= 2; }
  function hasTriple() { return state.anchors.length >= 3; }

  /* With three or more points "auto" means cut a plane; with two there is no
   * plane to cut, so it falls back to a line. */
  function rampKind() {
    var m = state.rampMode;
    if (m === 'none') return 'none';
    if (!hasPair()) return 'none';
    if (m === 'auto') return hasTriple() ? 'plane' : 'line';
    if ((m === 'plane' || m === 'blend') && !hasTriple()) return 'line';
    return m;
  }

  function hasBlend() { return rampKind() === 'blend'; }
  function hasLine() { return rampKind() === 'line'; }
  function hasPlane() { return rampKind() === 'plane'; }

  /* ------------------------------------------------------------- controls */

  var CONTROLS = [
    { sec: 'model', type: 'select', key: 'modelId', label: 'Color model', rebuild: true,
      options: CC.models.list.map(function (m) { return { value: m.id, label: m.name }; }) },
    { sec: 'model', type: 'note', note: function () { return model.blurb; } },
    { sec: 'model', type: 'select', key: 'sampling', label: 'Sampling', rebuild: true,
      options: [
        { value: 'lattice', label: 'Hue / lightness lattice' },
        { value: 'cube', label: 'sRGB cube (true distribution)' },
        { value: 'nest', label: 'sRGB inside a wider gamut' }
      ] },
    { sec: 'model', type: 'select', key: 'envelope', label: 'Outer envelope', rebuild: true,
      when: nestReady,
      options: [{ value: 'cylinder', label: 'Full LCh cylinder' }].concat(
        CC.gamuts.list.filter(function (g) { return g.id !== 'srgb'; })
          .map(function (g) { return { value: g.id, label: g.name }; })) },
    { sec: 'model', type: 'note', when: nestReady, note: function () {
        if (state.envelope === 'cylinder')
          return 'The raw coordinate cylinder — how little of it sRGB actually fills.';
        return CC.gamuts.get(state.envelope).note;
      } },
    { sec: 'model', type: 'note',
      when: function () { return isNested() && !model.perceptual; },
      note: function () {
        return 'Gamut nesting needs a perceptual model — HSV and HSL have no ' +
               'fixed position in CIE space. Switch to Oklch or CIE LCh.';
      } },

    { sec: 'density', type: 'range', key: 'hueSteps', label: 'Hue steps',
      min: 6, max: 72, step: 1, rebuild: true, when: usesLattice },
    { sec: 'density', type: 'range', key: 'lightSteps', label: 'Lightness levels',
      min: 3, max: 33, step: 1, rebuild: true, when: usesLattice },
    { sec: 'density', type: 'range', key: 'chromaSteps', label: 'Chroma rings',
      min: 1, max: 12, step: 1, rebuild: true, when: usesLattice },
    { sec: 'density', type: 'check', key: 'chromaFill', label: 'Rings ride the gamut edge',
      rebuild: true, when: usesLattice },
    { sec: 'density', type: 'check', key: 'surfaceOnly', label: 'Outer shell only',
      rebuild: true, when: usesLattice },
    { sec: 'density', type: 'check', key: 'showAxis', label: 'Include neutral axis',
      rebuild: true },
    { sec: 'density', type: 'range', key: 'cubeSteps', label: 'Cube steps per channel',
      min: 4, max: 24, step: 1, rebuild: true,
      when: function () { return !usesLattice(); } },
    { sec: 'density', type: 'range', key: 'outerOpacity', label: 'Envelope opacity',
      min: 0.05, max: 1, step: 0.01, when: nestReady },

    { sec: 'appearance', type: 'range', key: 'pointSize', label: 'Point size',
      min: 1, max: 16, step: 0.5 },
    { sec: 'appearance', type: 'range', key: 'opacity', label: 'Opacity',
      min: 0.1, max: 1, step: 0.01 },
    { sec: 'appearance', type: 'range', key: 'depthCue', label: 'Depth fade',
      min: 0, max: 1, step: 0.01 },
    { sec: 'appearance', type: 'select', key: 'shape', label: 'Point shape',
      options: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square (faster)' }] },
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

    { sec: 'points', type: 'anchors' },
    { sec: 'points', type: 'note',
      when: function () { return !state.anchors.length; },
      note: function () {
        return 'Add a point, then set its color. Two points draw a ramp between ' +
               'them; three cut a plane through the solid.';
      } },

    { sec: 'ramp', type: 'select', key: 'rampMode', label: 'Mode', rebuild: true,
      when: hasPair,
      options: [
        { value: 'auto', label: 'Auto — line, or plane from 3' },
        { value: 'line', label: 'Line through points' },
        { value: 'plane', label: 'Plane slice' },
        { value: 'blend', label: 'Blend fill' },
        { value: 'none', label: 'Nothing — points only' }
      ] },
    { sec: 'ramp', type: 'select', key: 'rampSpace', label: 'Blend in', rebuild: true,
      when: function () { return hasLine() || hasBlend(); },
      options: CC.ramp.spaces.map(function (s) { return { value: s.id, label: s.name }; }) },
    { sec: 'ramp', type: 'range', key: 'rampSteps', label: 'Steps per segment',
      min: 2, max: 64, step: 1, rebuild: true, when: hasLine },
    { sec: 'ramp', type: 'range', key: 'rampRes', label: 'Fill resolution',
      min: 2, max: 26, step: 1, rebuild: true, when: hasBlend },
    { sec: 'ramp', type: 'note', when: hasPlane, note: function () {
        return 'A plane slice shows every color the cut passes through. The three ' +
               'points only choose the angle of the cut.';
      } },
    { sec: 'ramp', type: 'note',
      when: function () { return !hasPair(); },
      note: function () { return 'Add at least two points.'; } },

    { sec: 'top', type: 'check', key: 'sliceIn3D', label: 'Show the cut in 3D',
      rebuild: true, when: hasPlane },

    { sec: 'planes', type: 'planes' },
    { sec: 'planes', type: 'check', key: 'showOutside',
      label: 'Show color outside the border', rebuild: true, when: hasPlane },
    { sec: 'planes', type: 'check', key: 'soloPlane', label: 'Hide color outside the plane',
      when: function () { return hasPlane() && state.sliceIn3D; } },
    { sec: 'planes', type: 'range', key: 'slice3DRes', label: 'Cut density in 3D',
      min: 16, max: 110, step: 1, rebuild: true,
      when: function () { return hasPlane() && state.sliceIn3D; } },

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
      row.className = 'row note';
      entry.sync = function () { row.textContent = def.note(); };
    } else if (def.type === 'planes') {
      row.className = 'row planegrid';
      entry.sync = function () {
        row.textContent = '';

        if (!hasTriple()) {
          row.appendChild(el('div', 'note', 'Add a third point to cut a plane.'));
          return;
        }

        state.planes.forEach(function (p, idx) {
          var btn = el('button', 'planebtn' + (idx === state.planeIndex ? ' on' : ''));
          var label = p.combo.map(function (x) { return x + 1; }).join('·');

          if (p.frame) {
            var cv = document.createElement('canvas');
            cv.width = cv.height = THUMB;
            cv.getContext('2d').putImageData(new ImageData(p.thumb, THUMB, THUMB), 0, 0);
            btn.appendChild(cv);
            btn.title = 'Plane through points ' + label;
          } else {
            btn.classList.add('bad');
            btn.title = 'Points ' + label + ' are collinear — they define no plane';
          }

          btn.appendChild(el('span', 'plabel', label));
          btn.addEventListener('click', function () { selectPlane(idx); });
          row.appendChild(btn);
        });

        if (state.planes.length >= CC.slice.MAX_PLANES) {
          row.appendChild(el('div', 'note',
            'Showing the first ' + CC.slice.MAX_PLANES + ' combinations.'));
        }
      };
    } else if (def.type === 'anchors') {
      entry.sync = buildAnchorList(row);
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
    /* Switching sampling or envelope can change the cloud's extent several-fold,
     * so reframe. Other rebuilds leave the camera where the user put it. */
    if (key === 'sampling' || key === 'envelope') fitView();
    syncPanel();
    dirty = true;
  }

  /* -------------------------------------------------------------- picker */

  var CHANNELS = {
    rgb: [{ name: 'R', max: 255 }, { name: 'G', max: 255 }, { name: 'B', max: 255 }],
    hsv: [{ name: 'H', max: 360 }, { name: 'S', max: 100 }, { name: 'V', max: 100 }]
  };

  function hsvScratch(rgb) {
    var out = [0, 0, 0];
    CC.color.rgbToHsv(rgb[0], rgb[1], rgb[2], out);
    return out;
  }

  /* Each point carries both representations. HSV is kept alongside RGB rather
   * than derived on demand because hue is undefined for greys and blacks:
   * storing it stops the hue slider snapping to zero every time saturation or
   * value touches the bottom. */
  function makeColor(rgb) {
    var a = { rgb: rgb.slice(), hsv: [0, 0, 0] };
    setColorRgb(a, rgb);
    return a;
  }

  function setColorRgb(a, rgb) {
    a.rgb = rgb.slice();
    var hsv = hsvScratch(rgb);
    var h = hsv[1] < 1e-6 || hsv[2] < 1e-6 ? a.hsv[0] : hsv[0] * 360;
    a.hsv = [h, hsv[1] * 100, hsv[2] * 100];
  }

  function setColorHsv(a, hsv) {
    a.hsv = hsv.slice();
    var rgb = [0, 0, 0];
    CC.color.hsvToRgb(hsv[0] / 360, hsv[1] / 100, hsv[2] / 100, rgb);
    a.rgb = rgb;
  }

  function hexOf(rgb) {
    return CC.color.toHex(rgb[0], rgb[1], rgb[2]).toUpperCase();
  }

  /* Track backgrounds preview what moving that one slider would do, which makes
   * the picker far easier to aim than three bare sliders. */
  function trackFor(a, i) {
    var stops = [];
    var rgb = [0, 0, 0];
    var k;

    if (state.pickerMode === 'rgb') {
      for (k = 0; k <= 1; k++) {
        var c = a.rgb.slice();
        c[i] = k;
        stops.push(hexOf(c));
      }
    } else if (i === 0) {
      /* Floors on saturation and value so the hue track still reads as a
       * spectrum when the colour itself is nearly black or grey. */
      for (k = 0; k <= 6; k++) {
        CC.color.hsvToRgb(k / 6, Math.max(a.hsv[1] / 100, 0.15),
          Math.max(a.hsv[2] / 100, 0.35), rgb);
        stops.push(hexOf(rgb));
      }
    } else {
      for (k = 0; k <= 1; k++) {
        var v = [a.hsv[0] / 360, a.hsv[1] / 100, a.hsv[2] / 100];
        v[i] = k;
        CC.color.hsvToRgb(v[0], v[1], v[2], rgb);
        stops.push(hexOf(rgb));
      }
    }
    return 'linear-gradient(90deg,' + stops.join(',') + ')';
  }

  /* The editor for one point, folded into its row in the list. Only the
   * selected point has one, which is what keeps a long list readable. */
  function buildEditor(host, idx) {
    var box = el('div', 'editor picker');
    var modes = el('div', 'modes');
    var buttons = {};

    ['hsv', 'rgb'].forEach(function (m) {
      var b = el('button', 'mode', m.toUpperCase());
      b.addEventListener('click', function () {
        state.pickerMode = m;
        syncPanel();
      });
      buttons[m] = b;
      modes.appendChild(b);
    });
    box.appendChild(modes);

    var chans = [0, 1, 2].map(function (i) {
      var lab = el('span', 'clab');
      var num = el('span', 'cval');
      var top = el('div', 'chanhead');
      top.appendChild(lab);
      top.appendChild(num);

      var inp = document.createElement('input');
      inp.type = 'range';
      inp.addEventListener('input', function () {
        var a = state.anchors[idx];
        if (!a) return;
        var v = parseFloat(inp.value);

        if (state.pickerMode === 'rgb') {
          var rgb = a.rgb.slice();
          rgb[i] = v / 255;
          setColorRgb(a, rgb);
        } else {
          var hsv = a.hsv.slice();
          hsv[i] = v;
          setColorHsv(a, hsv);
        }
        requestRebuild();
        syncPanel();
      });

      var line = el('div', 'chan');
      line.appendChild(top);
      line.appendChild(inp);
      box.appendChild(line);
      return { lab: lab, num: num, inp: inp };
    });

    var field = document.createElement('input');
    field.type = 'text';
    field.spellcheck = false;
    field.placeholder = '#ff8800 · 255 136 0 · hsv 30 100 100';
    var err = el('div', 'err');
    box.appendChild(field);
    box.appendChild(err);

    field.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var a = state.anchors[idx];
      var rgb = CC.ramp.parseColor(field.value);
      if (!a) return;
      if (!rgb) {
        err.textContent = 'Not a color I recognise — try a hex, RGB or HSV triple.';
        return;
      }
      err.textContent = '';
      setColorRgb(a, rgb);
      requestRebuild();
      syncPanel();
    });

    /* Clicks inside the editor must not bubble up and re-select the row. */
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    host.appendChild(box);

    return function () {
      var a = state.anchors[idx];
      if (!a) return;

      var mode = state.pickerMode;
      var spec = CHANNELS[mode];
      var values = mode === 'rgb'
        ? a.rgb.map(function (v) { return v * 255; })
        : a.hsv;

      buttons.rgb.classList.toggle('on', mode === 'rgb');
      buttons.hsv.classList.toggle('on', mode === 'hsv');

      chans.forEach(function (c, i) {
        c.lab.textContent = spec[i].name;
        c.num.textContent = Math.round(values[i]);
        c.inp.min = 0;
        c.inp.max = spec[i].max;
        c.inp.step = 1;
        /* Never write back into the control being dragged. */
        if (document.activeElement !== c.inp) c.inp.value = Math.round(values[i]);
        c.inp.style.setProperty('--track', trackFor(a, i));
      });

      if (document.activeElement !== field) field.value = hexOf(a.rgb);
    };
  }

  /* The point list. Its DOM is rebuilt only when the structure changes -- not
   * on every slider move, which would tear the control out from under the
   * pointer mid-drag. */
  function buildAnchorList(row) {
    row.className = 'row anchors';
    var signature = null;
    var refs = [];
    var editorSync = null;

    function render() {
      row.textContent = '';
      refs = [];
      editorSync = null;

      state.anchors.forEach(function (a, idx) {
        var selected = idx === state.selected;
        var item = el('div', 'anchor' + (selected ? ' on' : ''));

        var head = el('div', 'ahead');
        var chip = el('span', 'chip');
        var hex = el('span', 'hex');
        var del = el('button', 'x', '×');
        del.title = 'Remove';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          removeAnchor(idx);
        });

        head.appendChild(el('span', 'anum', String(idx + 1)));
        head.appendChild(chip);
        head.appendChild(hex);
        head.appendChild(del);
        head.addEventListener('click', function () { selectPoint(idx); });

        item.appendChild(head);
        if (selected) editorSync = buildEditor(item, idx);

        refs.push({ chip: chip, hex: hex });
        row.appendChild(item);
      });

      var add = el('button', 'btn add', '+ Add point');
      add.addEventListener('click', addPoint);
      row.appendChild(add);

      if (state.anchors.length) {
        var clear = el('button', 'btn', 'Clear all points');
        clear.addEventListener('click', clearAnchors);
        row.appendChild(clear);
      }
    }

    return function () {
      var sig = state.anchors.length + '|' + state.selected + '|' + state.pickerMode;
      if (sig !== signature) { signature = sig; render(); }

      state.anchors.forEach(function (a, idx) {
        var hex = hexOf(a.rgb);
        refs[idx].chip.style.background = hex;
        refs[idx].hex.textContent = hex;
      });
      if (editorSync) editorSync();
    };
  }

  /* -------------------------------------------------------------- planes */

  var THUMB = 44;
  var SLICE_SIZE = 256;

  function selectPlane(idx) {
    state.planeIndex = idx;
    rebuild_();
    syncPanel();
    dirty = true;
  }

  function buildSlices() {
    state.planes = hasTriple()
      ? CC.slice.build(model, state.anchors, THUMB, state.sliceClip)
      : [];
    if (state.planeIndex >= state.planes.length) state.planeIndex = 0;
  }

  function updateSlicePanel() {
    var host = document.getElementById('slicePanel');
    var plane = hasPlane() ? state.planes[state.planeIndex] : null;

    if (!plane || !plane.frame) {
      host.classList.add('hidden');
      return;
    }

    host.classList.remove('hidden');

    var cv = document.getElementById('sliceView');
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, SLICE_SIZE, SLICE_SIZE);
    ctx.putImageData(new ImageData(
      CC.slice.raster(model, plane.frame, SLICE_SIZE, state.sliceClip),
      SLICE_SIZE, SLICE_SIZE), 0, 0);

    var R = CC.slice.RADIUS;
    var toPixel = function (uv) {
      return [((uv[0] / R) + 1) / 2 * (SLICE_SIZE - 1),
              ((-uv[1] / R) + 1) / 2 * (SLICE_SIZE - 1)];
    };

    /* Stroked twice, dark then light, so the marks stay legible whatever colour
     * they land on. */
    var outline = function (alpha) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(0,0,0,' + alpha * 0.6 + ')';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.stroke();
    };

    var pix = plane.frame.points.map(function (p) {
      return toPixel(CC.slice.uvOf(plane.frame, p));
    });

    /* The border the three points make, drawn whether or not it is clipping, so
     * you can see what turning the option on would cut away. */
    ctx.beginPath();
    ctx.moveTo(pix[0][0], pix[0][1]);
    ctx.lineTo(pix[1][0], pix[1][1]);
    ctx.lineTo(pix[2][0], pix[2][1]);
    ctx.closePath();
    outline(state.sliceClip ? 0.5 : 0.8);

    /* Ring the three colours that chose this cut, so you can see where they sit
     * on a face that is mostly other colours. */
    pix.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      outline(0.9);
    });

    host.querySelector('.caption').textContent =
      'points ' + plane.combo.map(function (i) { return i + 1; }).join(' · ');
  }

  /* ------------------------------------------------------------- anchors */

  function anchorsChanged() {
    rebuild_();
    syncPanel();
    dirty = true;
  }

  var FIRST_COLOR = [0.85, 0.35, 0.15];

  /* A new point starts from the selected one, so building a set of related
   * colours means adding and nudging rather than retyping from scratch. */
  function addPoint() {
    var base = state.anchors[state.selected];
    state.anchors = state.anchors.concat([makeColor(base ? base.rgb : FIRST_COLOR)]);
    state.selected = state.anchors.length - 1;
    anchorsChanged();
  }

  function selectPoint(idx) {
    state.selected = idx;
    anchorsChanged();
  }

  function removeAnchor(idx) {
    state.anchors = state.anchors.filter(function (_, i) { return i !== idx; });
    if (state.selected > idx) state.selected--;
    else if (state.selected === idx) state.selected = Math.min(idx, state.anchors.length - 1);
    anchorsChanged();
  }

  function clearAnchors() {
    state.anchors = [];
    state.selected = -1;
    anchorsChanged();
  }

  /* --------------------------------------------------------------- build */

  var needsRebuild = false;

  /* Dragging a slider fires input faster than the cloud can be rebuilt, so
   * defer to the frame loop, where many events collapse into one rebuild. */
  function requestRebuild() {
    needsRebuild = true;
    dirty = true;
  }

  function rebuild_() {
    var t0 = performance.now();
    /* Resolved once here so the cloud, ramp and slice builders all agree on
     * what "auto" meant for the current number of points. */
    state.rampKind = rampKind();
    state.sliceClip = !state.showOutside;
    /* Planes first: the cloud builder scatters the selected cut into 3D. */
    buildSlices();
    cloud = CC.cloud.build(model, state);
    var ms = performance.now() - t0;
    document.getElementById('count').textContent =
      cloud.count.toLocaleString() + ' points · ' + ms.toFixed(0) + ' ms';
    updateStrip();
    updateSlicePanel();
    dirty = true;
  }

  /* Generated ramps double as a palette, so lay them out flat as swatches. A
   * filled patch runs to hundreds of colors, which is useless as a strip, so
   * subsample for display while copy still yields the full set. */
  var STRIP_MAX = 64;

  function updateStrip() {
    var host = document.getElementById('ramp');
    var colors = (cloud && cloud.rampColors) || [];

    if (!colors.length) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');

    var step = Math.max(1, Math.ceil(colors.length / STRIP_MAX));
    var strip = host.querySelector('.strip');
    strip.textContent = '';
    var shown = 0;

    for (var i = 0; i < colors.length; i += step) {
      var c = colors[i];
      var hex = CC.color.toHex(c.rgb[0], c.rgb[1], c.rgb[2]).toUpperCase();
      var sw = el('button', c.clipped ? 'sw clipped' : 'sw');
      sw.style.background = hex;
      sw.title = hex + (c.clipped ? '  (clipped into sRGB)' : '');
      sw.addEventListener('click', copyText.bind(null, hex));
      strip.appendChild(sw);
      shown++;
    }

    host.querySelector('.meta').textContent =
      colors.length + ' colors' + (shown < colors.length ? ' · showing ' + shown : '');
  }

  function copyRamp() {
    var colors = (cloud && cloud.rampColors) || [];
    if (!colors.length) return;
    copyText(colors.map(function (c) {
      return CC.color.toHex(c.rgb[0], c.rgb[1], c.rgb[2]).toUpperCase();
    }).join('\n'), colors.length + ' hex codes');
  }

  /* Pull back far enough to frame the whole cloud, whatever its extent. */
  function fitView() {
    var maxC = cloud ? cloud.maxC : 1;
    var maxY = cloud ? cloud.maxY : 0.5;
    var radius = Math.sqrt(Math.pow(maxC * state.radiusScale, 2) +
                           Math.pow(maxY * state.heightScale, 2));
    state.dist = Math.max(0.8, radius / Math.sin(state.fov * Math.PI / 360) * 1.15);
    dirty = true;
  }

  function resetView() {
    for (var k in VIEW_DEFAULTS) state[k] = VIEW_DEFAULTS[k];
    fitView();
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
    else if (k === '[') togglePanel('left');
    else if (k === ']') togglePanel('right');
    else if (k === 'h') {
      /* Both at once, for a clean look at the solid. If either is showing,
       * hide both; otherwise bring both back. */
      var anyShown = !document.body.classList.contains('left-hidden') ||
                     !document.body.classList.contains('right-hidden');
      togglePanel('left', anyShown);
      togglePanel('right', anyShown);
    } else if (e.code === 'Space') { e.preventDefault(); setValue('autoRotate', !state.autoRotate, false); }
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

  function copyText(text, label) {
    /* execCommand fallback matters here: the clipboard API is unavailable on
     * file:// in several browsers, and this app is meant to run by double-click. */
    var done = function () {
      toast.textContent = 'Copied ' + (label || text);
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

  document.getElementById('copyRamp').addEventListener('click', copyRamp);

  /* Each panel slides out of its own edge, leaving the solid in the middle. */
  function togglePanel(side, force) {
    var cls = side + '-hidden';
    document.body.classList.toggle(cls, force);
    dirty = true;
  }

  document.getElementById('toggleLeft').addEventListener('click', function () {
    togglePanel('left');
  });
  document.getElementById('toggleRight').addEventListener('click', function () {
    togglePanel('right');
  });

  global.addEventListener('resize', function () { dirty = true; });

  var params = {};

  function frame() {
    renderer.resize();
    if (state.autoRotate) { state.yaw += 0.0035; dirty = true; }
    if (needsRebuild) { needsRebuild = false; rebuild_(); }

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
  fitView();
  frame();
})(this);
