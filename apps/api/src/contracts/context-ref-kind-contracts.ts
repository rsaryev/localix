/** Pure contracts shared by the context-ref registry, composer and wire schema. */
import type { ContextRef } from '../features/projects/contracts'

/**
 * Max inline content carried by a `snippet` ref (client-minted). ~100 KB.
 * SINGLE SOURCE OF TRUTH — the wire schema (`projects/contracts.ts`
 * `contextRefSchema.content`) enforces it as a backstop, and `makeSnippetRef`
 * (the mint path every drag source uses) CLAMPS to it with a truncation note so
 * an oversized capture degrades instead of failing the whole send. Lives here
 * (not in the zod contracts module) so the pure client-side leaf can clamp without
 * pulling zod into its bundle.
 */
export const SNIPPET_CONTENT_MAX = 100_000

export type ContextRefKind = ContextRef['kind']

export interface RefKindSpec {
  kind: ContextRefKind
  /**
   * STRUCTURED-ONLY kinds (e.g. `snippet`) are never parsed from prompt text: they
   * are drag/attach-added and carry their own inline data on the ref. They are
   * excluded from the parse regex (`REF_RE`), the reserved-word list, the
   * atomic-token test, and the `@`-type menu — so they have NO token grammar and
   * NO menu entry (the grammar/menu fields below are omitted for them). Use
   * `PARSEABLE_REF_KINDS` wherever you need the typed-from-text kinds.
   */
  structuredOnly?: boolean
  /**
   * Regex source matching the whole token AFTER the `@` (no capture groups!).
   * The shared REF_RE is the alternation of these, in registry order.
   * Omitted for `structuredOnly` kinds (no token grammar).
   */
  tokenPattern?: string
  /**
   * Reserved keyword the composer must NOT treat as a link-only `@path` mention
   * (`file:`, `folder:`, …). Prefix-matched while the user is still typing it.
   * Omitted for `structuredOnly` kinds.
   */
  reservedWord?: string
  /**
   * Trimmed-token test (`file:src/a.ts`, `session:abc`) for the composer's atomic-token
   * treatment (inline pill highlight + whole-token Backspace). Deliberately laxer
   * than `tokenPattern` for kinds whose value is still being typed. Omitted for
   * `structuredOnly` kinds.
   */
  uiTokenRe?: RegExp
  /**
   * Whether expansion resolves against the filesystem working dir. Workdir-free
   * kinds (session/terminal/call/resource/snippet) resolve via injected
   * loaders or their own inline content instead, so a batch of only those needs no
   * project/session scope.
   */
  needsWorkingDir: boolean
  /**
   * HOW the composer completes this kind's value once its keyword is typed —
   * the seam every `@`-menu (today: the web's AtRefMenu) routes on, so a new kind picks
   * its completion surface here instead of patching a regex per surface:
   *   'path'     → directory/file completion against the working dir (`@file:`);
   *   'list'     → pick-from-a-list (sessions, terminals, tool calls…);
   *   'resource' → the provider-tree drill-down (`@resource:localix://resource/<provider>/…`).
   * Omitted = the value is typed by hand or the token is complete on insert — no
   * completion menu after the keyword.
   */
  picker?: 'path' | 'list' | 'resource'
  /** Parses the matched token text (after `@`) into a normalized ref, or null.
   *  Omitted for `structuredOnly` kinds (never parsed from text). */
  parse?(token: string): ContextRef | null
  /**
   * Renders this kind's `@`-token from its value — the INVERSE of `parse`, and the
   * reason `refToken` can exist at all.
   *
   * Omit it: the default grammar is `@<kind>:<value>`, which every colon-shaped kind
   * follows (including the structured-only ones — `@message:<sid>/<mid>` is just that
   * rule with a composite value). Declare it ONLY where the grammar genuinely differs,
   * so the exception lives with the kind that has it rather than as a special case in
   * the formatter).
   */
  token?(value: string): string
  /** Short human label for a chip / menu row. */
  label(ref: ContextRef): string
  /** Composer `@`-type-menu entry (the web's AtRefMenu). Omitted for
   *  `structuredOnly` kinds (drag-only, not typeable). */
  menu?: { label: string; insert: string; description: string }
}

/**
 * A ref kind with a full token grammar + menu entry — i.e. a NON-structured-only
 * kind, typeable in the composer. `PARSEABLE_REF_KINDS` narrows to these so the
 * parse/menu layers get non-optional grammar fields (no `!` assertions).
 */
export interface ParseableRefKindSpec extends RefKindSpec {
  tokenPattern: string
  reservedWord: string
  uiTokenRe: RegExp
  parse(token: string): ContextRef | null
  menu: { label: string; insert: string; description: string }
}
