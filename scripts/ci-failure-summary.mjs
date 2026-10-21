#!/usr/bin/env bun
// What failed in a CI check, as Markdown for the run's summary page: the failing tests, type
// errors and Turbo tasks, pulled out of the check's log so nobody scrolls thousands of lines.
//
//   bun scripts/ci-failure-summary.mjs <title> <log file> >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/gu
const LIMIT = 50

/**
 * The failures a check's log reports, each list de-duplicated and in log order.
 * @param {string} log
 */
export function collectFailures(log) {
  const tests = new Set()
  const types = new Set()
  const tasks = new Set()
  for (const raw of log.split('\n')) {
    const line = raw
      .replace(ANSI, '')
      .replace(/^\S+T\S+Z /u, '')
      .trim()
    // `@scope/pkg:test: (fail) suite > case [12ms]`, or a bare `(fail) …` from a direct run.
    const test = /^(?:(\S+?):\S+?: )?\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/u.exec(line)
    if (test) tests.add(test[1] ? `${test[1]}: ${test[2]}` : test[2])
    const type = /([^\s\]]+\.tsx?\(\d+,\d+\): error TS\d+: .+)$/u.exec(line)
    if (type) types.add(type[1])
    const task = /^Failed:\s+(\S+)$/u.exec(line)
    if (task) tasks.add(task[1])
  }
  return { tests: [...tests], types: [...types], tasks: [...tasks] }
}

/** @param {string} title @param {ReturnType<typeof collectFailures>} failures */
export function renderSummary(title, { tests, types, tasks }) {
  const section = (heading, items) =>
    items.length
      ? [
          `#### ${heading} (${items.length})`,
          '',
          ...items.slice(0, LIMIT).map((item) => `- \`${item.replaceAll('`', "'")}\``),
          ...(items.length > LIMIT ? [`- … ${items.length - LIMIT} more in the log`] : []),
          '',
        ]
      : []
  const body = [
    ...section('Failing tests', tests),
    ...section('Type errors', types),
    ...section('Failed tasks', tasks),
  ]
  return [
    `### ${title} failed`,
    '',
    ...(body.length ? body : ['No test or type failure in the log; open the step output.', '']),
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [title = 'Check', file = ''] = process.argv.slice(2)
  let log = ''
  try {
    log = readFileSync(file, 'utf8')
  } catch {
    // No log: the check failed before it wrote one; the summary says so.
  }
  console.log(renderSummary(title, collectFailures(log)))
}
