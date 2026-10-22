/**
 * JavaScript the prelude runs before anything else: it hardens the VM's built-ins, so a script
 * cannot patch one the prelude shares with it. Without it a script could replace, say,
 * `Array.prototype.join` and hand the prelude's output helpers a value that lies about its length.
 *
 * Starting from the global object, every object reachable through a property, an accessor or a
 * prototype is frozen. A few intrinsics are reachable only from an instance (the generator and
 * async function prototypes, %TypedArray%, the iterator prototypes), so the walk is seeded with
 * those too. The global object itself stays extensible for the prelude's own globals, but its
 * built-in bindings become read-only.
 *
 * Freezing a prototype has a cost known as the "override mistake": a read-only data property on a
 * prototype also forbids assigning that name on an instance, so `this.name = "MyError"` in an Error
 * subclass would throw. The names ordinary code commonly assigns (and every property of
 * `Object.prototype`) become accessor pairs instead: reading returns the built-in value, and
 * assigning on an instance gives that instance its own property.
 */
export const LOCKDOWN_SOURCE = `(function hardenIntrinsics() {
  "use strict";
  const SHADOWABLE = ["constructor", "name", "message", "toString", "toLocaleString", "valueOf", "toJSON"];
  const visited = new WeakSet([globalThis]);
  const worklist = [];

  function visit(candidate) {
    if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) return;
    if (visited.has(candidate)) return;
    visited.add(candidate);
    worklist.push(candidate);
  }

  function visitDescriptor(descriptor) {
    if ("value" in descriptor) {
      visit(descriptor.value);
    } else {
      visit(descriptor.get);
      visit(descriptor.set);
    }
  }

  // Method shorthand, not function expressions: a method has no prototype object of its own, which
  // the walk would otherwise reach and convert again.
  function makeShadowable(holder, key, descriptor) {
    const builtin = descriptor.value;
    const pair = {
      get() {
        return builtin;
      },
      set(next) {
        if (this === holder) {
          throw new TypeError("Cannot assign to read only property '" + String(key) + "' of a built-in");
        }
        if (this === null || (typeof this !== "object" && typeof this !== "function")) return;
        Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
      },
    };
    Object.defineProperty(holder, key, {
      get: pair.get,
      set: pair.set,
      enumerable: descriptor.enumerable,
      configurable: false,
    });
    visit(pair.get);
    visit(pair.set);
  }

  for (const key of Reflect.ownKeys(globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    visitDescriptor(descriptor);
    if ("value" in descriptor && descriptor.configurable) {
      Object.defineProperty(globalThis, key, { writable: false, configurable: false });
    }
  }

  const instanceOnly = [
    function* () {},
    async function () {},
    async function* () {},
    Int8Array,
    [][Symbol.iterator](),
    new Map().entries(),
    new Set().values(),
    ""[Symbol.iterator](),
    "".matchAll(/a/g),
  ];
  if (typeof Iterator === "function") {
    if (typeof Iterator.prototype.map === "function") instanceOnly.push([].values().map((item) => item));
    if (typeof Iterator.from === "function") instanceOnly.push(Iterator.from({ next() {} }));
  }
  for (const instance of instanceOnly) visit(Object.getPrototypeOf(instance));

  for (let index = 0; index < worklist.length; index++) {
    const target = worklist[index];
    visit(Object.getPrototypeOf(target));
    const own = Object.getOwnPropertyDescriptors(target);
    for (const key of Reflect.ownKeys(own)) {
      const descriptor = own[key];
      visitDescriptor(descriptor);
      const shadowable =
        "value" in descriptor &&
        descriptor.writable &&
        descriptor.configurable &&
        (target === Object.prototype || SHADOWABLE.includes(key));
      if (shadowable) makeShadowable(target, key, descriptor);
    }
    Object.freeze(target);
  }
})();`
