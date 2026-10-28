import { expect, test } from 'bun:test'
import os, { homedir } from 'node:os'
import { tmpdir } from 'node:os'

// Bun reads HOME once, when the process starts: the preload's own HOME must still be what every
// way of asking for the home directory answers, or a test reads the developer's ~/.claude.
test('every way of asking for the home directory answers the test HOME', () => {
  const home = process.env.HOME!
  expect(home.startsWith(tmpdir())).toBe(true)
  expect(homedir()).toBe(home)
  expect(os.homedir()).toBe(home)
  expect((require('node:os') as typeof os).homedir()).toBe(home)
})

test('the home stays the process’s own when HOME is unset or changed, as the OS account’s does', () => {
  const home = homedir()
  const saved = process.env.HOME
  try {
    process.env.HOME = '/tmp/elsewhere'
    expect(homedir()).toBe(home)
    delete process.env.HOME
    expect(homedir()).toBe(home)
  } finally {
    process.env.HOME = saved
  }
})
