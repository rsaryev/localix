/**
 * `$ref` resolution — local JSON pointers only (`#/components/schemas/User`).
 *
 * Hand-rolled on purpose. A general-purpose parser that validates and dereferences the whole
 * document is a megabyte of dependency to answer a question our model asks in twenty lines, and it
 * drags a validator we do not want (an imperfect spec should still import — see the importer).
 *
 * Two things their hand-rolled swagger-2 version gets wrong and this does not:
 *
 *   1. JSON-pointer ESCAPES. `~1` is a literal `/` and `~0` a literal `~`, so a path key
 *      containing a slash — `#/paths/~1users~1{id}` — is one segment, not three. Their
 *      `$ref.split('/')` shatters it and resolves to undefined.
 *   2. CYCLES. A self-referencing schema (`User.friends: User[]`) is normal, and a resolver with
 *      no guard follows it forever. Resolution here is one hop and returns the node as-is, so a
 *      cycle only becomes infinite if a CALLER keeps following — which is why `example.ts` carries
 *      its own depth cap rather than trusting this to bottom out.
 *
 * An EXTERNAL ref (`./other.yaml#/X`, `https://…`) resolves to null rather than being fetched: an
 * importer that reaches the network to read a pasted document is a surprise, and a spec that needs
 * it should be bundled first.
 */

/** Undo JSON-pointer escaping. `~1` → `/` and `~0` → `~`, in that order (RFC 6901). */
export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** True when `$ref` points inside THIS document. */
export function isLocalRef(ref: string): boolean {
  return ref.startsWith('#/')
}

/**
 * Follow a local `#/a/b` pointer through `document`, or null when it does not land on anything.
 *
 * Deliberately NOT recursive: it does not resolve a ref that points at another ref. `resolveRef`
 * below does that, with a guard.
 */
export function pointerGet(document: unknown, ref: string): unknown {
  if (!isLocalRef(ref)) return null
  const segments = ref
    .slice(2)
    .split('/')
    .filter((s) => s !== '')
    .map(unescapePointerSegment)

  let node: unknown = document
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[segment]
    if (node === undefined) return null
  }
  return node ?? null
}

/** How many `$ref → $ref` hops to follow before calling it a loop. */
const MAX_HOPS = 10

/**
 * Resolve `node` to the thing it references, following a chain of refs, or return it unchanged
 * when it is not a ref.
 *
 * A ref chain that loops (`A.$ref → B.$ref → A`) is broken by the hop cap and resolves to null:
 * the caller then treats it as an unknown schema, which is exactly what an unresolvable ref is.
 */
export function resolveRef<T extends { $ref?: string }>(
  document: unknown,
  node: T | undefined,
): T | null {
  let current: unknown = node
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (current === null || current === undefined || typeof current !== 'object') return null
    const ref = (current as { $ref?: unknown }).$ref
    if (typeof ref !== 'string') return current as T
    current = pointerGet(document, ref)
  }
  return null
}
