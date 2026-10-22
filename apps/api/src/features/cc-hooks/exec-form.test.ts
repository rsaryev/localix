/**
 * Claude Code's exec form (`command` + `args`) and the `CLAUDE_PLUGIN_OPTION_<KEY>` variables every
 * plugin hook process receives (hooks reference, "Exec form and shell form"; manifest reference,
 * "Reference a saved value").
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { resolveHookSpawnTarget } from '../lifecycle-hooks/command-target'
import { buildCcHookRegistry, collectHookUserConfigTokens } from './config'
import { powershellPlaceholders } from './config-command'
import type { CcHookHandler, CcHookInput } from './contracts'
import { executeHook } from './executor'

const dir = tempDirPerTest('cc-exec-form-')
const silent = { warn: () => {}, info: () => {} }
const input = { hook_event_name: 'PostToolUse', session_id: 's1' } as unknown as CcHookInput

/** Writes its arguments and plugin env to the file named by its first argument. */
const RECORDER = `const fs = require('node:fs')
const [out, ...rest] = process.argv.slice(2)
fs.writeFileSync(out, JSON.stringify({
  rest,
  root: process.env.CLAUDE_PLUGIN_ROOT,
  token: process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN,
  url: process.env.CLAUDE_PLUGIN_OPTION_WEBHOOK_URL,
}))`

async function pluginHandler(handler: Record<string, unknown>): Promise<CcHookHandler> {
  const { registry } = await buildCcHookRegistry({
    projectDir: dir(),
    pluginHooks: [
      {
        pluginName: 'p',
        pluginRoot: dir(),
        dataDir: join(dir(), 'data'),
        config: { api_token: 'tok-123', webhook_url: 'https://example.test/hook' },
        sensitiveKeys: ['api_token'],
        raw: { hooks: { PostToolUse: [{ hooks: [{ type: 'command', ...handler }] }] } },
      },
    ],
  })
  const parsed = registry.PostToolUse?.[0]?.handlers[0]
  if (!parsed) throw new Error('handler did not parse')
  return parsed
}

const recorded = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

describe('exec form', () => {
  it('substitutes placeholders into command and each argument as plain strings', async () => {
    const handler = await pluginHandler({
      command: '${CLAUDE_PLUGIN_ROOT}/bin/tool',
      args: ['${CLAUDE_PLUGIN_ROOT}/a b.js', '--token=${user_config.api_token}', "it's $HOME"],
    })
    expect(handler.command).toBe(`${dir()}/bin/tool`)
    // A sensitive option substitutes too: no shell re-parses an exec-form argument.
    expect(handler.args).toEqual([`${dir()}/a b.js`, '--token=tok-123', "it's $HOME"])
  })

  it('spawns the executable with its arguments verbatim and no shell', async () => {
    writeFileSync(join(dir(), 'record.js'), RECORDER)
    const out = join(dir(), 'out.json')
    const pwned = join(dir(), 'PWNED')
    const handler = await pluginHandler({
      command: process.execPath,
      args: ['${CLAUDE_PLUGIN_ROOT}/record.js', out, `$(touch ${pwned})`, "a'b `c` $HOME", '*'],
    })
    const outcome = await executeHook(handler, input, dir(), silent, false)
    expect(outcome).toEqual({})
    expect(recorded(out).rest).toEqual([`$(touch ${pwned})`, "a'b `c` $HOME", '*'])
    expect(recorded(out).root).toBe(dir())
    expect(existsSync(pwned)).toBe(false)
  })

  it('reports a missing executable as a failed, non-blocking hook', async () => {
    const warnings: string[] = []
    const handler = await pluginHandler({ command: join(dir(), 'missing-binary'), args: [] })
    const outcome = await executeHook(
      handler,
      input,
      dir(),
      { warn: (m) => warnings.push(m) },
      false,
    )
    expect(outcome).toEqual({ failed: 'error' })
    expect(warnings.join('\n')).toContain('missing-binary')
  })

  it('drops a handler whose args are not a list of strings', async () => {
    const { registry } = await buildCcHookRegistry({
      projectDir: dir(),
      pluginHooks: [
        {
          pluginName: 'p',
          pluginRoot: dir(),
          dataDir: dir(),
          raw: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: [1] }] }] } },
        },
      ],
    })
    expect(registry.Stop).toBeUndefined()
  })

  it('keeps shell `shell: powershell` on shell form and ignores it on exec form', async () => {
    expect((await pluginHandler({ command: 'Get-Date', shell: 'powershell' })).shell).toBe(
      'powershell',
    )
    expect((await pluginHandler({ command: 'node', args: [], shell: 'powershell' })).shell).toBe(
      undefined,
    )
  })

  it('does not warn about a sensitive option in an exec-form hook', () => {
    const hook = (extra: Record<string, unknown>) => ({
      hooks: { Stop: [{ hooks: [{ command: 'x ${user_config.api_token}', ...extra }] }] },
    })
    expect([...collectHookUserConfigTokens(hook({}))]).toEqual(['api_token'])
    expect([...collectHookUserConfigTokens(hook({ args: [] }))]).toEqual([])
  })
})

describe('CLAUDE_PLUGIN_OPTION_<KEY>', () => {
  it('reaches a shell-form hook for every option, sensitive ones included', async () => {
    const out = join(dir(), 'env.txt')
    const handler = await pluginHandler({
      command: `printf '%s|%s' "$CLAUDE_PLUGIN_OPTION_API_TOKEN" "$CLAUDE_PLUGIN_OPTION_WEBHOOK_URL" > '${out}'`,
    })
    await executeHook(handler, input, dir(), silent, false)
    expect(readFileSync(out, 'utf8')).toBe('tok-123|https://example.test/hook')
  })

  it('reaches an exec-form hook too', async () => {
    writeFileSync(join(dir(), 'record.js'), RECORDER)
    const out = join(dir(), 'out.json')
    const handler = await pluginHandler({
      command: process.execPath,
      args: ['${CLAUDE_PLUGIN_ROOT}/record.js', out],
    })
    await executeHook(handler, input, dir(), silent, false)
    expect(recorded(out)).toMatchObject({ token: 'tok-123', url: 'https://example.test/hook' })
  })
})

describe('shell form under PowerShell', () => {
  const psArgv = (handler: CcHookHandler, platform: NodeJS.Platform = 'win32') =>
    resolveHookSpawnTarget(
      { ...handler, forPowerShell: powershellPlaceholders },
      { platform, resolveBash: () => ({ shell: '/bin/bash', args: ['-c'] }) },
    ).argv.at(-1)

  it('reads the path placeholders from the environment as ${env:NAME}', async () => {
    const handler = await pluginHandler({
      command:
        '& "${CLAUDE_PLUGIN_ROOT}\\scripts\\check.ps1" "${CLAUDE_PROJECT_DIR}" ${CLAUDE_PLUGIN_DATA}',
      shell: 'powershell',
    })
    expect(psArgv(handler)).toBe(
      '& "${env:CLAUDE_PLUGIN_ROOT}\\scripts\\check.ps1" "${env:CLAUDE_PROJECT_DIR}" ${env:CLAUDE_PLUGIN_DATA}',
    )
  })

  it('reads a plugin option from the environment, with its fallback as a PowerShell expression', async () => {
    const handler = await pluginHandler({
      command: 'Write-Output "${user_config.webhook_url}" ${user_config.region:-it\'s eu}',
      shell: 'powershell',
    })
    expect(psArgv(handler, 'darwin')).toBe(
      'Write-Output "${env:CLAUDE_PLUGIN_OPTION_webhook_url}" ' +
        "$(if (${env:CLAUDE_PLUGIN_OPTION_region}) { ${env:CLAUDE_PLUGIN_OPTION_region} } else { 'it''s eu' })",
    )
    expect(handler.shellEnv).toMatchObject({
      CLAUDE_PLUGIN_OPTION_webhook_url: 'https://example.test/hook',
      CLAUDE_PLUGIN_OPTION_region: '',
    })
  })

  it('leaves the bash form untouched when bash runs the command', async () => {
    const handler = await pluginHandler({ command: '"${CLAUDE_PLUGIN_ROOT}/x.sh"' })
    expect(psArgv(handler, 'darwin')).toBe('"${CLAUDE_PLUGIN_ROOT}/x.sh"')
  })
})
