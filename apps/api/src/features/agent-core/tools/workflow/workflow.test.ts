import { describe, expect, test } from 'bun:test'
import { createScriptSandbox } from '@localixai/engine-scripts'

import { createWorkflowTool, findWorkflow, type WorkflowToolPort } from './workflow'

/**
 * `workflow` runs a plugin workflow by its `<plugin>:<name>`: the script's agents go to the port
 * (a child session each, in the chat), and only the progress and the return value come back.
 */
const scripts = createScriptSandbox()

const FILES: Record<string, string> = {
  '/p/audit.js': `export const meta = { name: 'audit', description: 'Audit files' }
phase('Find')
const found = await agent('list files', { label: 'lister' })
return pipeline(args.files, (file) => agent('audit ' + file, { label: file }))`,
  '/p/broken.js': 'const meta = 1',
  '/p/saved.js': `export const meta = { name: 'saved', description: 'Saved' }
return args`,
}

function port(): { port: WorkflowToolPort; started: string[] } {
  const started: string[] = []
  return {
    started,
    port: {
      scripts,
      list: async () => [
        { fullName: 'acme:audit', description: 'Audit files', file: '/p/audit.js' },
        { fullName: 'acme:broken', description: 'Broken', file: '/p/broken.js' },
      ],
      read: async (file) => FILES[file] ?? null,
      runAgent: async (toolCallId, workflow, request) => {
        started.push(`${toolCallId} ${workflow} ${request.label}`)
        return { text: `ok ${request.label}` }
      },
    },
  }
}

const signal = new AbortController().signal

describe('workflow tool input, as in Claude Code', () => {
  test('an inline script runs under the name of its meta', async () => {
    const result = await createWorkflowTool(port().port).execute(
      'c',
      {
        script: `export const meta = { name: 'inline', description: 'Inline' }\nreturn args.n + 1`,
        args: { n: 1 },
      },
      signal,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Workflow inline finished')
    expect(result.content).toContain('Result:\n2')
  })

  test('scriptPath wins over script and name', async () => {
    const result = await createWorkflowTool(port().port).execute(
      'c',
      { scriptPath: '/p/saved.js', script: 'ignored', name: 'acme:audit', args: [1] },
      signal,
    )
    expect(result.content).toContain('Workflow saved finished')
  })

  test('one of script, name or scriptPath is required, and title and description are ignored', async () => {
    const none = await createWorkflowTool(port().port).execute('c', {}, signal)
    expect(none.isError).toBe(true)
    expect(none.content).toContain('At least one of script, name or scriptPath')
    const ignored = await createWorkflowTool(port().port).execute(
      'c',
      { scriptPath: '/p/saved.js', title: 'x', description: 'y' },
      signal,
    )
    expect(ignored.content).toContain('Workflow saved finished')
  })

  test('has no budget input', () => {
    const schema = createWorkflowTool(port().port).inputSchema as unknown as {
      shape: Record<string, unknown>
    }
    expect(Object.keys(schema.shape)).toEqual([
      'script',
      'name',
      'scriptPath',
      'args',
      'resumeFromRunId',
      'title',
      'description',
    ])
  })
})

describe('workflow tool', () => {
  test('runs the named workflow; its agents go through the port with the call id', async () => {
    const { port: fake, started } = port()
    const updates: unknown[] = []
    const result = await createWorkflowTool(fake).execute(
      'call-1',
      { name: 'acme:audit', args: { files: ['a.ts', 'b.ts'] } },
      signal,
      (details) => updates.push(details),
    )
    expect(result.isError).toBeUndefined()
    expect(started).toEqual([
      'call-1 acme:audit lister',
      'call-1 acme:audit a.ts',
      'call-1 acme:audit b.ts',
    ])
    expect(result.content).toContain('Workflow acme:audit finished (3 agents).')
    expect(result.content).toContain('## Find')
    expect(result.content).toContain('"ok a.ts"')
    expect(result.details).toMatchObject({ workflow: 'acme:audit', agents: 3, phase: 'Find' })
    expect(updates.length).toBeGreaterThan(0)
  })

  test('a bare name resolves when one plugin has it; others are refused with the list', async () => {
    const entries = await port().port.list()
    expect(findWorkflow(entries, '/audit')).toMatchObject({ fullName: 'acme:audit' })
    expect(findWorkflow(entries, 'other')).toContain('Available: acme:audit, acme:broken')
    const missing = await createWorkflowTool(port().port).execute('c', { name: 'nope' }, signal)
    expect(missing.isError).toBe(true)
  })

  test('a workflow whose meta cannot be read does not run', async () => {
    const { port: fake, started } = port()
    const result = await createWorkflowTool(fake).execute('c', { name: 'acme:broken' }, signal)
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toContain('cannot run')
    expect(started).toEqual([])
  })
})
