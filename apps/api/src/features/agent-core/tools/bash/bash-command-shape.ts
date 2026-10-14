/**
 * How a shell command line is decomposed before anything judges it.
 *
 * Both permission questions — "is this read-only?" and "does an allow rule cover this?" —
 * were answered against the command as one opaque string, and both were wrong for the same
 * reason: a shell line is not one command. `git status && rm -rf /tmp/x` is two, and `env
 * python -c '...'` is a wrapper around a third thing entirely. Judging the string judges its
 * prefix, which is exactly what an attacker (or a careless model) supplies.
 */

/**
 * Heads that RUN another command. Their verdict is the wrapped command's, never their own.
 *
 * `env` is treated as read-only because printing the environment is a read — but `env python
 * -c "..."` reads nothing, and it measurably passed as a read. A read-only verdict skips the
 * confirm an `ask` rule would otherwise raise, so that made "read-only" a way to execute
 * arbitrary code unprompted.
 * The other wrappers a shell offers (`nice`, `nohup`, `timeout`, `xargs`, `sudo`) are not in
 * the read-only head list and so already fail closed; naming the concept keeps it that way if
 * one of them is ever added for its own sake.
 */
export const WRAPPER_HEADS = new Set(['env'])

/**
 * Skip `env`'s own options, returning the index of the command it would run — or `null` when
 * an option makes that unknowable. `-S` packs a whole command line into one token and `-C`
 * changes directory; both are rejected rather than reasoned about.
 */
export function skipEnvOptions(words: readonly string[], from: number): number | null {
  let idx = from
  while (idx < words.length) {
    const word = words[idx]!
    if (word === '--') return idx + 1
    if (word === '-i' || word === '--ignore-environment' || word === '-0' || word === '--null') {
      idx += 1
      continue
    }
    if (word === '-u') {
      idx += 2
      continue
    }
    if (word.startsWith('--unset=')) {
      idx += 1
      continue
    }
    if (word.startsWith('-')) return null
    return idx
  }
  return idx
}

/**
 * Split one command line into the commands it actually runs, or `null` when substitution
 * makes the real commands unknowable.
 *
 * `null` is a distinct answer from an empty list and callers must treat it as such: for an
 * ALLOW decision it means "cannot be proven", which is a refusal, while for deny/ask the
 * caller keeps matching the raw string so a visible `rm` still matches.
 */
export function splitCompoundCommand(command: string): string[] | null {
  if (/\$\(|`|\$\{?\w/u.test(command)) return null
  const stripped = command.replace(/^(?:\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/u, '')
  const parts = stripped
    .split(/&&|\|\||;|\|&|\||&|\n/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : [stripped.trim()]
}
