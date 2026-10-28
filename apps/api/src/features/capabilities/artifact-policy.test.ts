import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import type { AgentTool } from '@localixai/agent/agents'
import type { Rule } from '../agent-core/capability-rule'
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
      name === 'Bash'
        ? classifyBashCall
        : name === 'Browser'
          ? classifyBrowserCall
          : () => ({ effect: 'files' }),
  }) as AgentTool

// Deliberately authored policy fixtures; these are not shipped agent defaults.
const artifactPolicy = (handle: string): Rule[] => {
  const classes: Record<string, string[]> = {
    pm: ['documentation-files'],
    qa: ['test-files', 'documentation-files'],
    architect: ['prototype-files', 'documentation-files'],
    design: ['prototype-files', 'documentation-files'],
  }
  return [
    ...builtinAgentPreset('localix'),
    ...['Write', 'Edit'].flatMap((tool): Rule[] => [
      { action: `tool:${tool}`, resource: 'effect:files', effect: 'deny' },
      ...classes[handle]!.map((resource): Rule => ({
        action: `tool:${tool}`,
        resource,
        effect: 'allow',
      })),
    ]),
    { action: 'tool:*', resource: 'outside-workspace', effect: 'deny' },
    ...(handle === 'pm'
      ? [
          { action: 'tool:Bash', resource: 'effect:external', effect: 'deny' as const },
          { action: 'tool:Browser', resource: 'effect:external', effect: 'deny' as const },
          { action: 'tool:Browser', resource: 'effect:host', effect: 'deny' as const },
        ]
      : []),
  ]
}

async function blocked(
  handle: string,
  name: string,
  input: unknown,
  mode: 'default' | 'bypass' = 'default',
  workspace = root,
) {
  const { capabilities } = capabilitiesInMode(composeCapabilities(artifactPolicy(handle)), mode)
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

test('a custom documentation policy can maintain documentation, but cannot implement through file, shell, or browser actions', async () => {
  for (const mode of ['default', 'bypass'] as const) {
    expect(await blocked('pm', 'Write', { path: 'docs/plan.md' }, mode)).toBe(false)
    expect(await blocked('pm', 'Edit', { path: 'README.md' }, mode)).toBe(false)
    expect(await blocked('pm', 'Write', { path: 'src/app.ts' }, mode)).toBe(true)
    expect(await blocked('pm', 'Bash', { command: 'git status' }, mode)).toBe(false)
    expect(await blocked('pm', 'Bash', { command: 'echo code > src/app.ts' }, mode)).toBe(true)
    expect(await blocked('pm', 'Bash', { command: 'git push --force' }, mode)).toBe(true)
    expect(await blocked('pm', 'Browser', { action: 'snapshot' }, mode)).toBe(false)
    expect(
      await blocked('pm', 'Browser', { action: 'evaluate', expression: 'fetch("/write")' }, mode),
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
    expect(await blocked('pm', 'Write', { path: 'notes.md' }, 'default', workspace)).toBe(true)
    expect(await blocked('qa', 'Edit', { path: 'app.test.ts' }, 'default', workspace)).toBe(true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test.each([
  ['qa', 'src/app.test.ts', 'src/app.ts'],
  ['architect', 'prototypes/contract.ts', 'src/app.ts'],
  ['design', 'mockup.html', 'src/App.tsx'],
] as const)(
  'a custom %s policy has its artifact surface, without silently editing product implementation',
  async (handle, permitted, refused) => {
    expect(await blocked(handle, 'Write', { path: permitted })).toBe(false)
    expect(await blocked(handle, 'Write', { path: refused })).toBe(true)
    expect(await blocked(handle, 'Edit', { path: refused, old_string: 'a', new_string: 'b' })).toBe(
      true,
    )
    expect(await blocked(handle, 'Write', { path: '../outside/docs/plan.md' })).toBe(true)
  },
)
