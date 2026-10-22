/**
 * The running half of a `Client`'s frame: it loads the surface module (bundled by the API, its
 * exports left on a symbol), hands its function the props and the surface — elements, local
 * state, its region in cells, a frame clock, pointer and keys, and `post` — and draws what it
 * returns, again on new props, after `setState`, and on a resize. A throw, a drawing past the
 * bounds, a call over a second or a render loop unmounts it and tells the host (`fault`).
 *
 * Plain JavaScript run inside the opaque-origin frame after `CLIENT_FRAME_DRAW`; it talks to the
 * host only by `postMessage`, and takes messages only from its parent.
 */
export const CLIENT_FRAME_RUNTIME = String.raw`
var ENV = Symbol.for('localix.mods.claude-code');
var EXPORTS = Symbol.for('localix.mods.client');
var boot = window.__lxClient || {};
var root = document.getElementById('root');
var dead = false, loading = true, component = null;
var props = boot.props, state, columns = 0, rows = 0, cell = { w: 8, h: 20 };
var pointerFn = null, keyFn = null, timers = [], handlers = new Map();
var scheduled = false, outside = true, rendering = false, setDuring = false, streak = 0;
var pendingPost, postQueued = false, focused = false, last = { x: 0, y: 0 }, size = '';

function send(type, payload) { parent.postMessage({ lx: 'mod-client', type: type, payload: payload }, '*'); }
// The frame clock; a test hands its own as boot.frame, the host never can: its boot is JSON.
function frame(fn) { (boot.frame || window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }
function reasonOf(error) { return String(error && error.message ? error.message : error).slice(0, 4096); }

function fault(phase, error) {
  if (dead) return;
  dead = true;
  timers.forEach(function (id) { clearInterval(id); });
  timers = []; pointerFn = keyFn = null;
  root.textContent = '';
  send('fault', { phase: phase, reason: reasonOf(error) });
}
window.addEventListener('error', function (event) { fault(loading ? 'load' : 'run', event.error || event.message); });
window.addEventListener('unhandledrejection', function (event) { fault('run', event.reason); });

/** Plain data within a tree's bounds (20,000 values, 32 deep, 100,000 characters). */
function plain(value) {
  var values = 0;
  function visit(item, depth) {
    if (++values > 20000 || depth > 32) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return isFinite(item);
    if (typeof item !== 'object') return false;
    if (Array.isArray(item)) return item.every(function (entry) { return visit(entry, depth + 1); });
    var proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.keys(item).every(function (name) { return visit(item[name], depth + 1); });
  }
  return visit(value, 1) && JSON.stringify(value).length <= 100000;
}

function act(key, name, value) {
  if (dead) return;
  if (name === 'open') return send('open', { href: value });
  var own = handlers.get(key), fn = own && own[name];
  if (!fn) return;
  outside = true;
  try {
    var result = fn(value);
    if (result && typeof result.then === 'function') result.then(null, function (e) { fault('run', e); });
  } catch (error) { fault('run', error); }
}

function schedule() { if (scheduled || dead) return; scheduled = true; frame(draw); }

function draw() {
  scheduled = false;
  if (dead || !component) return;
  var fresh = outside;
  outside = false; setDuring = false; rendering = true;
  var started = performance.now(), tree;
  try { tree = component(props, surface); } catch (error) { rendering = false; return fault('render', error); }
  rendering = false;
  if (performance.now() - started > 1000) return fault('render', 'a call took longer than a second');
  if (!setDuring) streak = 0;
  else if ((streak = fresh ? 1 : streak + 1) >= 3) return fault('run', 'a render loop: setState on every render');
  var drawn;
  try { drawn = serialize(tree); } catch (error) { return fault('render', error); }
  handlers = drawn.handlers;
  patch(root, drawn.nodes, act);
  report();
}

/** The drawing's own size, for a region sized by what it draws. */
function report() {
  var next = Math.ceil(root.scrollWidth) + 'x' + Math.ceil(root.scrollHeight);
  if (next === size) return;
  size = next;
  send('size', { width: Math.ceil(root.scrollWidth), height: Math.ceil(root.scrollHeight) });
}

function measure() {
  var probe = document.body.appendChild(document.createElement('span'));
  probe.className = 'lx-cell';
  probe.textContent = '0000000000';
  var box = probe.getBoundingClientRect();
  probe.remove();
  cell = { w: box.width / 10 || 8, h: box.height || 20 };
  var nextColumns = Math.floor(window.innerWidth / cell.w), nextRows = Math.floor(window.innerHeight / cell.h);
  if (nextColumns === columns && nextRows === rows) return false;
  columns = nextColumns; rows = nextRows;
  return true;
}

var surface = Object.freeze({
  elements: elements,
  get state() { return state; },
  setState: function (next) { state = next; if (rendering) setDuring = true; schedule(); },
  get columns() { return columns; },
  get rows() { return rows; },
  every: function (ms, fn) {
    var id = setInterval(function () {
      if (dead) return;
      outside = true;
      try { fn(); } catch (error) { fault('run', error); }
    }, Math.max(16, Number(ms) || 0));
    timers.push(id);
    return function () { clearInterval(id); timers = timers.filter(function (t) { return t !== id; }); };
  },
  onPointer: function (fn) { pointerFn = fn; return function () { if (pointerFn === fn) pointerFn = null; }; },
  onKey: function (fn) { keyFn = fn; return function () { if (keyFn === fn) keyFn = null; }; },
  post: function (data) {
    if (dead || !plain(data)) return;
    // One per frame: a later post replaces one not yet sent.
    pendingPost = JSON.parse(JSON.stringify(data));
    if (postQueued) return;
    postQueued = true;
    frame(function () { postQueued = false; if (!dead) send('post', pendingPost); });
  },
});

var BUTTONS = ['left', 'middle', 'right'];
function pointer(type) {
  return function (event) {
    if (dead) return;
    if (type === 'down') {
      focused = true;
      try { document.documentElement.setPointerCapture(event.pointerId); } catch (error) { /* not capturable */ }
    }
    if (!pointerFn) return;
    var out = { type: type, x: last.x, y: last.y };
    if (type !== 'enter' && type !== 'leave') {
      var fx = event.clientX / cell.w, fy = event.clientY / cell.h;
      out.x = last.x = Math.floor(fx); out.y = last.y = Math.floor(fy);
      out.fine = { x: fx, y: fy };
      var held = event.buttons & 1 ? 0 : event.buttons & 4 ? 1 : event.buttons & 2 ? 2 : -1;
      var button = type === 'move' ? held : event.button;
      if (BUTTONS[button] && (type !== 'move' || held >= 0)) out.button = BUTTONS[button];
    }
    if (event.shiftKey) out.shift = true;
    if (event.altKey) out.alt = true;
    if (event.ctrlKey) out.ctrl = true;
    outside = true;
    try { pointerFn(out); } catch (error) { fault('run', error); }
  };
}
['down', 'move', 'up'].forEach(function (type) { document.addEventListener('pointer' + type, pointer(type)); });
document.documentElement.addEventListener('pointerenter', pointer('enter'));
document.documentElement.addEventListener('pointerleave', pointer('leave'));
window.addEventListener('blur', function () { focused = false; });

var KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'return',
  Tab: 'tab', Backspace: 'backspace', Delete: 'delete', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end' };
document.addEventListener('keydown', function (event) {
  if (dead) return;
  var tag = event.target && event.target.tagName;
  if (event.key === 'Escape') {
    focused = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return send('escape');
  }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !focused || !keyFn) return;
  var name = KEYS[event.key] || (event.key.length === 1 ? event.key : null);
  if (!name) return;
  var out = { key: name };
  if (event.ctrlKey) out.ctrl = true;
  if (event.shiftKey) out.shift = true;
  if (event.metaKey) out.meta = true;
  event.preventDefault();
  outside = true;
  try { keyFn(out); } catch (error) { fault('run', error); }
});

function applyTheme(theme) {
  if (!theme || typeof theme.css !== 'string') return;
  document.getElementById('lx-theme').textContent = ':root{' + theme.css + '}';
  document.documentElement.dataset.theme = theme.theme === 'light' ? 'light' : 'dark';
}
window.addEventListener('message', function (event) {
  var data = event.data;
  if (event.source !== parent || !data || data.lx !== 'mod-client') return;
  if (data.type === 'props') { props = data.payload; outside = true; schedule(); }
  else if (data.type === 'theme') applyTheme(data.payload);
});

if (typeof ResizeObserver === 'function')
  new ResizeObserver(function () { if (measure()) { outside = true; schedule(); } report(); }).observe(document.documentElement);
measure();

globalThis.h = h;
globalThis.Fragment = 'Fragment';
globalThis[ENV] = Object.freeze({ h: h, Fragment: 'Fragment' });
var script = document.createElement('script');
script.textContent = boot.code || '';
document.head.appendChild(script);
loading = false;
if (!dead) {
  var exported = globalThis[EXPORTS] || {};
  var named = Object.keys(exported).filter(function (name) { return /^[A-Z]/.test(name) && typeof exported[name] === 'function'; });
  component = typeof exported.default === 'function' ? exported.default : named.length === 1 ? exported[named[0]] : null;
  if (!component) fault('load', 'the surface module exports no component: a default export, or one PascalCase export');
  else { send('ready'); draw(); }
}
`
