import { expect, test } from 'bun:test'

import { createSetTopicTool } from './set-topic'

// LOCALIX-384/388: the goal's own period doubled (".. ") and "from the next run on"
// read as if work should wait for another run.
test('set_topic confirms in one clean sentence per part and says to continue now', async () => {
  const tool = createSetTopicTool({ save: async () => {} })
  const input = { title: 'Landing', goal: 'Ship the page.', previous_topic_summary: 'None.' }
  const result = await tool.execute('call', input)
  const content = String(result.content)
  expect(content).toStartWith(
    'Topic saved: Landing. Goal: Ship the page. From your next model call',
  )
  expect(content).not.toContain('..')
  expect(content).toContain('Continue the work now; do not set the topic again.')
})
