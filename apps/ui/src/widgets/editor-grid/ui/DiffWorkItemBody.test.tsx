import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
import type { WorkItem } from '@/shared/lib/workItem'
import { DiffWorkItemBody } from './DiffWorkItemBody'

const MULTI_FILE_DIFF = [
  'diff --git a/src/deep/example.ts b/src/deep/example.ts',
  '--- a/src/deep/example.ts',
  '+++ b/src/deep/example.ts',
  '@@ -1 +1 @@',
  '-before',
  '+after',
].join('\n')

test('diff work-item header actions use managed hints without native titles', () => {
  const item: WorkItem = {
    kind: 'diff',
    id: 'diff:s1:commit',
    title: 'Commit changes',
    scope: 's1',
    payload: {
      diff: MULTI_FILE_DIFF,
      multiFile: true,
      rootPath: '/workspace/project',
    },
  }

  // As the grid renders a tab body: inside its chat's session provider.
  const html = renderToStaticMarkup(
    <WorkItemSessionProvider sessionId="s1">
      <DiffWorkItemBody item={item} />
    </WorkItemSessionProvider>,
  )
  const disclosure = html.match(
    /<button[^>]*aria-label="Collapse src\/deep\/example\.ts\. 1 addition, 1 deletion"[^>]*>/,
  )?.[0]
  const openFile = html.match(
    /<button[^>]*aria-label="Open \/workspace\/project\/src\/deep\/example\.ts at line 1"[^>]*>/,
  )?.[0]

  expect(disclosure).toContain('data-tooltip-trigger="true"')
  expect(disclosure).not.toContain('title=')
  expect(openFile).toContain('data-tooltip-trigger="true"')
  expect(openFile).not.toContain('title=')
  expect(html).not.toContain('title=')
  expect(html).toContain('aria-label="Open file at line 1"')
  expect(html).toContain('aria-label="Diff controls"')
  expect(html).not.toContain('data-slot="floating-action-group"')
})

test('a diff tab that belongs to no chat offers no file opens — none is guessed for it', () => {
  const item: WorkItem = {
    kind: 'diff',
    id: 'diff:commit',
    title: 'Commit changes',
    payload: { diff: MULTI_FILE_DIFF, multiFile: true, rootPath: '/workspace/project' },
  }
  const html = renderToStaticMarkup(<DiffWorkItemBody item={item} />)
  expect(html).not.toContain('aria-label="Open /workspace/project/src/deep/example.ts at line 1"')
  expect(html).not.toContain('aria-label="Open file at line 1"')
})
