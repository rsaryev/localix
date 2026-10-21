import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import { api, captureRoot } from './runtime.mjs'
import { button, openTool } from './scenarios.mjs'
import { scratchGitEnv } from '../scratch-git-env.mjs'

const execute = promisify(execFile)
// The capture repository is a disposable fixture; keep the hook environment out of it.
const reviewerEnv = scratchGitEnv(process.env, {
  GIT_AUTHOR_NAME: 'Demo Reviewer',
  GIT_AUTHOR_EMAIL: 'reviewer@example.com',
  GIT_COMMITTER_NAME: 'Demo Reviewer',
  GIT_COMMITTER_EMAIL: 'reviewer@example.com',
})
const courseId = 'release-quality'
const courseTitle = 'Review a reliable release'

export async function seedDeveloper(fixture) {
  const root = await fs.realpath(fixture.platformRoot)
  const safeRoot = await fs.realpath(captureRoot)
  if (!root.startsWith(`${safeRoot}${path.sep}`))
    throw new Error('Git capture must stay inside the disposable fixture.')
  // Match Git's canonical root on macOS (/tmp is a symlink to /private/tmp).
  await api(`/projects/${fixture.platformProjectId}`, { workingDir: root }, 'PATCH')
  fixture.platformRoot = root
  const git = (...args) =>
    execute('git', args, { cwd: root, env: reviewerEnv, timeout: 10_000, killSignal: 'SIGKILL' })
  let initialized = true
  try {
    await fs.access(path.join(root, '.git'))
  } catch {
    initialized = false
  }
  if (!initialized) {
    await git('init', '-b', 'main')
    await git('add', '.')
    await git('commit', '-m', 'Add the release workspace')
  }
  // A deterministic untracked PNG proves that a Changes row uses the ordinary image viewer.
  await fs.writeFile(
    path.join(root, 'review-image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo0AAAAASUVORK5CYII=',
      'base64',
    ),
  )
  const releaseFile = path.join(root, 'src/release.ts')
  const source = await fs.readFile(releaseFile, 'utf8')
  await fs.writeFile(
    releaseFile,
    source
      .replace("state: 'in-review'", "state: 'ready'")
      .replace(
        "{ label: 'Publish release notes', done: false }",
        "{ label: 'Publish release notes', done: true }",
      ),
  )
  const files = {
    'course.json': {
      schemaVersion: 1,
      id: courseId,
      title: courseTitle,
      topic: 'Release review',
      goal: 'Turn implementation checks into clear review evidence.',
      description: 'A local, file-authored course about testing and reviewing a workspace update.',
      level: 'beginner',
      language: 'en',
      estimatedMinutes: 15,
      modules: ['module.json'],
    },
    'module.json': {
      id: 'evidence',
      title: 'Useful review evidence',
      description: 'Choose checks that prove the intended behavior.',
      lessons: ['lesson.json'],
    },
    'lesson.json': {
      id: 'release-checks',
      title: 'Choose checks that matter',
      summary: 'Connect a user action to an observable result.',
      estimatedMinutes: 15,
      generationStatus: 'ready',
      objectives: [{ id: 'outcome', text: 'Explain what a release check proves.' }],
      steps: ['concept.json', 'quiz.json', 'practice.json'],
    },
    'concept.json': {
      id: 'observable-outcome',
      type: 'concept',
      title: 'Make the outcome observable',
      content: 'concept.md',
      keyPoints: [
        'Start with a real user action.',
        'Assert its meaningful result.',
        'Use screenshots when they explain the evidence.',
      ],
    },
    'quiz.json': {
      id: 'choose-evidence',
      type: 'quiz',
      question: 'Which check proves the preview works?',
      options: [
        { id: 'empty', label: 'The preview tab opens.' },
        { id: 'result', label: 'The real page loads and the expected title is visible.' },
      ],
      correctOptionId: 'result',
      explanation: 'answer.md',
    },
    'practice.json': {
      id: 'write-check',
      type: 'practice',
      title: 'Write a focused check',
      prompt: 'practice.md',
      acceptanceCriteria: ['Name a user action.', 'Describe an observable result.'],
    },
  }
  const text = {
    'concept.md':
      '## From action to evidence\n\nA useful check starts with something a person actually does. Open the release preview, follow the primary action, and inspect the result. The check should fail when that result disappears.\n\n### Keep the check focused\n\n- Choose a deterministic fixture instead of a private workspace.\n- Assert the visible outcome before taking a screenshot.\n- Give the image a stable name describing what it proves.\n\nA screenshot records the composition. The assertion explains why that composition is trustworthy. Together they make a review easier to understand and repeat.\n',
    'answer.md':
      'An opened tab alone does not prove its content loaded. Inspect the actual page and assert its expected title.\n',
    'practice.md':
      'Write one check for the mobile release preview. Include the action, expected result, and a useful screenshot name.\n',
  }
  const portable = {
    format: 'localix-learning-course',
    version: 1,
    exportedAt: '2026-10-08T00:00:00.000Z',
    course: { id: courseId, title: courseTitle },
    files: [
      ...Object.entries(files).map(([name, value]) => ({
        path: name,
        content: JSON.stringify(value),
      })),
      ...Object.entries(text).map(([name, content]) => ({ path: name, content })),
    ],
  }
  const query = `?sessionId=${encodeURIComponent(fixture.platformSessionId)}`
  const existing = await api(`/learning/courses${query}`)
  if (!existing.courses.some((course) => course.id === courseId))
    await api(`/learning/course/import${query}`, portable)
  await api('/learning/course/active', {
    sessionId: fixture.platformSessionId,
    courseId,
    lessonId: 'release-checks',
    stepId: 'observable-outcome',
  })
}

export async function composeDeveloper(page, scenario) {
  if (scenario === 'code-graph') {
    await openTool(page, 'Code Graph')
    const search = page.getByRole('textbox', { name: 'Search the code graph', exact: true })
    await search.fill('progress')
    await page.getByRole('button', { name: /progress.*function/i }).click()
    await search.fill('')
    await page.getByText('completedChecks', { exact: true }).first().waitFor()
    await button(page, 'Fit everything').click()
    if (await button(page, 'Show the inspector').count())
      await button(page, 'Show the inspector').click()
  } else if (scenario === 'git') {
    await page
      .getByRole('button', { name: /^Git —/ })
      .first()
      .click()
    const maximize = button(page, 'Maximize panel')
    if (await maximize.count()) await maximize.first().click()
    await page
      .getByRole('treeitem', { name: 'Review changes in review-image.png', exact: true })
      .click()
    const image = page.getByRole('img', { name: 'Zoom image in', exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBe(1)
    await expect(
      page.getByText('Binary file — stage or discard the whole file instead.', { exact: true }),
    ).toHaveCount(0)
    await button(page, 'Open full diff').click()
    await page
      .getByText(/state: 'ready'/)
      .first()
      .waitFor()
  } else if (scenario === 'learning') {
    await openTool(page, 'Learning Studio')
    await page.getByText(courseTitle, { exact: true }).first().click()
    await page.getByRole('heading', { name: 'From action to evidence', exact: true }).waitFor()
  } else throw new Error(`Unknown developer scenario: ${scenario}`)
}

export async function verifyDeveloper(page, scenario) {
  if (scenario === 'code-graph') {
    await expect(page.getByRole('group', { name: 'Code Graph', exact: true })).toBeVisible()
    await expect(page.getByText('progress', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
  } else if (scenario === 'git') {
    await expect(page.getByText(/state: 'ready'/).first()).toBeVisible()
    await expect(page.getByText(/Publish release notes.*done: true/).first()).toBeVisible()
    await expect(page.getByText('release.ts', { exact: true }).first()).toBeVisible()
  } else if (scenario === 'learning') {
    await expect(
      page.getByRole('heading', { name: 'From action to evidence', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Make the outcome observable', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      page.getByText('Choose a deterministic fixture instead of a private workspace.', {
        exact: true,
      }),
    ).toBeVisible()
  } else throw new Error(`Unknown developer scenario: ${scenario}`)
}
