import { promises as fs } from 'node:fs'
import { expect } from '@playwright/test'
import { fixtureFile, uiOrigin } from './runtime.mjs'
import { seedTranscript } from './transcript-fixture.mjs'

const TITLE = 'Codemode card fixture'

/**
 * One finished `codemode` call in a conversation of its own: the script, the three calls it made
 * (one of them failed) and the JSON it returned. Illustrative fixture state, not a recorded model
 * run; the card is what renders it.
 */
const script = [
  "const files = ['src/release.ts', 'src/release.test.ts', 'src/missing.ts']",
  'const sizes = {}',
  'for (const path of files) {',
  '  try { sizes[path] = (await tools.read({ path })).length }',
  '  catch (error) { sizes[path] = String(error) }',
  '}',
  "const tests = await tools.bash({ command: 'bun test src/release.test.ts' })",
  "return { sizes, passed: tests.includes('2 pass') }",
].join('\n')

const codemodeItem = {
  id: 'codemode-capture-1',
  type: 'tool_call',
  status: 'completed',
  toolCallId: 'tc-codemode-capture-1',
  name: 'codemode',
  activeVerb: 'Running a script',
  input: { code: script },
  output: {
    calls: [
      { name: 'read', args: { path: 'src/release.ts' }, status: 'ok', durationMs: 4 },
      { name: 'read', args: { path: 'src/release.test.ts' }, status: 'ok', durationMs: 3 },
      {
        name: 'read',
        args: { path: 'src/missing.ts' },
        status: 'error',
        durationMs: 2,
        error: 'No such file: src/missing.ts',
      },
      {
        name: 'bash',
        args: { command: 'bun test src/release.test.ts' },
        status: 'ok',
        durationMs: 1840,
      },
    ],
    complete: true,
  },
  resultText: JSON.stringify({
    sizes: { 'src/release.ts': 812, 'src/release.test.ts': 640, 'src/missing.ts': 'not found' },
    passed: true,
  }),
}

/** Run by `seed.mjs` under Bun: it writes the transcript straight into the capture database. */
export async function seedCodemodeCard(fixture) {
  fixture.codemodeSessionId = await seedTranscript(fixture, {
    title: TITLE,
    label: 'codemode',
    idPrefix: 'capture-codemode',
    rows: [
      {
        role: 'user',
        content: 'Check the release files and run the release test in one go.',
      },
      {
        role: 'assistant',
        content: 'Both release files read and the release test passes; `src/missing.ts` is absent.',
        items: [
          codemodeItem,
          {
            type: 'text',
            id: 'codemode-capture-text',
            status: 'completed',
            text: 'Both release files read and the release test passes; `src/missing.ts` is absent.',
          },
        ],
      },
    ],
  })
}

/** Open a conversation from the history, where a fresh layout keeps it collapsed. */
export async function openConversation(page, title) {
  const composer = page.getByRole('button', { name: 'Add participant', exact: true })
  if (await composer.isVisible()) return
  const history = page.getByRole('region', { name: 'Session history', exact: true })
  if (!(await history.isVisible()))
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
  // A keyboard activation: the collapsed workspace's tips overlay the history rows' pointer area.
  const row = history.getByRole('button', { name: title, exact: true })
  await row.focus()
  await row.press('Enter')
  await expect(composer).toBeVisible()
}

/** The fixture's one-agent chat, open with its composer showing. */
export async function openFixtureChat(page) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.codemodeSessionId) throw new Error('Run screenshots:seed for the codemode fixture.')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.codemodeSessionId}`)
  await openConversation(page, TITLE)
}

export async function composeCodemodeCard(page) {
  await openFixtureChat(page)
  const card = page.getByRole('button', { name: /Script · read, bash/ }).first()
  await card.waitFor()
  if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click()
}

export async function verifyCodemodeCard(page) {
  const card = page.getByRole('button', { name: /Script · read, bash/ }).first()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('4 calls · 1 failed').first()).toBeVisible()
  await expect(page.getByText('No such file: src/missing.ts').first()).toBeVisible()
  // The returned JSON is indented for reading, not a one-line blob.
  await expect(page.getByText('"passed": true').first()).toBeVisible()
}
