import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveJsEntry } from './lsp-js-entry'

/**
 * Windows `.bin` entries are shims, not symlinks, and `bun <shim>` parsed a batch file or a
 * PE binary as JavaScript — every JS language server crashed on start there. Each fixture
 * below is the shape one package manager actually writes.
 */
let root = ''
let bin = ''
let entry = ''

beforeAll(() => {
  // Canonical: macOS' tmpdir is behind a /private symlink, and the symlink case resolves it.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lsp-js-entry-')))
  bin = join(root, 'node_modules', '.bin')
  const pkgBin = join(root, 'node_modules', '@vtsls', 'language-server', 'bin')
  mkdirSync(bin, { recursive: true })
  mkdirSync(pkgBin, { recursive: true })
  entry = join(pkgBin, 'vtsls.js')
  writeFileSync(entry, '#!/usr/bin/env node\nconsole.log(1)\n')
  // Extensionless JS entries are common (vscode-langservers-extracted): judged by shebang.
  writeFileSync(join(pkgBin, 'json-server'), '#!/usr/bin/env node\n')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('resolveJsEntry', () => {
  // Creating a symlink needs Developer Mode on Windows, and POSIX is where they are written.
  test.skipIf(process.platform === 'win32')('a POSIX symlink resolves to its target', () => {
    symlinkSync(entry, join(bin, 'linked'))
    expect(resolveJsEntry(join(bin, 'linked'))).toBe(entry)
  })

  test("npm's .cmd shim: the script, not the node.exe it also names", () => {
    writeFileSync(
      join(bin, 'vtsls.cmd'),
      [
        '@ECHO off',
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ')',
        '"%_prog%"  "%dp0%\\..\\@vtsls\\language-server\\bin\\vtsls.js" %*',
      ].join('\r\n'),
    )
    // node.exe exists beside the shim in a real Node install; it must still be skipped.
    writeFileSync(join(bin, 'node.exe'), 'MZ')
    expect(resolveJsEntry(join(bin, 'vtsls.cmd'))).toBe(entry)
  })

  test("pnpm's %~dp0 form and an extensionless node script", () => {
    writeFileSync(
      join(bin, 'json.cmd'),
      '@"%~dp0\\..\\@vtsls\\language-server\\bin\\json-server" %*\r\n',
    )
    expect(resolveJsEntry(join(bin, 'json.cmd'))).toBe(
      join(root, 'node_modules', '@vtsls', 'language-server', 'bin', 'json-server'),
    )
  })

  test("Bun's .exe shim is resolved through its .bunx descriptor", () => {
    writeFileSync(join(bin, 'bunx-server.exe'), 'MZ\u0000\u0000binary')
    writeFileSync(
      join(bin, 'bunx-server.bunx'),
      Buffer.concat([
        Buffer.from('..\\@vtsls\\language-server\\bin\\vtsls.js"', 'utf16le'),
        Buffer.from([0, 0]),
        Buffer.from('#!/usr/bin/env node'),
      ]),
    )
    expect(resolveJsEntry(join(bin, 'bunx-server.exe'))).toBe(entry)
  })

  test("npm's sh shim", () => {
    writeFileSync(
      join(bin, 'shimmed'),
      '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/../@vtsls/language-server/bin/vtsls.js" "$@"\n',
    )
    expect(resolveJsEntry(join(bin, 'shimmed'))).toBe(entry)
  })

  test('nothing recoverable → undefined, so the caller runs the shim itself', () => {
    writeFileSync(join(bin, 'native.exe'), 'MZ')
    expect(resolveJsEntry(join(bin, 'native.exe'))).toBeUndefined()
  })
})
