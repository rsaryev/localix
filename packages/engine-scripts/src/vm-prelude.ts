/**
 * JavaScript a long-lived VM (`worker-vm.ts`) evaluates before its runtime: what the VM may not do,
 * and what its extensions leave out.
 */

/**
 * What a long-lived VM runs before anything else: no code is made at run time. `eval` is gone, and
 * the constructor of every kind of function refuses, while `instanceof Function` still holds. The
 * VM's host evaluates the code it is handed (`host.evaluate`); the code itself cannot.
 */
export const NO_CODE_GENERATION_SOURCE = `(function refuseCodeGeneration() {
  "use strict";
  const refuse = function () {
    throw new EvalError("no code is made at run time here");
  };
  delete globalThis.eval;
  for (const kind of [function () {}, async function () {}, function* () {}, async function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(kind), "constructor", { value: refuse, writable: false, configurable: false });
  }
  const SafeFunction = function Function() {
    refuse();
  };
  Object.defineProperty(SafeFunction, "prototype", { value: Object.getPrototypeOf(refuse) });
  Object.defineProperty(globalThis, "Function", { value: SafeFunction, writable: true, configurable: true });
})();`

/**
 * `URL#searchParams`, which the URL extension lacks: a `URLSearchParams` of the URL's query that
 * writes a change back to the URL, and is read afresh once the URL's query changed.
 */
export const URL_SEARCH_PARAMS_SOURCE = `(function addSearchParams() {
  "use strict";
  if (typeof URL !== "function" || "searchParams" in URL.prototype) return;
  const known = new WeakMap();
  const MUTATORS = ["append", "delete", "set", "sort"];
  Object.defineProperty(URL.prototype, "searchParams", {
    configurable: true,
    enumerable: true,
    get() {
      const url = this;
      let entry = known.get(url);
      if (entry !== undefined && entry.search === url.search) return entry.params;
      const params = new URLSearchParams(url.search);
      entry = { search: url.search, params };
      for (const name of MUTATORS) {
        const method = params[name];
        Object.defineProperty(params, name, {
          value(...args) {
            const result = method.apply(params, args);
            url.search = params.toString();
            entry.search = url.search;
            return result;
          },
        });
      }
      known.set(url, entry);
      return params;
    },
  });
})();`
