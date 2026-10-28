import { describe, expect, test } from 'bun:test'

import {
  buildTerminalDigest,
  parseScrollbackCommands,
  scrollbackTail,
  stripAnsi,
  DIGEST_MAX_COMMANDS,
  DIGEST_TAIL_LINES,
} from './scrollback-digest'

const BEL = '\x07'
const osc133 = (mark: string) => `\x1b]133;${mark}${BEL}`

/** One full prompt→command→exit round, as the shell integration emits it. */
const round = (command: string, exitCode: number, output: string) =>
  `${osc133('A')}$ ${osc133('B')}${command}\r\n${osc133('C')}${output}\r\n${osc133(`D;${exitCode}`)}`

describe('stripAnsi', () => {
  test('removes CSI/OSC/escapes and keeps text', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m plain \x1b]0;title\x07tail')).toBe('red plain tail')
  })

  test('carriage return overwrites the line (progress bars)', () => {
    expect(stripAnsi('downloading 10%\rdownloading 100%\ndone')).toBe('downloading 100%\ndone')
  })
})

describe('parseScrollbackCommands', () => {
  test('reconstructs commands with exit codes from OSC 133 marks', () => {
    const scrollback = round('bun test', 0, 'all pass') + round('bun run build', 1, 'boom')
    expect(parseScrollbackCommands(scrollback)).toEqual([
      { command: 'bun test', exitCode: 0 },
      { command: 'bun run build', exitCode: 1 },
    ])
  })

  test('a trailing C without D is a still-running command', () => {
    const scrollback =
      round('ls', 0, 'a b') + `${osc133('A')}$ ${osc133('B')}sleep 100\r\n${osc133('C')}`
    const commands = parseScrollbackCommands(scrollback)
    expect(commands[1]).toEqual({ command: 'sleep 100' })
  })

  test('no marks (plain scrollback) yields no commands', () => {
    expect(parseScrollbackCommands('just some dev-server logs\nmore logs')).toEqual([])
  })
})

describe('scrollbackTail', () => {
  test('bounds the tail and collapses blank runs', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n\n\n')
    const tail = scrollbackTail(lines)
    expect(tail.split('\n').length).toBeLessThanOrEqual(DIGEST_TAIL_LINES)
    expect(tail.endsWith('line 99')).toBe(true)
  })
})

describe('buildTerminalDigest', () => {
  const base = {
    id: '0123456789abcdef-uuid',
    cwd: '/work/app',
    altScreen: false,
    lastOutputAt: 995_000,
    now: 1_000_000,
  }

  test('renders header, commands, tail, and the actual bash input contract', () => {
    const digest = buildTerminalDigest({ ...base, scrollback: round('bun test', 0, '12 pass') })
    expect(digest).toContain('Terminal 01234567 — interactive shell in /work/app')
    expect(digest).toContain('last output 5s ago')
    expect(digest).toContain('[exit 0] bun test')
    expect(digest).toContain('12 pass')
    expect(digest).toContain(`terminal_id "${base.id}"`)
    expect(digest).toContain('`Bash`')
    expect(digest).toContain('keys:["Enter"]')
    expect(digest).not.toContain('`terminal` tool')
  })

  test('command panes show their command; alt-screen is flagged', () => {
    const digest = buildTerminalDigest({
      ...base,
      command: 'bun dev',
      altScreen: true,
      scrollback: 'ready on :5050',
    })
    expect(digest).toContain('running `bun dev` in /work/app')
    expect(digest).toContain('full-screen app on screen')
    expect(digest).not.toContain('Recent commands')
  })

  test('caps the command list at DIGEST_MAX_COMMANDS', () => {
    const scrollback = Array.from({ length: 9 }, (_, i) => round(`cmd${i}`, 0, 'ok')).join('')
    const digest = buildTerminalDigest({ ...base, scrollback })
    expect(digest).toContain(`Recent commands (last ${DIGEST_MAX_COMMANDS}):`)
    expect(digest).not.toContain('[exit 0] cmd3')
    expect(digest).toContain('[exit 0] cmd8')
  })

  test('full-screen context uses the current viewport without accumulated redraws', () => {
    const digest = buildTerminalDigest({
      ...base,
      altScreen: true,
      scrollback: 'OLD MENU\n'.repeat(1000),
      screen: 'Select a model\n> Auto\nEnter to select',
    })
    expect(digest).toContain('Current rendered screen')
    expect(digest).toContain('> Auto')
    expect(digest).not.toContain('OLD MENU')
    expect(digest.length).toBeLessThan(1000)
  })

  test('does not present old redraws as a viewport when rendering is unavailable', () => {
    const digest = buildTerminalDigest({ ...base, altScreen: true, scrollback: 'stale menu' })
    expect(digest).not.toContain('stale menu')
    expect(digest).toContain('Rendered screen unavailable')
  })

  test('normal-buffer TUIs use the viewport too and retain the selection footer when clipped', () => {
    const digest = buildTerminalDigest({
      ...base,
      scrollback: 'old state',
      screen: 'Model picker\n' + 'padding\n'.repeat(1000) + 'Selected: Luna',
    })
    expect(digest).toContain('Model picker')
    expect(digest).toContain('Selected: Luna')
    expect(digest).toContain('viewport clipped')
    expect(digest).not.toContain('old state')
    expect(digest.length).toBeLessThan(4000)
  })
})
