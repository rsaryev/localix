import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { run, tempDirPerTest } from '@localixai/testing'

import { settingsEnvScriptFor } from './settings-env-script'

/** A Bash command of a run sources the `env` of Claude Code's settings before it runs. */
const dir = tempDirPerTest('cc-settings-env-script-')

test('the script exports the variables to the command, quoted', async () => {
  const env = { API_BASE: 'https://team', NOTE: "it's", CMD: '$(echo run)' }
  const [script] = settingsEnvScriptFor(dir(), env)
  const print = `. '${script}'; printf '%s|%s|%s' "$API_BASE" "$NOTE" "$CMD"`
  const result = await run('bash', ['-c', print], { timeoutMs: 10_000 })
  expect(result.stdout).toBe("https://team|it's|$(echo run)")
})

test('no variables, no script — and a stale one is removed', () => {
  const [script] = settingsEnvScriptFor(dir(), { A: '1' })
  expect(existsSync(script!)).toBe(true)
  expect(settingsEnvScriptFor(dir(), {})).toEqual([])
  expect(existsSync(join(dir(), 'claude-settings-env.sh'))).toBe(false)
})
