import picomatch from 'picomatch/posix'

/**
 * The one path-glob compiler behind permission-rule paths (`Read(...)`, `Edit(...)`), hook
 * `if` file guards and skill activation `paths:`.
 *
 * The hand-rolled compiler it replaces knew only `*`, `**` and `?`, so `{a,b}` and `[...]`
 * were matched as LITERAL text: `Deny: Read(**\/*.{env,pem})` matched no real file and the
 * person's secrets stayed readable while the rule looked active. picomatch is the reference
 * implementation of the gitignore/bash glob dialect (braces, classes, globstar).
 *
 * Its output is a regex SOURCE that callers splice between their own anchors
 * (`^…$`, `(^|/)…$`, `(^|/)…(/|$)`), which picomatch's full grammar would break, so three
 * characters are made literal before it parses:
 *  - `|` — picomatch emits it raw, so `x|` became `(^|/)x|$` and matched EVERY path;
 *  - `(` `)` — a balanced pair became a regex group, so `/Program Files (x86)/**` matched
 *    `Program Files x86` and never the real directory.
 * A backslash before a letter or digit is dropped: picomatch passes `\b`, `\d` through as
 * regex escapes (word boundary, digit class), where a glob means the plain character.
 */
const OPTIONS: picomatch.PicomatchOptions = {
  // A rule about `**/*.env` must cover `.env` and files under `.ssh/`; dotfiles are where
  // secrets live, so a glob that skipped them would be a silent hole in a deny rule.
  dot: true,
  // A leading `!` is a negation in picomatch; in a rule it is just a character.
  nonegate: true,
  // `+(a)`, `@(a)` extglobs are not part of the rule grammar.
  noextglob: true,
  // Without it picomatch leaves gitignore's negated class `[!a-z]` as a class of `!`, `a-z`.
  posix: true,
}

function literalizeForSplice(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '\\' && i + 1 < glob.length) {
      const next = glob[i + 1]!
      out += /[A-Za-z0-9]/.test(next) ? next : `\\${next}`
      i++
    } else if (c === '(' || c === ')' || c === '|') {
      out += `\\${c}`
    } else {
      out += c
    }
  }
  return out
}

/**
 * Compile ONE path glob to a regex SOURCE (unanchored, wrapped in a non-capturing group so
 * it can be spliced next to anchors). `**\/` → any intermediate dirs, `*` → one segment,
 * `?` → one char, `{a,b}` → alternatives, `[a-z]`/`[!a]` → classes; everything else is
 * literal. May throw on a pathological pattern — callers already treat a throw as no match.
 */
export function globToRegExpSource(glob: string): string {
  return `(?:${picomatch.parse(literalizeForSplice(glob), OPTIONS).output})`
}
