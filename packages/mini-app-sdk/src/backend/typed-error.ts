/**
 * TYPED DOMAIN ERRORS — the shared skeleton every workbench subsystem re-hand-rolled.
 *
 * Multiple extension backends declare the same four things,
 * character for character apart from the domain name:
 *
 *   1. a `FRIENDLY: Record<Code, string>` map — one clean sentence per code;
 *   2. an `XError extends Error` carrying `code` + `friendly` + `cause`, whose `message`
 *      defaults to the friendly sentence when the caller supplies no raw text;
 *   3. `toErrorInfo(err)` → the wire payload, with the SAME non-obvious rule:
 *      `detail` is the raw engine text, and is OMITTED when it is merely the friendly
 *      sentence echoed back (i.e. when nothing more specific was ever known);
 *   4. `rawOf(err)` — best-effort text out of an arbitrary thrown value.
 *
 * That is ~40 lines × 4, and it is the part with NO domain content in it. What IS
 * domain-specific — `mapXError`, the pattern-matching that turns one venue's/engine's/
 * CLI's raw noise into a code — deliberately stays with its domain. This factory owns
 * the skeleton and nothing else; it does not try to generalise the classification, which
 * is genuinely different in each subsystem (a prototype-chain walk for ccxt, numeric
 * SQLSTATEs for databases, stderr substrings for the CLIs).
 *
 * WHY IT LIVES HERE. A plugin must not import another plugin, so the owner cannot sit in
 * any one of the four. `features/ext/` is already the host-side home for exactly this
 * shape of primitive (`enable.ts`, `catalog.ts`, `install-tree.ts`, `fs-discovery.ts`).
 *
 * IT ALSO HAS ITS OWN ENTRYPOINT (`@localixai/mini-app-sdk/typed-error`), for the same reason
 * `resource-refs` does: this file has ZERO imports and is pure data plumbing, but the
 * `./backend` barrel it sits behind re-exports `net-safety`, which reaches for `node:dns`.
 * A domain `errors.ts` is exactly the kind of module a UI ends up sharing — the URI/link
 * builders next to it are browser code — and pulling the whole barrel in for one factory
 * detonates the moment the chunk executes in a webview. Import the narrow entrypoint from
 * any module a browser can reach; `./backend` is for code that is Node-only for real.
 *
 * ADOPTION (per subsystem — the FRIENDLY map and mapXError stay put):
 *
 *   const kit = defineTypedError<DockerErrorCode>('DockerError', FRIENDLY)
 *   export const DockerError = kit.DomainError
 *   export type DockerError = InstanceType<typeof DockerError>
 *   export type DockerErrorInfo = TypedErrorInfo<DockerErrorCode>
 *   export const toErrorInfo = kit.toErrorInfo
 *   // mapDockerError keeps working unchanged: `err instanceof DockerError` still holds,
 *   // because DockerError IS a real class.
 */

// Type-only: erased at build, so this module keeps its zero-runtime-imports promise.
import type { Prerequisite } from '../prerequisite'

/** The `{ code, message }` payload surfaced to clients. */
export interface TypedErrorInfo<Code extends string> {
  /** The stable, domain-agnostic classification the UI branches on. */
  code: Code
  /** The friendly, engine-agnostic sentence — safe to render as-is. */
  message: string
  /** The RAW engine/CLI text, for operators. Omitted when it adds nothing. */
  detail?: string
  /**
   * Set when the failure IS an absent or stopped dependency, so the UI offers Install / Start
   * instead of a Retry that cannot help. See `@localixai/mini-app-sdk/prerequisite`.
   */
  prerequisite?: Prerequisite
}

/** The error a `defineTypedError` domain throws. */
export interface TypedDomainError<Code extends string> extends Error {
  readonly code: Code
  readonly friendly: string
  readonly prerequisite?: Prerequisite
}

export interface TypedDomainErrorOptions {
  cause?: unknown
  prerequisite?: Prerequisite
}

/** Constructor of a domain's error class. `message` defaults to the friendly sentence. */
export interface TypedDomainErrorClass<Code extends string> {
  new (code: Code, message?: string, options?: TypedDomainErrorOptions): TypedDomainError<Code>
  readonly prototype: TypedDomainError<Code>
}

export interface TypedErrorKit<Code extends string> {
  /** The domain's error CLASS — a real class, so `err instanceof X` works in its mapper. */
  DomainError: TypedDomainErrorClass<Code>
  /** Wire payload. `detail` is dropped when the raw text is just the friendly sentence. */
  toErrorInfo: (err: TypedDomainError<Code>) => TypedErrorInfo<Code>
  /**
   * Best-effort text out of an arbitrary thrown value.
   *
   * `null`/`undefined` yield `''` (NOT the strings `"null"`/`"undefined"`), so a
   * `rawOf(err) || undefined` at a call site falls back to the friendly sentence
   * instead of showing an operator the word "null".
   */
  rawOf: (err: unknown) => string
}

function rawOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err === null || err === undefined) return ''
  if (typeof err === 'object') {
    try {
      return JSON.stringify(err) ?? ''
    } catch {
      return ''
    }
  }
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return String(err)
  }
  return ''
}

/**
 * Build a domain's typed-error kit from its code→sentence map.
 *
 * `name` is what lands in `err.name` (and therefore in stack traces): pass the class
 * name the domain exports, e.g. `'DockerError'`.
 */
export function defineTypedError<Code extends string>(
  name: string,
  friendly: Record<Code, string>,
): TypedErrorKit<Code> {
  class DomainError extends Error implements TypedDomainError<Code> {
    readonly code: Code
    readonly friendly: string
    readonly prerequisite?: Prerequisite

    constructor(code: Code, message?: string, options?: TypedDomainErrorOptions) {
      super(message ?? friendly[code])
      this.name = name
      this.code = code
      this.friendly = friendly[code]
      if (options?.cause !== undefined) this.cause = options.cause
      if (options?.prerequisite) this.prerequisite = options.prerequisite
    }
  }

  return {
    DomainError: DomainError as TypedDomainErrorClass<Code>,
    toErrorInfo: (err) => {
      return {
        code: err.code,
        message: err.friendly,
        // The raw text is only worth showing when it says something the friendly
        // sentence does not. When they are equal, nothing specific was ever known.
        detail: err.message === err.friendly ? undefined : err.message,
        ...(err.prerequisite ? { prerequisite: err.prerequisite } : {}),
      }
    },
    rawOf,
  }
}
