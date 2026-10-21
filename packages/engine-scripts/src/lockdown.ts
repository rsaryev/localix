/**
 * JavaScript the prelude runs before anything else: it freezes every built-in, so a script cannot
 * patch one the prelude shares with it. Without it a script could replace, say,
 * `Array.prototype.join` and hand the prelude's output helpers a value that lies about its length.
 *
 * pi's codemode lockdown (`packages/codemode/src/runtime/prelude-source.ts`, MIT): every object
 * reachable from the built-in globals is frozen, plus the intrinsics only reachable from instances
 * (iterator and generator prototypes, %TypedArray%), and the built-in globals become read-only.
 *
 * Freezing alone breaks ordinary code through the "override mistake": a data property that is
 * read-only on a prototype cannot be assigned on an instance either, so `this.name = "MyError"` in
 * an Error subclass would throw. Commonly overridden properties become accessors whose setter
 * defines an own property on the instance instead.
 */
export const LOCKDOWN_SOURCE = `(function lockdown() {
  const OVERRIDABLE = new Set(["constructor", "name", "message", "toString", "toLocaleString", "valueOf", "toJSON"]);
  const seen = new Set([globalThis]);
  const queue = [];
  const add = (value) => {
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      if (!seen.has(value)) {
        seen.add(value);
        queue.push(value);
      }
    }
  };

  // Accessors from an object literal have no own prototype object, unlike function expressions,
  // whose prototype.constructor would be converted again without end.
  function allowOverride(object, key, value, enumerable) {
    const { get, set } = Object.getOwnPropertyDescriptor(
      {
        get accessor() {
          return value;
        },
        set accessor(next) {
          if (this === object) {
            throw new TypeError("Cannot assign to read only property '" + String(key) + "' of a built-in");
          }
          if ((typeof this !== "object" || this === null) && typeof this !== "function") return;
          Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
        },
      },
      "accessor",
    );
    Object.defineProperty(object, key, { get, set, enumerable, configurable: false });
    add(get);
    add(set);
  }

  for (const key of Reflect.ownKeys(globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    add(descriptor.value);
    add(descriptor.get);
    add(descriptor.set);
    if ("value" in descriptor && descriptor.configurable) {
      Object.defineProperty(globalThis, key, { writable: false, configurable: false });
    }
  }
  add(Object.getPrototypeOf(function* () {}));
  add(Object.getPrototypeOf(async function () {}));
  add(Object.getPrototypeOf(async function* () {}));
  add(Object.getPrototypeOf(Int8Array));
  add(Object.getPrototypeOf([][Symbol.iterator]()));
  add(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
  add(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
  add(Object.getPrototypeOf(""[Symbol.iterator]()));
  add(Object.getPrototypeOf(/a/[Symbol.matchAll]("")));
  if (typeof Iterator === "function") {
    if (typeof Iterator.prototype.map === "function") add(Object.getPrototypeOf([].values().map((x) => x)));
    if (typeof Iterator.from === "function") add(Object.getPrototypeOf(Iterator.from({ next() {} })));
  }

  while (queue.length > 0) {
    const object = queue.pop();
    add(Object.getPrototypeOf(object));
    const descriptors = Object.getOwnPropertyDescriptors(object);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key];
      if ("value" in descriptor) {
        add(descriptor.value);
        if (
          descriptor.writable &&
          descriptor.configurable &&
          (object === Object.prototype || OVERRIDABLE.has(key))
        ) {
          allowOverride(object, key, descriptor.value, descriptor.enumerable);
        }
      } else {
        add(descriptor.get);
        add(descriptor.set);
      }
    }
    Object.freeze(object);
  }
})();`
