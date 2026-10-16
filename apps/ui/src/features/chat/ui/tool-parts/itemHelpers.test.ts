import { describe, expect, test } from 'bun:test'
import type { AgentItem, ToolBackedItem } from '@localixai/agent/agents'

import {
  chainSummary,
  itemActionVerb,
  itemStackLabel,
  statusLabel,
  chainDiffStats,
  isStandaloneItem,
  findLastStreamingToolItem,
  hasItemError,
  isItemDeclined,
  itemErrorHeadline,
  itemErrorMessage,
} from './itemHelpers'

describe('isStandaloneItem', () => {
  test('true for tool-backed items whose meta marks them standalone', () => {
    expect(isStandaloneItem(tool({}, 'ask'))).toBe(true)
  })

  test('true for an arbitrary extension tool that declares itself standalone', () => {
    expect(isStandaloneItem({ ...tool({}, 'extension_surface'), standalone: true })).toBe(true)
  })

  test('content presentation is a standalone boundary even without a redundant flag', () => {
    expect(
      isStandaloneItem({
        ...tool({}, 'extension_surface'),
        presentation: { transcript: 'content' },
      }),
    ).toBe(true)
  })

  test('true for a provider-neutral UI action returned by any tool', () => {
    expect(
      isStandaloneItem({
        ...tool({}, 'plugin_navigation'),
        output: {
          type: 'ui.navigate',
          uri: 'localix://ui/settings/plugins',
          label: 'Open plugins',
        },
      } as ToolBackedItem),
    ).toBe(true)
  })

  test('false for a tool without the standalone flag', () => {
    expect(isStandaloneItem(tool({}, 'read'))).toBe(false)
  })

  test('false for a non-tool-backed item', () => {
    expect(
      isStandaloneItem({ type: 'text', text: 'hi', status: 'completed' } as unknown as AgentItem),
    ).toBe(false)
  })
})

const tool = (input: Record<string, unknown>, name = 'some_tool'): ToolBackedItem =>
  ({ type: 'tool_call', name, status: 'completed', input }) as unknown as ToolBackedItem
const runningTool = (name: string): ToolBackedItem =>
  ({ ...tool({}, name), status: 'running' }) as ToolBackedItem

test('findLastStreamingToolItem starts from the active tail', () => {
  const latest = runningTool('latest')
  expect(findLastStreamingToolItem([runningTool('old'), tool({}), latest])).toBe(latest)
})

// One-hunk diff (no ---/+++ headers): 1 deletion, 2 additions.
const DIFF = '@@ -1,1 +1,2 @@\n-a\n+b\n+c\n'
const fileChange = (changes: Array<{ path: string; diff?: string }>): AgentItem =>
  ({
    type: 'file_change',
    name: 'edit',
    status: 'completed',
    changes: changes.map((c) => ({ kind: 'modify', ...c })),
  }) as unknown as AgentItem

describe('chainDiffStats', () => {
  test('sums +/- across the diffs of file_change items', () => {
    expect(chainDiffStats([fileChange([{ path: 'a.ts', diff: DIFF }])])).toEqual({
      additions: 2,
      deletions: 1,
    })
  })

  test('accumulates across multiple file_change items and changes', () => {
    const items = [
      fileChange([
        { path: 'a.ts', diff: DIFF },
        { path: 'b.ts', diff: DIFF },
      ]),
      fileChange([{ path: 'c.ts', diff: DIFF }]),
    ]
    expect(chainDiffStats(items)).toEqual({ additions: 6, deletions: 3 })
  })

  test('ignores non-file_change items and changes without a diff', () => {
    expect(chainDiffStats([tool({ path: 'x' }), fileChange([{ path: 'a.ts' }])])).toEqual({
      additions: 0,
      deletions: 0,
    })
  })

  test('empty input is zero', () => {
    expect(chainDiffStats([])).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('statusLabel', () => {
  test('maps terminal statuses, empty for the rest', () => {
    expect(statusLabel('completed')).toBe('Done')
    expect(statusLabel('failed')).toBe('Failed')
    expect(statusLabel('aborted')).toBe('Stopped')
    expect(statusLabel('streaming' as never)).toBe('')
  })
})

describe('a refused call shows the person’s sentence, never the model’s', () => {
  const refused = (error: Record<string, unknown>): ToolBackedItem =>
    ({ ...tool({}, 'bash'), status: 'failed', error }) as unknown as ToolBackedItem

  test('a person’s decline is neutral, and its headline is their own act', () => {
    const item = refused({
      kind: 'blocked',
      message: 'User declined bash.',
      userMessage: 'You declined bash',
      personMessage: 'You declined bash',
      refusal: 'human',
    })
    expect(isItemDeclined(item)).toBe(true)
    expect(hasItemError(item)).toBe(false)
    expect(itemErrorHeadline(item)).toBe('You declined bash')
    // No red ERR block carrying the model's instruction.
    expect(itemErrorMessage(item)).toBeUndefined()
  })

  test('a policy refusal stays an error, worded for the person', () => {
    const item = refused({
      kind: 'blocked',
      message: 'Plan mode is read-only: investigate with reads, then present the plan.',
      userMessage: 'Plan mode is read-only',
      personMessage: 'Plan mode is read-only',
      refusal: 'automatic',
    })
    expect(hasItemError(item)).toBe(true)
    expect(itemErrorHeadline(item)).toBe('Plan mode is read-only')
    expect(itemErrorMessage(item)).toBe('Plan mode is read-only')
  })

  test('an ordinary failure keeps its raw output for the operator', () => {
    const item = refused({ kind: 'execution', message: 'exit 1: boom', userMessage: 'Boom' })
    expect(isItemDeclined(item)).toBe(false)
    expect(itemErrorMessage(item)).toBe('exit 1: boom')
    expect(itemErrorHeadline(item)).toBe('Boom')
  })
})

describe('itemStackLabel — tool_call argument priority', () => {
  test('path wins, shown as basename', () => {
    expect(itemStackLabel(tool({ path: 'src/foo/bar.ts', query: 'q' }))).toBe('bar.ts')
  })
  test('query is next, truncated to 40', () => {
    expect(itemStackLabel(tool({ query: 'short query' }))).toBe('short query')
    expect(itemStackLabel(tool({ query: 'x'.repeat(60) })).length).toBe(40)
  })
  test('action combines with a named arg, else stands alone', () => {
    expect(itemStackLabel(tool({ action: 'create', name: 'widget' }))).toBe('create: widget')
    expect(itemStackLabel(tool({ action: 'list' }))).toBe('list')
  })
  test('title/task fall back when no path/query/action', () => {
    expect(itemStackLabel(tool({ title: 'Build the thing' }))).toBe('Build the thing')
  })
  test('command + file_change + mcp_call variants', () => {
    expect(
      itemStackLabel({
        type: 'command',
        command: 'ls -la\nrm x',
        input: {},
      } as unknown as ToolBackedItem),
    ).toBe('ls -la')
    expect(
      itemStackLabel({
        type: 'command',
        command: 'x',
        input: { description: 'list files' },
      } as unknown as ToolBackedItem),
    ).toBe('list files')
    expect(
      itemStackLabel({
        type: 'file_change',
        changes: [{ path: 'a/b/c.ts' }],
      } as unknown as ToolBackedItem),
    ).toBe('c.ts')
    expect(
      itemStackLabel({ type: 'mcp_call', tool: 'github.search' } as unknown as ToolBackedItem),
    ).toBe('github.search')
  })
})

describe('itemActionVerb', () => {
  test('meta-independent branches', () => {
    expect(itemActionVerb({ type: 'command' } as AgentItem)).toBe('Running')
    expect(itemActionVerb({ type: 'mcp_call', tool: 'gh.search' } as unknown as AgentItem)).toBe(
      'Calling gh.search',
    )
    expect(itemActionVerb({ type: 'text' } as unknown as AgentItem)).toBe('Working')
  })
})

describe('chainSummary', () => {
  const fileChange = (paths: string[]): AgentItem =>
    ({
      type: 'file_change',
      name: 'edit',
      changes: paths.map((path) => ({ path })),
    }) as unknown as AgentItem

  test('null when nothing is tool-backed', () => {
    expect(chainSummary([], false)).toBeNull()
    expect(chainSummary([{ type: 'text' } as unknown as AgentItem], false)).toBeNull()
  })

  test('file changes are counted by UNIQUE path, not by call', () => {
    // two edits to the same file → "1 file"; the noun is forced to files/file.
    expect(chainSummary([fileChange(['a.ts']), fileChange(['a.ts'])], false)).toMatch(/\b1 file\b/)
    expect(chainSummary([fileChange(['a.ts']), fileChange(['b.ts'])], false)).toMatch(/\b2 files\b/)
  })

  test('live summaries end with an ellipsis and are capitalized', () => {
    const summary = chainSummary([fileChange(['a.ts'])], true)!
    expect(summary.endsWith('…')).toBe(true)
    expect(summary[0]).toBe(summary[0].toUpperCase())
  })
})

describe('batched reads and searches', () => {
  test('the stack label names the first file or pattern and how many more ride along', () => {
    expect(itemStackLabel(tool({ reads: [{ path: 'src/a.ts' }, 'b.ts', 'c.ts'] }, 'read'))).toBe(
      'a.ts +2',
    )
    expect(itemStackLabel(tool({ path: 'x.ts', reads: [{ path: 'y.ts' }] }, 'read'))).toBe(
      'x.ts +1',
    )
    expect(itemStackLabel(tool({ queries: ['alpha', 'beta'] }, 'search'))).toBe('alpha +1')
  })

  test('the chain summary counts files and searches, not calls', () => {
    const items = [
      tool({ reads: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] }, 'read'),
      tool({ path: 'd.ts' }, 'read'),
    ]
    expect(chainSummary(items, false)).toMatch(/\b4 files\b/)
    expect(chainSummary([tool({ query: 'a', queries: ['b'] }, 'search')], false)).toMatch(
      /\b2 searches\b/,
    )
  })
})
