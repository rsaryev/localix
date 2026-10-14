import { readCommandToken, type CommandTextToken } from './slash-command-tokens'
import {
  argConditionMet,
  type ParsedArgChip,
  type ParsedCommandArgs,
  type SlashArgSpec,
  type SlashFlagSpec,
} from './slash-args'

/** An unquoted `--word` ends a free-text flag value; the server applies the same boundary. */
export const isFlagToken = (value: string) => value.startsWith('--')

const valueLabel = (value: string) => (value.length > 48 ? `${value.slice(0, 45)}…` : value)

/**
 * Flag order is free; each flag and its value get their own lossless crumb.
 *
 * Parsing never stalls: a free-text value runs over every word up to the next `--` token, and a
 * complete token that names no flag becomes its own crumb for the server's diagnostic.
 */
export function parseFlagArgs(
  text: string,
  from: number,
  spec: Extract<SlashArgSpec, { type: 'flags' }>,
  activeIndex: number,
  chips: ParsedArgChip[],
  committed: ReadonlyMap<string, string>,
): ParsedCommandArgs {
  const flags = spec.flags.filter(
    (flag) => !flag.when || argConditionMet(flag.when, committed.get(flag.when.arg)),
  )
  const seen = new Set<string>()
  const result = (activeSpec: SlashArgSpec, activeText: string): ParsedCommandArgs => ({
    chips,
    activeSpec,
    activeIndex,
    activeText,
  })
  const flagMenu = (): SlashArgSpec => {
    const remaining = flags.filter((flag) => !seen.has(flag.name))
    return {
      name: spec.name,
      type: 'choice',
      optional: true,
      placeholder: flagMenuPlaceholder(remaining, spec.placeholder),
      options: remaining.map((flag) => ({
        value: flag.flag,
        label: flag.flag,
        description: flag.description,
      })),
    }
  }
  let offset = from
  const lead =
    spec.lead &&
    (!spec.lead.when || argConditionMet(spec.lead.when, committed.get(spec.lead.when.arg)))
      ? spec.lead
      : null
  if (lead) {
    if (!readCommandToken(text, offset)) {
      return result({ ...flagMenu(), placeholder: lead.placeholder }, '')
    }
    const leadText = readTextValue(text, offset, lead.name, {
      type: 'text',
      placeholder: lead.placeholder,
    })
    // A leading flag means no free text; anything else is the lead, editable until a `--` follows.
    if (leadText.end === undefined && !isFlagToken(leadText.activeText)) {
      return result(leadText.spec, leadText.activeText)
    }
    if (leadText.end !== undefined) {
      chips.push({ spec: leadText.spec, option: leadText.option! })
      offset = leadText.end
    }
  }
  while (true) {
    const token = readCommandToken(text, offset)
    if (!token || !token.complete) return result(flagMenu(), token ? text.slice(token.start) : '')
    offset = token.end
    const flag = flags.find((candidate) => candidate.flag === token.value)
    if (!flag) {
      const option = { value: token.raw, label: token.raw, description: 'Not an option here' }
      chips.push({ spec: { name: 'unknown', type: 'text' }, option })
      continue
    }
    seen.add(flag.name)
    chips.push({
      spec: { name: `flag:${flag.name}`, type: 'text' },
      option: { value: token.raw, label: flag.flag, description: flag.description },
    })
    if (!flag.value) continue
    const value = readTextValue(text, offset, flag.name, flag.value)
    if (value.end === undefined) return result(value.spec, value.activeText)
    chips.push({ spec: value.spec, option: value.option! })
    offset = value.end
  }
}

/**
 * The placeholder names what is still optional, so a finished command never claims more choices:
 * the catalog's generic hint while several flags remain, the flags themselves when a few do.
 */
function flagMenuPlaceholder(remaining: SlashFlagSpec[], generic?: string) {
  if (remaining.length === 0) return 'Enter to run…'
  if (remaining.length > 2) return generic
  return `Optional ${remaining.map((flag) => flag.flag).join(' or ')} — Tab to add, Enter to run…`
}

/**
 * A choice value is one token. A text value is every word until the next `--` token, so unquoted
 * prose submits as typed; quotes are needed only for newlines or a literal `--`.
 *
 * The text value stays the editable field while it is typed, spaces included, and becomes a crumb
 * only once a `--` follows it. Committing each word at its space emptied the field, re-opened the
 * flag menu mid-sentence and let Enter or Tab act on that menu instead of the prose. Flags are
 * offered when `--` is typed, the boundary Mattermost's slash autocomplete uses as well.
 */
function readTextValue(
  text: string,
  from: number,
  name: string,
  value: NonNullable<SlashFlagSpec['value']>,
) {
  const spec: SlashArgSpec =
    value.type === 'choice'
      ? { name, type: 'choice', options: value.options, placeholder: value.placeholder }
      : { name, type: 'text', placeholder: value.placeholder }
  const editing = (token: CommandTextToken | null) => ({
    spec,
    end: undefined,
    activeText: token ? text.slice(token.start) : '',
  })
  const first = readCommandToken(text, from)
  // A flag in value position is not this one's value; leave it editable for the server's diagnostic.
  if (!first || !first.complete || isFlagToken(first.raw)) return editing(first)
  if (value.type === 'choice') {
    const option = { value: first.raw, label: valueLabel(first.value), description: first.value }
    return { spec, option, end: first.end, activeText: '' }
  }
  const words = [first]
  for (
    let token = readCommandToken(text, first.end);
    token;
    token = readCommandToken(text, token.end)
  ) {
    if (isFlagToken(token.raw)) {
      const display = words.map((word) => word.value).join(' ')
      const raw = text.slice(first.start, words.at(-1)!.end)
      const option = { value: raw, label: valueLabel(display), description: display }
      return { spec, option, end: words.at(-1)!.end, activeText: '' }
    }
    words.push(token)
  }
  return editing(first)
}
