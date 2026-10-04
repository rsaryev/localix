import { describe, expect, it } from 'bun:test'
import { globToRegExpSource } from './path-glob'

const full = (glob: string, path: string) => new RegExp(`^${globToRegExpSource(glob)}$`).test(path)
const anyDepth = (glob: string, path: string) =>
  new RegExp(`(^|/)${globToRegExpSource(glob)}$`).test(path)

describe('globToRegExpSource', () => {
  it('keeps the wildcard semantics the rules were written against', () => {
    expect(full('/p/src/**/*.ts', '/p/src/a/b/c.ts')).toBe(true)
    expect(full('/p/src/**/*.ts', '/p/src/c.ts')).toBe(true)
    expect(full('/p/src/*.ts', '/p/src/a/c.ts')).toBe(false)
    expect(full('/p/a?c', '/p/abc')).toBe(true)
    expect(full('/p/a?c', '/p/a/c')).toBe(false)
    expect(anyDepth('.env', '/p/sub/.env')).toBe(true)
    expect(anyDepth('.env', '/p/.environment')).toBe(false)
  })

  it('escapes regex metacharacters in literal path text', () => {
    expect(full('/p/my.app', '/p/myXapp')).toBe(false)
    expect(full('/p/a+b$c^', '/p/a+b$c^')).toBe(true)
    expect(full('/p/src/(old', '/p/src/(old')).toBe(true)
  })

  it('expands braces and classes', () => {
    expect(anyDepth('*.{env,pem}', '/p/x/server.pem')).toBe(true)
    expect(anyDepth('*.{env,pem}', '/p/.env')).toBe(true)
    expect(anyDepth('*.{env,pem}', '/p/x.key')).toBe(false)
    expect(full('/p/id[0-9]', '/p/id3')).toBe(true)
    expect(full('/p/id[0-9]', '/p/idx')).toBe(false)
    expect(full('/p/id[!0-9]', '/p/idx')).toBe(true)
    expect(full('/p/id[!0-9]', '/p/id3')).toBe(false)
  })

  it('matches dotfiles and dot-directories (where secrets live)', () => {
    expect(full('/home/u/**/*', '/home/u/.ssh/id_rsa')).toBe(true)
  })

  // picomatch emits `|` raw and turns a balanced `(…)` into a regex group; spliced
  // between a caller's anchors, `x|` became `(^|/)x|$` — a rule matching EVERY path.
  it('a pipe cannot escape the caller anchors, and parentheses stay literal', () => {
    expect(anyDepth('x|', '/p/anything')).toBe(false)
    expect(full('/p/a|/p/b', '/p/b')).toBe(false)
    expect(full('/opt/App (x86)/**', '/opt/App (x86)/bin/run')).toBe(true)
    expect(full('/opt/App (x86)/**', '/opt/App x86/bin/run')).toBe(false)
  })

  it('a backslash before a letter is that letter, never a regex class escape', () => {
    expect(full('/p/\\d', '/p/d')).toBe(true)
    expect(full('/p/\\d', '/p/7')).toBe(false)
    expect(full('/p/\\*', '/p/*')).toBe(true)
    expect(full('/p/\\*', '/p/x')).toBe(false)
  })
})
