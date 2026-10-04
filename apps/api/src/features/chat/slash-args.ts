// Declarative slash-command ARGUMENT specs + a pure parser, owned in one place so
// argument entry is identical on every composer surface (and never duplicated). The
// React hook that drives the web UI wraps `parseCommandArgs`; any other surface calls
// that same function. Pure data + one pure function — no UI deps.

export interface SlashArgOption {
  value: string
  label: string
  description?: string
}

/**
 * Gate an argument on an earlier choice: active only when the chip named `arg` was
 * committed with value `equals` (e.g. `/plugin marketplace` exposes a sub-action
 * that `/plugin install` skips) — branching without per-command logic.
 *
 * `equals` accepts a LIST because the alternative is duplicating one spec per
 * accepting value: five sub-actions of `/plugin` take the same "pick an installed
 * plugin" argument, and five identical specs differing only in this string is how a
 * placeholder ends up right for four of them and stale for the fifth.
 */
export interface ArgCondition {
  arg: string
  equals: string | readonly string[]
}

/** Does a committed chip value satisfy a spec's `when`? */
export function argConditionMet(condition: ArgCondition, value: string | undefined): boolean {
  if (value === undefined) return false
  return Array.isArray(condition.equals)
    ? condition.equals.includes(value)
    : condition.equals === value
}

/**
 * One positional argument:
 *  - `choice`:   a closed option set, rendered as a filterable menu + chip.
 *  - `interval`: a duration token (`5m`·`2h`·`1d`); offers presets but ALSO accepts
 *                any value matching {@link INTERVAL_TOKEN_RE}.
 *  - `token`:    an OPTIONAL single token recognised by its shape (`@handle`), committed as a
 *                chip only when a complete token matches `pattern` and otherwise skipped
 *                without consuming anything. It exists because a closed `choice` after an
 *                optional addressee could not be typed at all: the choice parser kept `@qa` as
 *                its own unmatched partial and ate every space after it, so `/reasoning @qa high`
 *                was unreachable once `/reasoning` stopped being free text.
 *  - `text`:     free text (always last).
 */
export type SlashArgSpec =
  | {
      name: string
      type: 'choice'
      /**
       * OPTIONAL, because a `dynamic` arg has none until they are fetched.
       *
       * It was declared as always present while the wire contract made it optional and the server
       * omitted the key entirely for a plugin arg with an `optionsScript`. Three sources disagreeing
       * meant the composer threw `undefined is not an object` the moment the parser reached such an
       * arg — which any plugin command with a live list does as soon as an earlier text arg is given
       * more than one word. Typed honestly, every reader has to say what it does without them.
       */
      options?: SlashArgOption[]
      placeholder?: string
      when?: ArgCondition
      dynamic?: boolean
    }
  | {
      name: string
      type: 'interval'
      options: SlashArgOption[]
      placeholder?: string
      when?: ArgCondition
    }
  | { name: string; type: 'token'; pattern: RegExp; placeholder?: string; when?: ArgCondition }
  | { name: string; type: 'text'; placeholder?: string; when?: ArgCondition }

/** A complete duration token the `interval` arg accepts as-is: `5m` · `2h` · `1d`. */
export const INTERVAL_TOKEN_RE = /^\d+\s*(m|min|mins|h|hr|hrs|d|day|days)$/i

export interface ParsedArgChip {
  spec: SlashArgSpec
  option: SlashArgOption
}

export interface ParsedCommandArgs {
  /** Completed choice/interval arguments (rendered as chips). */
  chips: ParsedArgChip[]
  /** The argument the cursor is on (null when all are satisfied). */
  activeSpec: SlashArgSpec | null
  /** Index of the active argument. */
  activeIndex: number
  /** Text being edited for the active argument. */
  activeText: string
}

/**
 * Split the text following a command prefix into committed choice chips plus the
 * argument currently being edited. Pure — exported for reuse + testing.
 */
export function parseCommandArgs(text: string, specs: readonly SlashArgSpec[]): ParsedCommandArgs {
  const chips: ParsedArgChip[] = []
  const chipValues = new Map<string, string>()
  let i = 0

  for (let s = 0; s < specs.length; s++) {
    const spec = specs[s]
    if (spec.when && !argConditionMet(spec.when, chipValues.get(spec.when.arg))) continue
    while (text[i] === ' ') i++

    if (spec.type === 'token') {
      // Committed only once the token is COMPLETE (a space follows): a partial `@q` is still
      // being typed and must stay with the argument after it, which is the one that is active.
      const match = /^(\S+)\s/.exec(text.slice(i))
      if (match && spec.pattern.test(match[1]!)) {
        chips.push({ spec, option: { value: match[1]!, label: match[1]! } })
        chipValues.set(spec.name, match[1]!)
        i += match[1]!.length
      }
      continue
    }

    if (spec.type === 'text') {
      // A terminal text arg owns the whole remainder. Plugin command schemas also
      // allow intermediate text args; the server consumes one token for those, so
      // commit the token as a chip and continue to the following APPLICABLE spec.
      // Physical array position is insufficient: /plugin's create request precedes
      // several conditionally disabled args, and treating those as reachable turned
      // the request's first word into a chip.
      const hasApplicableLater = specs
        .slice(s + 1)
        .some((later) => !later.when || argConditionMet(later.when, chipValues.get(later.when.arg)))
      if (!hasApplicableLater) {
        return { chips, activeSpec: spec, activeIndex: s, activeText: text.slice(i) }
      }
      const sub = text.slice(i)
      const spaceIdx = sub.search(/\s/)
      const token = spaceIdx === -1 ? sub : sub.slice(0, spaceIdx)
      if (token && spaceIdx !== -1) {
        const option = { value: token, label: token }
        chips.push({ spec, option })
        chipValues.set(spec.name, option.value)
        i += spaceIdx
        continue
      }
      return { chips, activeSpec: spec, activeIndex: s, activeText: token }
    }

    const sub = text.slice(i)
    const spaceIdx = sub.search(/\s/)
    const token = spaceIdx === -1 ? sub : sub.slice(0, spaceIdx)
    const preset = spec.options?.find((o) => o.value === token.toLowerCase())
    const option =
      preset ??
      (spec.type === 'interval' && INTERVAL_TOKEN_RE.test(token)
        ? { value: token.toLowerCase(), label: token.toLowerCase() }
        : // A DYNAMIC choice is a combobox: its options load on demand (async), so the
          // pure parser can't know them — accept ANY non-empty token verbatim (a sha,
          // branch, id …), preserving case. The menu is a convenience, not a gate.
          spec.type === 'choice' && spec.dynamic && token
          ? { value: token, label: token }
          : undefined)

    if (option && spaceIdx !== -1) {
      chips.push({ spec, option })
      chipValues.set(spec.name, option.value)
      i += spaceIdx
      continue
    }
    return { chips, activeSpec: spec, activeIndex: s, activeText: token }
  }

  return { chips, activeSpec: null, activeIndex: specs.length, activeText: '' }
}

/** Options for the active menu arg, filtered by the partial text. */
export function filterArgOptions(
  spec: Extract<SlashArgSpec, { type: 'choice' | 'interval' }>,
  query: string,
): SlashArgOption[] {
  // A dynamic arg has no static options: its menu is filled by the fetch, and filtering the empty
  // list here is what it means to have nothing to offer YET — not a reason to throw.
  const options = spec.options ?? []
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((o) => o.value.includes(q) || o.label.toLowerCase().includes(q))
}
