import { InvalidRequestError } from '../../../lib/domain-errors'
import { tokenizeCommandText } from '../slash-command-tokens'
import { isFlagToken } from '../slash-flag-args'

export interface AgentsCommandInput {
  action: string
  args: string[]
  fields: Partial<Record<'handle' | 'description' | 'instructions', string>> & {
    leadershipPriority?: number
  }
  confirm: boolean
}

/** Quoted values retain Markdown and newlines; no shell evaluation or environment expansion. */
function words(raw: string): string[] {
  const tokens = tokenizeCommandText(raw)
  if (tokens.some((token) => !token.closed))
    throw new InvalidRequestError('agents_command_invalid', 'Close the quoted argument')
  return tokens.map((token) => token.value)
}

/** Whether each token is an option; a quoted `"--literal"` is text, as in the composer. */
const flagPositions = (raw: string) =>
  tokenizeCommandText(raw)
    .slice(2)
    .map((token) => isFlagToken(token.raw))

export function parseAgentsCommand(prompt: string): AgentsCommandInput {
  const [, action = '', ...tokens] = words(prompt)
  const isFlag = flagPositions(prompt)
  const result: AgentsCommandInput = {
    action: action.toLowerCase(),
    args: [],
    fields: {},
    confirm: false,
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '--confirm') {
      if (result.confirm)
        throw new InvalidRequestError('agents_command_invalid', 'Duplicate --confirm')
      result.confirm = true
    } else if (isFlag[i]) {
      const field = token.slice(2)
      if (
        field !== 'handle' &&
        field !== 'description' &&
        field !== 'instructions' &&
        field !== 'priority'
      ) {
        throw new InvalidRequestError('agents_command_invalid', `Unknown option ${token}`)
      }
      const value = tokens[++i]
      const key = field === 'priority' ? 'leadershipPriority' : field
      if (value === undefined || isFlag[i] || result.fields[key] !== undefined) {
        throw new InvalidRequestError('agents_command_invalid', `Supply one value for ${token}`)
      }
      if (field === 'priority') {
        if (!/^-?[0-2]$/.test(value))
          throw new InvalidRequestError(
            'agents_command_invalid',
            'Priority must be a whole number from −2 to 2',
          )
        result.fields.leadershipPriority = Number(value)
      } else {
        // Free text runs to the next flag, matching the composer's value crumb.
        const words = [value]
        while (i + 1 < tokens.length && !isFlag[i + 1]) words.push(tokens[++i]!)
        result.fields[field] = words.join(' ')
      }
    } else result.args.push(token.replace(/^@/, ''))
  }
  return result
}
