/**
 * JavaScript evaluated inside the VM before the script: the script's whole world.
 *
 * It first freezes every built-in (`lockdown.ts`), so the helpers below and the script share
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

const IMAGE_EXPECTS =
  'image() expects a base64 data: URL, an { image_url } object, or an image block { type: "image", data, mimeType }'

export const PRELUDE_SOURCE = `(function (bridge, toolsJson) {
  "use strict";
  ${LOCKDOWN_SOURCE}
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const then = Promise.prototype.then;
  const ErrorCtor = Error;
  const TypeErrorCtor = TypeError;
  const pending = new Map();
  let nextId = 1;
  let finished = false;
  // Thrown by exit() to unwind a script that already reported success.
  const EXIT = Object.freeze({});

  function done(ok, payload) {
    if (finished) return;
    finished = true;
    bridge("done", ok, payload);
  }

  // QuickJS stacks list frames only: lead with "Name: message" as V8 does, without the prelude's frames.
  function errorText(error) {
    const head = error.message ? error.name + ": " + error.message : String(error.name);
    const frames = typeof error.stack === "string"
      ? error.stack.split("\\n").filter((line) => line.trim() && !line.includes("prelude.js"))
      : [];
    return [head, ...frames].join("\\n");
  }

  function format(value) {
    if (typeof value === "string") return value;
    if (value instanceof ErrorCtor) return errorText(value);
    try {
      const json = stringify(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  }

  function describeError(error) {
    try {
      if (error instanceof ErrorCtor) {
        return stringify({ name: String(error.name), message: String(error.message), stack: errorText(error) });
      }
      return stringify({ message: String(format(error)) });
    } catch {
      return stringify({ message: "The script threw a value that cannot be described" });
    }
  }

  function caller(name) {
    return (args) => new Promise((resolve, reject) => {
      let json;
      try {
        json = args === undefined ? undefined : stringify(args);
      } catch (error) {
        reject(error);
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      bridge("call", id, name, json);
    });
  }

  const table = Object.create(null);
  const names = [];
  for (const { name, jsName } of parse(toolsJson)) {
    const fn = caller(name);
    if (!(jsName in table)) {
      table[jsName] = fn;
      names.push(jsName);
    }
    if (!(name in table)) table[name] = fn;
  }
  Object.freeze(table);

  // A tool that does not exist fails where it is named, with the close matches, instead of a later
  // "not a function".
  const comparable = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tools = new Proxy(table, {
    get(object, property, receiver) {
      if (typeof property !== "string" || property in object || property === "then" || property === "toJSON") {
        return Reflect.get(object, property, receiver);
      }
      const wanted = comparable(property);
      const close = names.filter((name) => wanted && (comparable(name).includes(wanted) || wanted.includes(comparable(name))));
      throw new TypeErrorCtor(
        "tools." + property + " does not exist. " +
          (close.length > 0 ? "Did you mean " + close.map((name) => "tools." + name).join(", ") + "?" : "Available: " + names.join(", ") + "."),
      );
    },
  });

  let outputChars = 0;
  let outputItems = 0;

  // Past the limits the script fails; catching the error does not resume its output.
  function output(kind, data, mimeType) {
    if (finished) return;
    outputChars += data.length;
    outputItems++;
    if (outputChars > ${MAX_OUTPUT_CHARS} || outputItems > ${MAX_OUTPUT_ITEMS}) {
      const error = new RangeError(
        "The script's output passed ${MAX_OUTPUT_CHARS} characters or ${MAX_OUTPUT_ITEMS} items. Output a summary instead.",
      );
      done(false, describeError(error));
      throw error;
    }
    bridge("output", kind, data, mimeType);
  }

  function text(value) {
    let rendered;
    if (value === undefined || value === null || (typeof value !== "object" && typeof value !== "function")) {
      rendered = String(value);
    } else {
      try {
        const json = stringify(value);
        rendered = json === undefined ? String(value) : json;
      } catch (error) {
        throw new TypeErrorCtor(error instanceof ErrorCtor ? error.message : String(error));
      }
    }
    output("text", rendered);
  }

  function imageUrl(value) {
    if (typeof value === "string") return value;
    if (typeof value !== "object" || value === null) throw new TypeErrorCtor(${JSON.stringify(IMAGE_EXPECTS)});
    if (typeof value.image_url === "string") return value.image_url;
    if (value.type === "image" && typeof value.data === "string" && value.data !== "") {
      return value.data.toLowerCase().startsWith("data:") ? value.data : "data:;base64," + value.data;
    }
    throw new TypeErrorCtor(${JSON.stringify(IMAGE_EXPECTS)});
  }

  // The base64 of each inline format's leading bytes (PNG, JPEG, GIF, WebP): providers reject a
  // whole request over one bad image, so the bytes decide the type, not what the script claims.
  const SIGNATURES = [
    ["image/png", /^iVBORw0KGg/],
    ["image/jpeg", /^[/]9j[/](?!9)/],
    ["image/gif", /^R0lGOD[dl]h/],
    ["image/webp", /^UklG.{8}RUJQ/],
  ];

  function image(value) {
    const url = imageUrl(value);
    const comma = url.indexOf(",");
    if (!/^data:/i.test(url) || comma === -1 || !/;base64$/i.test(url.slice(0, comma))) {
      throw new TypeErrorCtor("image() takes base64 image data, not a remote URL. " + ${JSON.stringify(IMAGE_EXPECTS)});
    }
    const data = url.slice(comma + 1).replace(/\\s+/g, "");
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new TypeErrorCtor("image() data is not valid base64 (truncated?)");
    }
    const signature = SIGNATURES.find(([, pattern]) => pattern.test(data.slice(0, 16)));
    if (!signature) throw new TypeErrorCtor("image() data is not a PNG, JPEG, GIF or WebP image");
    output("image", data, signature[0]);
  }

  function exit() {
    done(true, undefined);
    throw EXIT;
  }

  const console = Object.freeze({
    log: (...args) => output("text", args.map(format).join(" ")),
    info: (...args) => output("text", args.map(format).join(" ")),
    warn: (...args) => output("text", args.map(format).join(" ")),
    error: (...args) => output("text", args.map(format).join(" ")),
    debug: (...args) => output("text", args.map(format).join(" ")),
  });

  for (const [name, value] of [["tools", tools], ["console", console], ["text", text], ["image", image], ["exit", exit]]) {
    Object.defineProperty(globalThis, name, { value, enumerable: true });
  }

  return {
    settle(id, ok, payload) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (!ok) {
        entry.reject(new ErrorCtor(payload));
        return;
      }
      let value;
      try {
        value = payload === undefined ? undefined : parse(payload);
      } catch (error) {
        entry.reject(error);
        return;
      }
      entry.resolve(value);
    },
    run(fn) {
      let promise;
      try {
        promise = fn(tools, console);
      } catch (error) {
        done(false, describeError(error));
        return;
      }
      then.call(
        promise,
        (value) => {
          let json;
          try {
            json = value === undefined ? undefined : stringify(value);
          } catch (error) {
            done(false, describeError(error));
            return;
          }
          done(true, json);
        },
        (error) => {
          if (error !== EXIT) done(false, describeError(error));
        },
      );
    },
    // With no call pending and nothing in the VM that could wake it, the script can never finish.
    stalled() {
      if (finished || pending.size > 0) return;
      done(false, stringify({
        name: "Error",
        message: "The script waits on a promise that can never settle: no tool call is pending, and there are no timers.",
      }));
    },
  };
})`
