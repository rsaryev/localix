/**
 * The drawing half of a `Client`'s frame: the element factory a surface module's JSX compiles to
 * (`h`, `Fragment` and `surface.elements`, built as `@localixai/claude-plugin/mods` builds them),
 * the bounds every tree keeps, and the elements drawn as plain DOM styled with the host's theme.
 *
 * Plain JavaScript, self-contained: it runs inside the opaque-origin frame (`clientFrameDoc.ts`),
 * which can import nothing of the app. It holds no plugin data, so embedding it is not an
 * injection seam. Controls keep their handlers here, by key, as Claude Code's surface modules do.
 */
export const CLIENT_FRAME_DRAW = String.raw`
var NAMES = ['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown'];
var CONTROLS = { Button: true, Input: true, Select: true };
var HANDLERS = ['onPress', 'onInput', 'onSubmit', 'onSelect'];
var MAX_NODES = 20000, MAX_DEPTH = 32, MAX_TEXT = 100000;
var STEP = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 };
var TAGS = { Box: 'div', Text: 'span', Button: 'button', Input: 'span', Select: 'select', Link: 'a', Code: 'pre', Markdown: 'div' };

function element(type, props) {
  var rest = {};
  var children = props ? props.children : undefined;
  if (props) Object.keys(props).forEach(function (name) { if (name !== 'children') rest[name] = props[name]; });
  var list = children === undefined ? [] : Array.isArray(children) ? children : [children];
  return Object.freeze({ type: type, props: Object.freeze(rest), children: Object.freeze(list.flat()) });
}
function h(tag, props) {
  var children = Array.prototype.slice.call(arguments, 2);
  var all = Object.assign({}, props, children.length ? { children: children } : {});
  return tag === 'Fragment' ? element('Fragment', all) : tag(all);
}
var elements = {};
NAMES.forEach(function (name) { elements[name] = function (props) { return element(name, props); }; });
Object.freeze(elements);

/** A tree as JSON plus its controls' handlers by key; refused past the bounds. */
function serialize(tree) {
  var handlers = new Map(), text = 0, nodes = 0;
  function visit(child, depth) {
    if (child === null || child === undefined || typeof child === 'boolean') return [];
    if (++nodes > MAX_NODES) throw new Error('the drawing has too many elements');
    if (depth > MAX_DEPTH) throw new Error('the drawing nests too deep');
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child).length;
      if (text > MAX_TEXT) throw new Error('the drawing has too much text');
      return [String(child)];
    }
    if (typeof child !== 'object' || !('type' in child)) throw new Error('a child is not an element');
    var kids = [];
    (child.children || []).forEach(function (next) { kids = kids.concat(visit(next, depth + 1)); });
    if (child.type === 'Fragment') return kids;
    if (child.type === 'Client') throw new Error('a Client does not nest');
    if (NAMES.indexOf(child.type) < 0) throw new Error('unknown element ' + String(child.type));
    var props = {}, own = {};
    Object.keys(child.props || {}).forEach(function (name) {
      var value = child.props[name];
      if (typeof value !== 'function') props[name] = value;
      else if (HANDLERS.indexOf(name) >= 0) own[name] = value;
    });
    if (CONTROLS[child.type]) {
      if (typeof props.key !== 'string' || !props.key) throw new Error('a ' + child.type + ' has no key');
      if (handlers.has(props.key)) throw new Error('two controls share the key "' + props.key + '"');
      handlers.set(props.key, own);
    }
    return [{ type: child.type, props: props, children: kids }];
  }
  return { nodes: visit(tree, 1), handlers: handlers };
}

function asText(value, fallback) {
  var kind = typeof value;
  return kind === 'string' || kind === 'number' || kind === 'boolean' ? String(value) : fallback || '';
}
function space(value) {
  return typeof value === 'number' ? value * 4 + 'px' : typeof value === 'string' ? (STEP[value] || 0) + 'px' : '';
}
function safeHref(value) {
  var href = asText(value);
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}
function setText(node, value) { if (node.textContent !== value) node.textContent = value; }
function toggle(node, name, on) { node.classList.toggle(name, !!on); }

function create(node) {
  var made = document.createElement(TAGS[node.type]);
  made.__lxType = node.type;
  made.__lxKey = node.props.key;
  made.className = 'lx-' + node.type.toLowerCase();
  if (node.type === 'Button') made.type = 'button';
  if (node.type === 'Input') {
    made.appendChild(document.createElement('span')).className = 'lx-label';
    made.appendChild(document.createElement('input'));
    var submit = made.appendChild(document.createElement('button'));
    submit.type = 'button';
  }
  return made;
}

/** Draws the nodes into the parent, reusing the nodes already there by place, type and key. */
function patch(parent, nodes, act) {
  nodes.forEach(function (node, index) {
    var at = parent.childNodes[index];
    if (typeof node === 'string') {
      if (at && at.nodeType === 3) { if (at.data !== node) at.data = node; return; }
      var line = document.createTextNode(node);
      if (at) parent.replaceChild(line, at); else parent.appendChild(line);
      return;
    }
    if (!at || at.__lxType !== node.type || at.__lxKey !== node.props.key) {
      var made = create(node);
      if (at) parent.replaceChild(made, at); else parent.appendChild(made);
      at = made;
    }
    update(at, node, act);
  });
  while (parent.childNodes.length > nodes.length) parent.removeChild(parent.lastChild);
}

function update(el, node, act) {
  var p = node.props, key = asText(p.key), s = el.style;
  if (node.type === 'Box') {
    s.flexDirection = p.flexDirection === 'column' ? 'column' : 'row';
    s.flexWrap = p.flexWrap === 'wrap' ? 'wrap' : '';
    s.alignItems = typeof p.alignItems === 'string' ? p.alignItems : '';
    s.justifyContent = typeof p.justifyContent === 'string' ? p.justifyContent : '';
    s.gap = space(p.gap); s.rowGap = space(p.rowGap); s.columnGap = space(p.columnGap);
    s.padding = space(p.padding); s.margin = space(p.margin);
    if (p.paddingX !== undefined) s.paddingLeft = s.paddingRight = space(p.paddingX);
    if (p.paddingY !== undefined) s.paddingTop = s.paddingBottom = space(p.paddingY);
    s.flexGrow = typeof p.flexGrow === 'number' ? String(p.flexGrow) : '';
    toggle(el, 'lx-border', p.borderStyle !== undefined);
    patch(el, node.children, act);
  } else if (node.type === 'Text') {
    toggle(el, 'lx-bold', p.bold === true || p.weight === 'semibold' || p.weight === 'bold');
    toggle(el, 'lx-medium', p.weight === 'medium');
    toggle(el, 'lx-italic', p.italic === true);
    toggle(el, 'lx-underline', p.underline === true);
    toggle(el, 'lx-dim', p.dimColor === true);
    toggle(el, 'lx-mono', p.mono === true);
    toggle(el, 'lx-tabular', p.tabular === true);
    toggle(el, 'lx-truncate', typeof p.wrap === 'string' && p.wrap.indexOf('truncate') === 0);
    s.color = typeof p.color === 'string' ? p.color : '';
    patch(el, node.children, act);
  } else if (node.type === 'Button') {
    setText(el, asText(p.label));
    toggle(el, 'lx-plain', p.plain === true);
    el.onclick = function () { act(key, 'onPress'); };
  } else if (node.type === 'Input') {
    var label = el.childNodes[0], field = el.childNodes[1], submit = el.childNodes[2];
    setText(label, asText(p.label));
    field.placeholder = asText(p.placeholder);
    field.setAttribute('aria-label', asText(p.label, key));
    if (el.__lxValue !== asText(p.value)) field.value = el.__lxValue = asText(p.value);
    field.oninput = function () { act(key, 'onInput', field.value); };
    field.onkeydown = function (event) { if (event.key === 'Enter') act(key, 'onSubmit', field.value); };
    setText(submit, asText(p.submitLabel));
    submit.hidden = typeof p.submitLabel !== 'string';
    submit.onclick = function () { act(key, 'onSubmit', field.value); };
  } else if (node.type === 'Select') {
    var options = Array.isArray(p.options) ? p.options : [];
    var listed = JSON.stringify(options);
    if (el.__lxOptions !== listed) {
      el.__lxOptions = listed;
      el.textContent = '';
      options.forEach(function (option) {
        var item = el.appendChild(document.createElement('option'));
        item.value = typeof option === 'string' ? option : asText(option && option.value);
        item.textContent = typeof option === 'string' ? option : asText(option && option.label, item.value);
      });
      el.__lxPicked = undefined;
    }
    if (el.__lxPicked !== asText(p.value)) el.value = el.__lxPicked = asText(p.value);
    el.setAttribute('aria-label', asText(p.label, key));
    el.onchange = function () { act(key, 'onSelect', el.value); };
  } else if (node.type === 'Link') {
    var href = safeHref(p.href);
    if (href) el.setAttribute('href', href); else el.removeAttribute('href');
    setText(el, asText(p.label, asText(p.href)));
    el.onclick = function (event) { event.preventDefault(); if (href) act('', 'open', href); };
  } else if (node.type === 'Code') {
    setText(el, asText(p.source));
  } else {
    setText(el, asText(p.text));
    toggle(el, 'lx-dim', p.dimColor === true);
  }
}
`
