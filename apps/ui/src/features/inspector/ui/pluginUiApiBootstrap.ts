/**
 * Host-owned client injected into every sandboxed plugin panel/view before the
 * plugin's HTML runs. It intentionally sits ABOVE the wire protocol: existing
 * protocol-v1 documents keep working, while new documents acquire one frozen API
 * instead of reimplementing envelopes, correlation, timeouts, theme application,
 * and persisted state.
 *
 * Keep this source self-contained. It executes inside an opaque-origin srcDoc and
 * cannot import the application bundle. The static string contains no plugin data,
 * so embedding it in a <script> cannot create an interpolation/injection seam.
 */
const BOOTSTRAP_SOURCE = String.raw`
(function () {
  'use strict';

  // This document's bridge nonce. The host drops any message without it, so a page the frame
  // later navigates to (same WindowProxy, new document) cannot speak for the plugin view.
  var NONCE = '__LOCALIX_BRIDGE_NONCE__';
  if (document.currentScript) document.currentScript.remove();

  var MARKER = 'plugin-ui';
  var VERSION = 1;
  var DEFAULT_TIMEOUT_MS = 15000;
  var MAX_TIMEOUT_MS = 120000;
  var MAX_PENDING = 128;
  var acquired = false;
  var ready = false;
  var sequence = 0;
  var prefix = Math.random().toString(36).slice(2, 9);
  var pending = new Map();
  var themeListeners = new Set();
  var eventListeners = new Set();

  function post(type, payload, id) {
    var message = { lx: MARKER, v: VERSION, type: type, nonce: NONCE };
    if (id !== undefined) message.id = id;
    if (payload !== undefined) message.payload = payload;
    parent.postMessage(message, '*');
  }

  function finish(id) {
    var entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    clearTimeout(entry.timer);
    return entry;
  }

  function reportListenerError(error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[localix-plugin-ui] listener failed', error);
    }
  }

  function notify(listeners, value) {
    listeners.forEach(function (listener) {
      try {
        listener(value);
      } catch (error) {
        reportListenerError(error);
      }
    });
  }

  function applyTheme(payload) {
    if (!payload || (payload.theme !== 'light' && payload.theme !== 'dark')) return false;
    var root = document.documentElement;
    var vars = payload.vars;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (name) {
        var value = vars[name];
        if (name.slice(0, 2) === '--' && typeof value === 'string') {
          root.style.setProperty(name, value);
        }
      });
    }
    root.setAttribute('data-theme', payload.theme);
    root.style.colorScheme = payload.theme;
    return true;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var message = event.data;
    if (!message || message.lx !== MARKER || message.v !== VERSION) return;

    if (message.type === 'theme') {
      if (applyTheme(message.payload)) notify(themeListeners, message.payload);
      return;
    }
    if (message.type === 'event') {
      if (message.payload && typeof message.payload.name === 'string') {
        notify(eventListeners, message.payload);
      }
      return;
    }
    if ((message.type === 'result' || message.type === 'error') && typeof message.id === 'string') {
      var entry = finish(message.id);
      if (!entry) return;
      if (message.type === 'result') entry.resolve(message.payload);
      else {
        var detail = message.payload && message.payload.message;
        entry.reject(new Error(typeof detail === 'string' ? detail : 'Localix bridge action failed'));
      }
    }
  });

  function invoke(action, payload, options) {
    if (typeof action !== 'string' || !action.trim()) {
      return Promise.reject(new Error('Localix bridge action must be a non-empty string'));
    }
    if (pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('Too many pending Localix bridge requests'));
    }
    var requestedTimeout = options && options.timeoutMs;
    var timeoutMs =
      typeof requestedTimeout === 'number' && Number.isFinite(requestedTimeout)
        ? Math.max(100, Math.min(MAX_TIMEOUT_MS, requestedTimeout))
        : DEFAULT_TIMEOUT_MS;
    var id = prefix + '-' + ++sequence;

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error('Localix bridge request timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        post('invoke', { action: action.trim(), payload: payload }, id);
      } catch (error) {
        finish(id);
        reject(error);
      }
    });
  }

  function subscribe(listeners, listener) {
    if (typeof listener !== 'function') throw new TypeError('Bridge listener must be a function');
    listeners.add(listener);
    return function () {
      listeners.delete(listener);
    };
  }

  var api = Object.freeze({
    version: VERSION,
    ready: function () {
      if (ready) return;
      ready = true;
      post('ready');
    },
    invoke: invoke,
    callBackend: function (action, payload, options) {
      return invoke('callBackend', { action: action, payload: payload }, options);
    },
    getState: function () {
      return invoke('getViewState');
    },
    setState: function (value) {
      return invoke('setViewState', value).then(function () {
        return value;
      });
    },
    getTheme: function () {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    onTheme: function (listener) {
      return subscribe(themeListeners, listener);
    },
    onEvent: function (listener) {
      return subscribe(eventListeners, listener);
    }
  });

  Object.defineProperty(window, 'acquireLocalixApi', {
    configurable: false,
    enumerable: false,
    value: function () {
      if (acquired) throw new Error('The Localix plugin UI API has already been acquired');
      acquired = true;
      return api;
    }
  });
})();
`.trim()

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/

/** The bootstrap for ONE srcdoc document, stamped with that document's bridge nonce. */
export function pluginUiApiBootstrap(nonce: string): string {
  if (!NONCE_RE.test(nonce)) throw new Error('Invalid plugin bridge nonce')
  return BOOTSTRAP_SOURCE.replace('__LOCALIX_BRIDGE_NONCE__', nonce)
}
