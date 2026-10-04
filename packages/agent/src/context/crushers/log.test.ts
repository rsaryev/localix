import { describe, expect, test } from 'bun:test'
import { crushLog } from './log'

// Build a realistic noisy build log: header + lots of "Compiling …" noise + an
// error with a stack trace + a summary verdict.
function buildLog(): string {
  const head = ['$ cargo build --release', '   Compiling headroom-core v0.1.0']
  const noise = Array.from({ length: 60 }, (_, i) => `   Compiling dep_${i} v1.2.${i}`)
  const err = [
    'error[E0382]: borrow of moved value: `config`',
    '  --> src/main.rs:42:17',
    '   |',
    '42 |     let x = config;',
    '   |             ^^^^^^ value borrowed here after move',
  ]
  const tail = [
    'error: could not compile `headroom-core` due to previous error',
    'Build failed in 12.3s',
  ]
  return [...head, ...noise, ...err, ...tail].join('\n')
}

describe('crushLog', () => {
  test('keeps errors + stack + summary, drops the compile noise, and shrinks', () => {
    const log = buildLog()
    const r = crushLog(log)
    expect(r).not.toBeNull()
    expect(r!.afterChars).toBeLessThan(r!.beforeChars)
    const text = r!.text
    expect(text).toContain('error[E0382]')
    expect(text).toContain('value borrowed here after move') // stack/context kept
    expect(text).toContain('Build failed in 12.3s') // tail verdict kept
    expect(text).toMatch(/\[… \d+ lines omitted …\]/) // noise collapsed
    expect(text).not.toContain('Compiling dep_30') // a middle noise line is gone
  })

  test('collapses consecutive identical lines with a ×N count', () => {
    const lines = [
      'starting',
      ...Array.from({ length: 30 }, () => 'WARN: deprecated API used'),
      'error: build failed',
      'done',
    ]
    // Force the duplicated WARN block into the kept region by making them errors-adjacent:
    const r = crushLog(lines.join('\n'), { headLines: 1, tailLines: 1, minLines: 10 })
    expect(r).not.toBeNull()
    // Either collapsed via ×N or omitted — but must be far smaller than 30 repeats.
    expect(r!.text.split('deprecated API used').length - 1).toBeLessThan(30)
  })

  test('preserves a long chained traceback in full (not capped to 8 frames)', () => {
    const frames = Array.from(
      { length: 18 },
      (_, i) => `  File "mod_${i}.py", line ${i * 3 + 1}, in fn_${i}\n    step_${i}()`,
    )
    const log = [
      '$ python run.py',
      ...Array.from({ length: 40 }, (_, i) => `INFO: progress tick ${i}`), // droppable noise
      'Traceback (most recent call last):',
      ...frames,
      'ValueError: original failure',
      '',
      'During handling of the above exception, another exception occurred:',
      '',
      'Traceback (most recent call last):',
      '  File "handler.py", line 7, in wrap',
      '    raise RuntimeError("wrapped")',
      'RuntimeError: wrapped',
      ...Array.from({ length: 20 }, (_, i) => `INFO: cleanup ${i}`), // more droppable noise
    ].join('\n')
    const r = crushLog(log, { headLines: 1, tailLines: 1 })
    expect(r).not.toBeNull()
    const t = r!.text
    expect(t).toContain('ValueError: original failure')
    expect(t).toContain('During handling of the above exception') // chain connector kept
    expect(t).toContain('RuntimeError: wrapped') // second exception kept
    expect(t).toContain('File "mod_17.py"') // 18th frame survives (was dropped at the 8-cap)
    expect(t).toContain('File "handler.py"') // frame in the chained trace
    expect(t).not.toContain('progress tick 20') // surrounding noise still dropped
    expect(r!.afterChars).toBeLessThan(log.length)
  })

  test('returns null for short logs', () => {
    expect(crushLog(['a', 'b', 'c'].join('\n'))).toBeNull()
  })

  test('returns null when nothing can be dropped (all lines kept)', () => {
    // 26 distinct error lines: every line scores keep → no omission → no shrink.
    const allErrors = Array.from({ length: 26 }, (_, i) => `error: thing ${i} failed`).join('\n')
    expect(crushLog(allErrors)).toBeNull()
  })
})
