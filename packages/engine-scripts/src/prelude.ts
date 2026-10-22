/**
 * JavaScript evaluated inside the VM before the script: the script's whole world.
 *
 * It first hardens every built-in (`lockdown.ts`), so the helpers below and the script share
 * intrinsics the script cannot patch. It keeps the host bridge in a closure the script cannot
 * reach and builds on it `tools`, `text`, `image`, `console` and `exit`. Nothing else exists in the
 * VM — no timers, network, modules or file system — so a script can only compute and call its
 * tools. The checks here are for the script's sake (it learns of a limit where it prints); the host
 * enforces every limit again on what it receives and never trusts a length computed in the VM.
 *
 * Evaluates to `(bridge, toolsJson) => { run, settle, stalled }`, where the bridge takes
 * `("call", id, name, argsJson)`, `("output", "text" | "image", data, mimeType)` and
 * `("done", ok, valueJsonOrErrorJson)`.
 */
import { MAX_OUTPUT_CHARS, MAX_OUTPUT_ITEMS } from './limits'
import { LOCKDOWN_SOURCE } from './lockdown'

const IMAGE_FORMS =
  'image() expects a base64 data: URL, an { image_url } object, or an image block { type: "image", data, mimeType }'

const OUTPUT_LIMIT = `The script's output passed ${MAX_OUTPUT_CHARS} characters or ${MAX_OUTPUT_ITEMS} items. Output a summary instead.`

export const PRELUDE_SOURCE = `(function (bridge, toolsJson) {
  "use strict";
  ${LOCKDOWN_SOURCE}

  // Captured once, after hardening: the script can no longer swap any of them.
  const toJson = JSON.stringify;
  const fromJson = JSON.parse;
  const chain = Promise.prototype.then;
  const BaseError = Error;
  const ArgumentError = TypeError;

  // ---- completion: the first report wins ----
  let settled = false;
  // Thrown by exit() to unwind a script that has already reported success.
  const EXIT_SIGNAL = Object.freeze({ exit: true });
  function report(ok, payload) {
    if (settled) return;
    settled = true;
    bridge("done", ok, payload);
  }

  // ---- errors, as V8 prints them: "Name: message", then the script's own frames ----
  function stackOf(error) {
    const lines = [error.message ? error.name + ": " + error.message : String(error.name)];
    if (typeof error.stack === "string") {
      for (const frame of error.stack.split("\\n")) {
        if (frame.trim() !== "" && !frame.includes("prelude.js")) lines.push(frame);
      }
    }
    return lines.join("\\n");
  }
  function show(value) {
    if (typeof value === "string") return value;
    if (value instanceof BaseError) return stackOf(value);
    try {
      const json = toJson(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  }
  function errorJson(error) {
    try {
      if (error instanceof BaseError) {
        return toJson({ name: String(error.name), message: String(error.message), stack: stackOf(error) });
      }
      return toJson({ message: String(show(error)) });
    } catch {
      return toJson({ message: "The script threw a value that cannot be described" });
    }
  }

  // ---- tool calls: numbered, answered by settle() ----
  const waiting = new Map();
  let lastCallId = 0;
  function callerFor(name) {
    return function call(args) {
      return new Promise((resolve, reject) => {
        let argsJson;
        try {
          argsJson = args === undefined ? undefined : toJson(args);
        } catch (error) {
          reject(error);
          return;
        }
        lastCallId += 1;
        waiting.set(lastCallId, { resolve, reject });
        bridge("call", lastCallId, name, argsJson);
      });
    };
  }

  const registry = Object.create(null);
  const identifiers = [];
  for (const entry of fromJson(toolsJson)) {
    const call = callerFor(entry.name);
    if (!(entry.jsName in registry)) {
      registry[entry.jsName] = call;
      identifiers.push(entry.jsName);
    }
    if (!(entry.name in registry)) registry[entry.name] = call;
  }
  Object.freeze(registry);

  // A tool that does not exist fails where it is named, with the near matches, rather than as a
  // later "not a function".
  const squash = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  function unknownTool(property) {
    const wanted = squash(property);
    const near = wanted === ""
      ? []
      : identifiers.filter((id) => squash(id).includes(wanted) || wanted.includes(squash(id)));
    const hint = near.length > 0
      ? "Did you mean " + near.map((id) => "tools." + id).join(", ") + "?"
      : "Available: " + identifiers.join(", ") + ".";
    return new ArgumentError("tools." + property + " does not exist. " + hint);
  }
  const tools = new Proxy(registry, {
    get(target, property, receiver) {
      const passthrough = typeof property !== "string" || property in target || property === "then" || property === "toJSON";
      if (passthrough) return Reflect.get(target, property, receiver);
      throw unknownTool(property);
    },
  });

  // ---- output: counted here for the script's sake, and again on the host ----
  const spent = { chars: 0, items: 0 };
  function emit(kind, data, mimeType) {
    if (settled) return;
    spent.chars += data.length;
    spent.items += 1;
    if (spent.chars > ${MAX_OUTPUT_CHARS} || spent.items > ${MAX_OUTPUT_ITEMS}) {
      // Reported before it is thrown: a script that catches it does not get its output back.
      const error = new RangeError(${JSON.stringify(OUTPUT_LIMIT)});
      report(false, errorJson(error));
      throw error;
    }
    bridge("output", kind, data, mimeType);
  }

  function text(value) {
    const primitive = value === undefined || value === null || (typeof value !== "object" && typeof value !== "function");
    if (primitive) {
      emit("text", String(value));
      return;
    }
    let rendered;
    try {
      rendered = toJson(value);
    } catch (error) {
      throw new ArgumentError(error instanceof BaseError ? error.message : String(error));
    }
    emit("text", rendered === undefined ? String(value) : rendered);
  }

  // ---- images: base64 only, typed by their leading bytes ----
  function dataUrlOf(value) {
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object") {
      if (typeof value.image_url === "string") return value.image_url;
      if (value.type === "image" && typeof value.data === "string" && value.data !== "") {
        return /^data:/i.test(value.data) ? value.data : "data:;base64," + value.data;
      }
    }
    throw new ArgumentError(${JSON.stringify(IMAGE_FORMS)});
  }

  // Providers reject a whole request over one bad image, so the bytes decide the type, not what
  // the script claims. Each pattern is the base64 of a format's magic number.
  const MAGIC = [
    { type: "image/png", base64: /^iVBORw0KGg/ },
    { type: "image/jpeg", base64: /^[/]9j[/](?!9)/ },
    { type: "image/gif", base64: /^R0lGOD[dl]h/ },
    { type: "image/webp", base64: /^UklG.{8}RUJQ/ },
  ];

  function image(value) {
    const url = dataUrlOf(value);
    const comma = url.indexOf(",");
    const header = comma === -1 ? "" : url.slice(0, comma);
    if (!/^data:/i.test(header) || !/;base64$/i.test(header)) {
      throw new ArgumentError("image() takes base64 image data, not a remote URL. " + ${JSON.stringify(IMAGE_FORMS)});
    }
    const data = url.slice(comma + 1).replace(/\\s+/g, "");
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new ArgumentError("image() data is not valid base64 (truncated?)");
    }
    const head = data.slice(0, 16);
    const format = MAGIC.find((entry) => entry.base64.test(head));
    if (!format) throw new ArgumentError("image() data is not a PNG, JPEG, GIF or WebP image");
    emit("image", data, format.type);
  }

  function exit() {
    report(true, undefined);
    throw EXIT_SIGNAL;
  }

  const print = (...args) => emit("text", args.map(show).join(" "));
  const console = Object.freeze({ log: print, info: print, warn: print, error: print, debug: print });

  const globals = { tools, console, text, image, exit };
  for (const name of Object.keys(globals)) {
    Object.defineProperty(globalThis, name, { value: globals[name], enumerable: true });
  }

  function finish(value) {
    let json;
    try {
      json = value === undefined ? undefined : toJson(value);
    } catch (error) {
      report(false, errorJson(error));
      return;
    }
    report(true, json);
  }

  return {
    run(script) {
      let pending;
      try {
        pending = script(tools, console);
      } catch (error) {
        report(false, errorJson(error));
        return;
      }
      chain.call(pending, finish, (error) => {
        if (error !== EXIT_SIGNAL) report(false, errorJson(error));
      });
    },
    settle(id, ok, payload) {
      const entry = waiting.get(id);
      if (entry === undefined) return;
      waiting.delete(id);
      if (!ok) {
        entry.reject(new BaseError(payload));
        return;
      }
      let value;
      try {
        value = payload === undefined ? undefined : fromJson(payload);
      } catch (error) {
        entry.reject(error);
        return;
      }
      entry.resolve(value);
    },
    // With no call pending and nothing in the VM that could wake it, the script can never finish.
    stalled() {
      if (settled || waiting.size > 0) return;
      report(false, toJson({
        name: "Error",
        message: "The script waits on a promise that can never settle: no tool call is pending, and there are no timers.",
      }));
    },
  };
})`
