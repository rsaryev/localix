import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import type { AgentTool } from '@localixai/agent/agents'
import { builtinAgentPreset } from './builtin-agent-presets'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from './resolve'
import { capabilitiesInMode } from './permission-mode-policy'
import { createPermissionGate } from '../agent-core/permission-gate'
import { classifyBashCall } from '../agent-core/tools/bash/bash-call-class'
import { classifyBrowserCall } from '../agent-core/tools/browser/browser-classify'

const root = join(tmpdir(), 'localix-role-workspace')
const tool = (name: string): AgentTool =>
  ({
    name,
    classify:
      name === 'bash'
        ? classifyBashCall
        : name === 'browser'
          ? classifyBrowserCall
          : () => ({ effect: 'files' }),
  }) as AgentTool

async function blocked(
  handle: string,
  name: string,
  input: unknown,
  mode: 'default' | 'bypass' = 'default',
  workspace = root,
) {
  const { capabilities } = capabilitiesInMode(composeCapabilities(builtinAgentPreset(handle)), mode)
  const projection = projectCapabilities(capabilities, { ...NO_ROSTERS, tool: [name] })
  if (projection.denied.tool.includes(name)) return true
  const gate = createPermissionGate({
    rules: projection.permissions,
    root: workspace,
    hostRoots: [],
    toolsByName: new Map([[name, tool(name)]]),
  })
  return (await gate({ toolCallId: 'call', toolName: name, input }))?.block === true
}

test('the PM can maintain documentation, but cannot implement through file, shell, or browser actions', async () => {
  for (const mode of ['default', 'bypass'] as const) {
    expect(await blocked('pm', 'write', { path: 'docs/plan.md' }, mode)).toBe(false)
    expect(await blocked('pm', 'edit', { path: 'README.md' }, mode)).toBe(false)
    expect(await blocked('pm', 'write', { path: 'src/app.ts' }, mode)).toBe(true)
    expect(await blocked('pm', 'bash', { command: 'git status' }, mode)).toBe(false)
    expect(await blocked('pm', 'bash', { command: 'echo code > src/app.ts' }, mode)).toBe(true)
    expect(await blocked('pm', 'bash', { command: 'git push --force' }, mode)).toBe(true)
    expect(await blocked('pm', 'browser', { action: 'snapshot' }, mode)).toBe(false)
    expect(
      await blocked('pm', 'browser', { action: 'evaluate', expression: 'fetch("/write")' }, mode),
    ).toBe(true)
  }
})

test('artifact grants cannot write product source through a documentation or test symlink', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'localix-artifact-link-'))
  try {
    const source = join(workspace, 'app.ts')
    await writeFile(source, 'original')
    await symlink(source, join(workspace, 'notes.md'))
    await symlink(source, join(workspace, 'app.test.ts'))
    expect(await blocked('pm', 'write', { path: 'notes.md' }, 'default', workspace)).toBe(true)
    expect(await blocked('qa', 'edit', { path: 'app.test.ts' }, 'default', workspace)).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test.each([
  ['qa', 'src/app.test.ts', 'src/app.ts'],
  ['architect', 'prototypes/contract.ts', 'src/app.ts'],
  ['design', 'mockup.html', 'src/App.tsx'],
] as const)(
  '%s has its artifact surface, without silently editing product implementation',
  async (handle, permitted, refused) => {
    expect(await blocked(handle, 'write', { path: permitted })).toBe(false)
    expect(await blocked(handle, 'write', { path: refused })).toBe(true)
    const patch = `*** Begin Patch\n*** Add File: ${permitted}\n+good\n*** Add File: ${refused}\n+bad\n*** End Patch`
    expect(await blocked(handle, 'apply_patch', { patch })).toBe(true)
    expect(await blocked(handle, 'write', { path: '../outside/docs/plan.md' })).toBe(true)
  },
)
