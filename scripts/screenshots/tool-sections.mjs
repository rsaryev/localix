import { promises as fs } from 'node:fs'
import { expect } from '@playwright/test'
import { openConversation } from './fixture-chat.mjs'
import { fixtureFile, uiOrigin } from './runtime.mjs'
import { seedTranscript } from './transcript-fixture.mjs'

const TITLE = 'Tool call sections fixture'
const PROMPT =
  'Compare the release notes with CHANGELOG.md. List every entry that is in one and missing from the other, and answer in two or three sentences without changing any file.'
const ANSWER =
  'Both files list the same eleven entries. The only difference is the order: the notes put Fixed before Changed.'

/**
 * One reply with three finished tool calls: a subagent started with a prompt in plain language, a
 * shell command and a mini app tool that has no card of its own. Illustrative fixture state, written
 * the way a run persists its items; no model ran.
 */
const rows = [
  { role: 'user', content: 'Check that the release notes match the changelog.' },
  {
    role: 'assistant',
    content: 'The notes and the changelog agree.',
    items: [
      {
        id: 'tool-sections-agent',
        type: 'tool_call',
        status: 'completed',
        toolCallId: 'tc-tool-sections-agent',
        name: 'Agent',
        activeVerb: 'Delegating',
        input: {
          subagent_type: 'general-purpose',
          description: 'Compare notes with changelog',
          prompt: PROMPT,
        },
        resultText: ANSWER,
      },
      {
        id: 'tool-sections-bash',
        type: 'command',
        status: 'completed',
        toolCallId: 'tc-tool-sections-bash',
        name: 'Bash',
        command: 'git diff --stat HEAD~1 -- CHANGELOG.md',
        input: { command: 'git diff --stat HEAD~1 -- CHANGELOG.md' },
        output: ' CHANGELOG.md | 12 ++++++++++++\n 1 file changed, 12 insertions(+)\n',
        exitCode: 0,
      },
      {
        id: 'tool-sections-generic',
        type: 'tool_call',
        status: 'completed',
        toolCallId: 'tc-tool-sections-generic',
        name: 'release_status',
        activeVerb: 'Checking',
        input: { release: 'v1.4.0', checks: ['notes', 'changelog'] },
        resultText: '{"release":"v1.4.0","ready":true}',
      },
      {
        type: 'text',
        id: 'tool-sections-text',
        status: 'completed',
        text: 'The notes and the changelog agree.',
      },
    ],
  },
]

/** Run by `seed.mjs` under Bun: it writes the transcript straight into the capture database. */
export async function seedToolSections(fixture) {
  fixture.toolSectionsSessionId = await seedTranscript(fixture, {
    title: TITLE,
    label: 'tool-sections',
    idPrefix: 'capture-tool-sections',
    rows,
  })
}

export async function composeToolSections(page) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.toolSectionsSessionId)
    throw new Error('Run screenshots:seed for the tool-sections fixture.')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.toolSectionsSessionId}`)
  await openConversation(page, TITLE)
  // The calls are folded into one chain; open it, then each call, the way a person reads them.
  await page.getByRole('button', { name: /^Expand tool chain/ }).click()
  for (const title of ['Compare notes with changelog', /git diff/, 'release_status']) {
    const header = page.locator('button[aria-expanded="false"]').filter({ hasText: title }).first()
    await header.click()
  }
  await page.getByRole('group', { name: 'In', exact: true }).first().waitFor()
}

export async function verifyToolSections(page) {
  const sections = page.getByRole('group', { name: /^(In|Out)$/ })
  // The subagent: what it was asked, then what it answered. No PROMPT label, nothing in a listing.
  const asked = page
    .getByRole('group', { name: 'In', exact: true })
    .filter({ hasText: 'Compare the release notes' })
  await expect(asked).toHaveCount(1)
  await expect(page.getByText('PROMPT', { exact: true })).toHaveCount(0)
  await expect(
    page
      .getByRole('group', { name: 'Out', exact: true })
      .filter({ hasText: 'the same eleven entries' }),
  ).toHaveCount(1)
  await expect(asked.locator('pre')).toHaveCount(0)
  // Code and JSON stay a listing.
  await expect(
    page
      .getByRole('group', { name: 'In', exact: true })
      .filter({ hasText: '"release": "v1.4.0"' })
      .locator('pre'),
  ).toHaveCount(1)
  // A label sits beside its content, never over it.
  const count = await sections.count()
  expect(count).toBeGreaterThanOrEqual(6)
  for (let index = 0; index < count; index++) {
    const group = sections.nth(index)
    const label = await group.locator('span[aria-hidden="true"]').first().boundingBox()
    const body = await group.locator(':scope > div').boundingBox()
    expect(label.x + label.width).toBeLessThanOrEqual(body.x)
  }
  // The same label word carries the same measure in every card.
  const widths = new Set()
  for (let index = 0; index < count; index++) {
    const body = await sections.nth(index).locator(':scope > div').boundingBox()
    widths.add(Math.round(body.x))
  }
  expect(widths.size).toBe(1)
}
