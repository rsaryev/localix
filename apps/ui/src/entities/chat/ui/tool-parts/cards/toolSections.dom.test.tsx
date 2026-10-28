/**
 * Every tool card draws what a call was given and what it returned the same way: a group named
 * "In" and a group named "Out" (and "Error" for a failure), each with its label beside the content.
 * Cards used to invent their own labels (PROMPT, MSG, NAME, JOB, SCREEN, IMG): the longest ones
 * spilled out of the label column and printed over the text next to them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { CommandItem, McpCallItem, ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const call = (name: string, input: unknown, extra: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: `${name}-1`,
  type: 'tool_call',
  status: 'completed',
  toolCallId: `tc-${name}`,
  name,
  input,
  activeVerb: 'running',
  ...extra,
})

/** Render a card, open it, and read its sections the way a person does: by name, then content. */
async function sectionsOf(element: React.ReactElement) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(element))
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
  if (toggle) await React.act(async () => toggle.click())
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  // The header's own action strip is a group too; it is not a section of the call.
  const groups = Array.from(
    host.querySelectorAll<HTMLElement>('[role="group"][aria-label]'),
  ).filter((group) => !group.getAttribute('aria-label')!.endsWith(' actions'))
  return {
    host,
    names: groups.map((group) => group.getAttribute('aria-label')),
    group: (name: string) => groups.find((group) => group.getAttribute('aria-label') === name)!,
  }
}

describe('tool card sections', () => {
  test('an Agent call reads In with its prompt and Out with its answer, with no PROMPT label', async () => {
    const { AgentCard } = await import('./AgentCards')
    const prompt =
      'This is a test of the Agent tool. Work out 17 × 23 and report the result briefly.'
    const view = await sectionsOf(
      <AgentCard
        item={call(
          'Agent',
          { subagent_type: 'general-purpose', description: 'Check', prompt },
          { resultText: '17 × 23 = 391' },
        )}
      />,
    )
    expect(view.names).toEqual(['In', 'Out'])
    expect(view.group('In').textContent).toContain(prompt)
    expect(view.group('Out').textContent).toContain('391')
    expect(view.host.textContent).not.toContain('PROMPT')
    // Natural language is text, not a code listing: only code and JSON sit in a <pre>.
    expect(view.group('In').querySelector('pre')).toBeNull()
    expect(view.group('Out').querySelector('pre')).toBeNull()
  })

  test('a label is a short word beside its content and never part of what was sent', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await sectionsOf(
      <AgentCard item={call('Agent', { prompt: 'Summarise the diff' }, { resultText: 'Done' })} />,
    )
    const label = view.group('In').firstElementChild!
    expect(label.textContent).toBe('In')
    expect(view.group('In').lastElementChild!.textContent).toContain('Summarise the diff')
    expect(view.group('In').lastElementChild!.textContent).not.toContain('In')
  })

  test('copying the output sits inside the Out group', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await sectionsOf(
      <AgentCard item={call('Agent', { prompt: 'Go' }, { resultText: 'Finished' })} />,
    )
    expect(view.group('Out').querySelector('button[aria-label="Copy full output"]')).not.toBeNull()
    expect(view.group('In').querySelector('button[aria-label="Copy full output"]')).not.toBeNull()
  })

  test('SendMessage and TaskStop use In and Out too', async () => {
    const { SendMessageCard, TaskStopCard } = await import('./AgentCards')
    const message = await sectionsOf(
      <SendMessageCard
        item={call(
          'SendMessage',
          { to: 'researcher', message: 'Please continue' },
          { resultText: 'Sent' },
        )}
      />,
    )
    expect(message.names).toEqual(['In', 'Out'])
    expect(message.group('In').textContent).toContain('Please continue')

    const stop = await sectionsOf(
      <TaskStopCard
        item={call('TaskStop', { task_id: 'job-7' }, { resultText: 'Stopped job-7' })}
      />,
    )
    expect(stop.names).toEqual(['In', 'Out'])
    expect(stop.group('In').textContent).toContain('job-7')
  })

  test('Skill and Jobs name what was asked under In, not NAME or JOB', async () => {
    const { SkillCard, JobsCard } = await import('./actionCards')
    const skill = await sectionsOf(
      <SkillCard
        item={call('skill', { action: 'get', name: 'release-notes' }, { resultText: 'Body' })}
      />,
    )
    expect(skill.names).toEqual(['In', 'Out'])
    expect(skill.group('In').textContent).toContain('release-notes')
    const jobs = await sectionsOf(
      <JobsCard
        item={call('jobs', { action: 'stop', job_id: 'j-1' }, { resultText: 'Stopped' })}
      />,
    )
    expect(jobs.names).toEqual(['In', 'Out'])
    expect(jobs.group('In').textContent).toContain('j-1')
  })

  test('a failed card adds an Error group after In and Out', async () => {
    const { AgentCard } = await import('./AgentCards')
    const view = await sectionsOf(
      <AgentCard
        item={call(
          'Agent',
          { prompt: 'Go' },
          { status: 'failed', resultText: 'partial', errorText: 'Subagent crashed' },
        )}
      />,
    )
    expect(view.names).toEqual(['In', 'Out', 'Error'])
    expect(view.group('Error').textContent).toContain('Subagent crashed')
  })

  test('the generic and MCP cards keep JSON in a code block under In and Out', async () => {
    const { GenericToolCard } = await import('./GenericToolCard')
    const { McpCard } = await import('./McpCard')
    const generic = await sectionsOf(
      <GenericToolCard
        item={call('board_update', { id: 3, title: 'Ship' }, { resultText: 'ok' })}
      />,
    )
    expect(generic.names).toEqual(['In', 'Out'])
    expect(generic.group('In').querySelector('pre')?.textContent).toContain('"title": "Ship"')

    const mcp: McpCallItem = {
      id: 'm-1',
      type: 'mcp_call',
      status: 'completed',
      toolCallId: 'tc-m',
      name: 'mcp__docs__search',
      server: 'docs',
      tool: 'search',
      input: { q: 'sections' },
      resultText: 'three hits',
    }
    const mcpView = await sectionsOf(<McpCard item={mcp} />)
    expect(mcpView.names).toEqual(['In', 'Out'])
    expect(mcpView.group('Out').textContent).toContain('three hits')
  })

  test('command, search, read, browser and terminal cards use the same two words', async () => {
    const { CommandCard } = await import('./CommandCard')
    const { SearchCard } = await import('./SearchCard')
    const { ReadCard } = await import('./ReadCard')
    const { BrowserCard } = await import('./BrowserCard')
    const { TerminalToolCard } = await import('./TerminalToolCard')

    const command: CommandItem = {
      id: 'c-1',
      type: 'command',
      status: 'completed',
      toolCallId: 'tc-c',
      name: 'bash',
      command: 'ls -la',
      output: 'total 0',
      exitCode: 0,
      input: { command: 'ls -la' },
    }
    expect((await sectionsOf(<CommandCard item={command} />)).names).toEqual(['In', 'Out'])
    expect(
      (
        await sectionsOf(
          <SearchCard item={call('search', { pattern: 'TODO' }, { resultText: 'a.ts:1: TODO' })} />,
        )
      ).names,
    ).toEqual(['In', 'Out'])
    expect(
      (
        await sectionsOf(
          <ReadCard item={call('read', { path: '/w/a.ts' }, { resultText: 'const a = 1' })} />,
        )
      ).names,
    ).toEqual(['In', 'Out'])
    expect(
      (
        await sectionsOf(
          <BrowserCard item={call('browser', { action: 'evaluate' }, { resultText: '42' })} />,
        )
      ).names,
    ).toEqual(['Out'])
    expect(
      (
        await sectionsOf(
          <TerminalToolCard
            item={call('terminal', { action: 'read' }, { resultText: 'prompt $' })}
          />,
        )
      ).names,
    ).toEqual(['Out'])
  })

  test('a returned picture is part of Out, not a label of its own', async () => {
    const { BrowserCard } = await import('./BrowserCard')
    const view = await sectionsOf(
      <BrowserCard
        item={call(
          'browser',
          { action: 'take_screenshot' },
          {
            attachments: [
              {
                kind: 'image',
                mediaType: 'image/png',
                mediaId: 'abc.png',
                name: 'image-1',
                size: 3,
              },
            ],
          },
        )}
      />,
    )
    expect(view.names).toEqual(['Out'])
    expect(view.group('Out').querySelector('img')).not.toBeNull()
  })
})
