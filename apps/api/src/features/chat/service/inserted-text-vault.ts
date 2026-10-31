import { escapeRegExp } from '../../../lib/regexp'
/**
 * Text a skill's rendering INSERTS — a command's output, an inlined `@file` — sealed away while
 * the arguments are substituted into the skill's own text, then put back.
 *
 * Claude Code inserts command output "as plain text": it is not re-scanned, so a printed `$1`, a
 * `$ARGUMENTS` in a shown script or an `@path` in a log line reaches the model as written. The
 * expanders hand each inserted piece to `seal`, which returns an opaque token holding no `$`, `@`
 * or `!`; `open` swaps the tokens back once every substitution has run.
 */
export interface InsertedTextVault {
  seal(text: string): string
  open(text: string): string
}

export function createInsertedTextVault(template: string): InsertedTextVault {
  let prefix = '\u0001LOCALIX_INSERTED_'
  while (template.includes(prefix)) prefix += '_'
  const pieces: string[] = []
  const tokenRe = new RegExp(`${escapeRegExp(prefix)}(\\d+)\\u0001`, 'g')
  return {
    seal(text) {
      pieces.push(text)
      return `${prefix}${pieces.length - 1}\u0001`
    },
    open(text) {
      return text.replace(tokenRe, (token, index: string) => pieces[Number(index)] ?? token)
    },
  }
}
