import { expect, test } from 'bun:test'
import { selectComposerProjectId } from './commandScope'

const session = (id: string, projectId: string) => ({ id, projectId })

test('scopes dynamic commands to the owning composer session', () => {
  const sessions = [session('focused', 'project-a'), session('surface', 'project-b')]
  const state = { sessions, allSessions: sessions }
  expect(selectComposerProjectId(state, 'surface')).toBe('project-b')
  expect(selectComposerProjectId(state, null)).toBeNull()
})

test('resolves a warm out-of-scope surface from the complete roster', () => {
  const focused = session('focused', 'project-a')
  const warmOther = session('warm-other', 'project-b')

  expect(
    selectComposerProjectId(
      { sessions: [focused], allSessions: [focused, warmOther] },
      'warm-other',
    ),
  ).toBe('project-b')
})
