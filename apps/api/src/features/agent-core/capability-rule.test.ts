import { describe, expect, test } from 'bun:test'

import { evaluate, matches, verdictIn, type Rule } from './capability-rule'

const rule = (action: string, resource: string, effect: Rule['effect']): Rule => ({
  action,
  resource,
  effect,
})

describe('matching', () => {
  test('an exact pattern matches only itself', () => {
    expect(matches('tool:Bash', 'tool:Bash')).toBe(true)
    expect(matches('tool:Bash', 'tool:bashful')).toBe(false)
  })

  test('a wildcard switches off a whole family in one row', () => {
    expect(matches('tool:*', 'tool:Bash')).toBe(true)
    expect(matches('mcp:github/*', 'mcp:github/create_pr')).toBe(true)
    expect(matches('mcp:github/*', 'mcp:gitlab/create_pr')).toBe(false)
  })

  test('regex metacharacters in a pattern are literal', () => {
    // A resource is a command line; `.` and `(` are ordinary characters in one, and a pattern
    // that quietly became a regex would match far more than the user wrote.
    expect(matches('rm -rf /', 'rm -rf /')).toBe(true)
    expect(matches('a.c', 'abc')).toBe(false)
    expect(matches('a+b', 'a+b')).toBe(true)
  })

  // `*` is "any run of characters" for commands and paths alike — not a path glob, whose `*`
  // stops at `/` and would let `rm -rf /tmp/x` past a `rm *` deny.
  test('a wildcard spans slashes, spaces and newlines', () => {
    expect(matches('rm *', 'rm -rf /tmp/x')).toBe(true)
    expect(matches('/secret/*', '/secret/a/b.pem')).toBe(true)
    // A legal POSIX file name; `.` without dotAll stopped at the newline and the deny missed it.
    expect(matches('/secret/*', '/secret/a\nb')).toBe(true)
    expect(matches('git *', 'git commit -m "one\ntwo"')).toBe(true)
  })

  test('a trailing " *" covers the bare head as well as its arguments', () => {
    // `git *` means "the git command". A session grant derives exactly this spelling from a
    // card showing `git status`, so without the bare case a later plain `git` asked again.
    expect(matches('git *', 'git status')).toBe(true)
    expect(matches('git *', 'git')).toBe(true)
    // Still anchored: it is the git command, not anything that starts with those letters.
    expect(matches('git *', 'github-cli run')).toBe(false)
  })
})

describe('the last match wins', () => {
  test('a specific exception overrides a general rule stated before it', () => {
    // The reason this is last-match and not strictest-match: "bash is fine, except rm" must
    // stay expressible. Taking the strictest would make the general rule unreachable.
    const rules = [rule('tool:Bash', '*', 'allow'), rule('tool:Bash', 'rm *', 'deny')]
    expect(verdictIn(rules, 'tool:Bash', 'ls')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:Bash', 'rm -rf /')?.effect).toBe('deny')
  })

  test('a positive list closes its kind: a leading deny, then the exceptions', () => {
    // The shape every shipped preset is written in. The allows carve out of the denial
    // BECAUSE they come after it — reverse the two and the roster means nothing.
    const rules = [
      rule('tool:*', '*', 'deny'),
      rule('tool:Read', '*', 'allow'),
      rule('tool:Search', '*', 'allow'),
    ]
    expect(verdictIn(rules, 'tool:Read', '*')?.effect).toBe('allow')
    expect(verdictIn(rules, 'tool:Bash', '*')?.effect).toBe('deny')
  })

  test('a deny is not terminal — a later rule about the same thing still decides', () => {
    // The old engine returned on the first matching deny, which made the order of a list
    // partly decorative. One resolution rule now, and it is the one the editor shows.
    const rules = [rule('tool:Bash', '*', 'deny'), rule('tool:Bash', '*', 'allow')]
    expect(verdictIn(rules, 'tool:Bash', '*')?.effect).toBe('allow')
  })

  test('rules that say nothing about the target answer nothing', () => {
    expect(verdictIn([rule('tool:Bash', '*', 'deny')], 'tool:Read', '*')).toBeUndefined()
  })
})

describe('evaluate', () => {
  test('reports the rule responsible, so a gate can attribute its decision', () => {
    const rules = [rule('tool:Bash', '*', 'allow'), rule('tool:Bash', 'rm *', 'deny')]
    const verdict = evaluate(rules, 'tool:Bash', 'rm -rf /', 'allow')
    expect(verdict.effect).toBe('deny')
    expect(verdict.rule?.resource).toBe('rm *')
  })

  test('nothing matching falls back, and says so by carrying no rule', () => {
    // The absence of a rule is what sends a plugin to its trust gate, so it has to be
    // distinguishable from a rule that allowed it.
    const verdict = evaluate([], 'tool:Bash', '*', 'allow')
    expect(verdict.effect).toBe('allow')
    expect(verdict.rule).toBeUndefined()
  })

  test('a wildcard rule reaches a name nothing mentions exactly', () => {
    expect(evaluate([rule('tool:*', '*', 'deny')], 'tool:Bash', '*', 'allow').effect).toBe('deny')
  })
})
