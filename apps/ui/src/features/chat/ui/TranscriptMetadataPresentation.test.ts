import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('runtime facts stay flat instead of becoming status pills', () => {
  const runtime = read('./runtimeSessionRowParts.tsx')
  const jobs = read('./prompt-input/WorkStrip.tsx')
  const loops = read('./prompt-input/SchedulesPanel.tsx')
  const queue = read('./prompt-input/QueuePanel.tsx')
  const path = read('./SessionPathSegment.tsx')

  for (const source of [runtime, jobs, loops, queue]) {
    expect(source).toContain('<WorkbenchListRow')
    expect(source).toContain('density="dense"')
  }
  for (const source of [runtime, jobs, queue]) {
    expect(source).toContain('role="listitem"')
  }
  expect(runtime).toContain('<WorkbenchListRowActions')
  expect(runtime).toContain('<IconButton')
  expect(runtime).not.toContain('<span>Stop</span>')
  expect(loops).toContain('<WorkbenchListRowActions')
  expect(loops).not.toContain("<span>{running ? 'Running…' : 'Run now'}</span>")
  expect(loops).not.toContain('<span>Cancel</span>')
  expect(jobs).toContain('<WorkbenchListRowActions')
  expect(jobs).not.toContain('<span>Stop</span>')
  expect(queue).toContain('<WorkbenchListRowActions')
  expect(queue).toContain('<IconButton')
  expect(queue).not.toContain('sm:opacity-0')
  expect(loops).not.toContain('border-border/62')
  expect(runtime).not.toContain('ring-control-border/45')
  expect(path).toContain('<Check')
  expect(path).toContain('focus-ring')
  expect(path).not.toContain('rounded bg-surface-raised')
})
