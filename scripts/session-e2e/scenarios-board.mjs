/** Session E2E: what the agent can draw on the project board, through its own tool. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { lastRun, script } from './scenario-helpers.mjs'

const FLOW = [
  'flowchart LR',
  '  pr([Pull request]) --> ci{CI green?}',
  '  ci -->|yes| review[Review]',
  '  ci -.->|no| fix[Fix] --> ci',
  '  review ==> tag[Tag<br/>git tag]:::focal --> registry[(Registry)]',
].join('\n')
const MATRIX = [
  'quadrantChart',
  '  x-axis Low effort --> High effort',
  '  y-axis Low impact --> High impact',
  '  Offline mode:::focal: [0.3, 0.8]',
  '  Rewrite sync: [0.85, 0.3]',
].join('\n')

export const BOARD_SCENARIOS = [
  {
    name: 'board: the agent writes a flowchart and a 2×2 matrix as Mermaid, and the board draws them natively',
    async run(rt) {
      // The board is a file in its project: a throwaway one, never the repository.
      const dir = await mkdtemp(path.join(tmpdir(), 'localix-board-e2e-'))
      const project = await rt.api('/projects', { name: 'Board E2E', workingDir: dir })
      try {
        const session = await rt.createSession({ title: 'Board', projectId: project.id })
        const steps = {
          localix: [
            // Plugin tools wait behind activation, as a real model finds them.
            { tool: 'activate_tools', args: { names: ['space_apply'] } },
            {
              tool: 'space_apply',
              args: {
                ops: [
                  { op: 'create', id: 'release', type: 'flow', text: FLOW },
                  { op: 'create', id: 'bets', type: 'quadrant', text: MATRIX, near: 'release' },
                ],
              },
            },
            'Drew the release flow and the bets.',
          ],
        }
        const after = await rt.say(session.id, `Draw it. ${script(steps)}`)
        const request = lastRun(rt, after)
        assert.ok(request.tools.includes('space_apply'), 'the board tool is offered once activated')
        const { space } = await rt.api(`/project-space/space?sessionId=${session.id}`)
        const flow = space.elements.release
        const matrix = space.elements.bets
        assert.equal(flow?.type, 'flow')
        assert.deepEqual(
          flow.props.nodes.map((node) => node.id),
          ['pr', 'ci', 'review', 'fix', 'tag', 'registry'],
        )
        assert.equal(flow.props.nodes.find((node) => node.id === 'tag').role, 'focal')
        // Sized by its layout, not left at the default size.
        assert.ok(flow.w > 480 && flow.h > 120, `${flow.w}×${flow.h}`)
        assert.equal(matrix?.type, 'quadrant')
        assert.deepEqual(
          matrix.props.points.map((point) => [point.label, Boolean(point.focal)]),
          [
            ['Offline mode', true],
            ['Rewrite sync', false],
          ],
        )
      } finally {
        await rt.call(`/projects/${project.id}`, undefined, 'DELETE')
        await rm(dir, { recursive: true, force: true })
      }
    },
  },
]
