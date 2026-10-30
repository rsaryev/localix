import { describe, expect, test } from 'bun:test'

import { suggestedBy } from './recommend-rules'

const evidence = {
  open: ['infra/main.tf', 'README.md'],
  files: ['Dockerfile', 'package.json', 'schema.sql'],
  dependencies: ['@sentry/node'],
}

describe('what a listing is suggested for, against what the person has', () => {
  test('an open file leads: matched by its name, a star standing for any characters', () => {
    expect(suggestedBy({ suggestFor: { files: ['*.tf', 'Dockerfile'] } }, evidence)).toEqual({
      source: 'open',
      label: 'main.tf',
    })
  })

  test('then the project: a file at its root, then a package it depends on', () => {
    expect(suggestedBy({ suggestFor: { files: ['dockerfile'] } }, evidence)).toEqual({
      source: 'project',
      label: 'Dockerfile',
    })
    expect(suggestedBy({ suggestFor: { dependencies: ['@sentry/node'] } }, evidence)).toEqual({
      source: 'project',
      label: '@sentry/node',
    })
  })

  test('a kind of file it opens counts as one it is suggested for, open or in the project', () => {
    expect(suggestedBy({ opens: ['tf'] }, evidence)).toEqual({ source: 'open', label: 'main.tf' })
    expect(suggestedBy({ opens: ['sql', 'db'] }, evidence)).toEqual({
      source: 'project',
      label: 'schema.sql',
    })
  })

  test('nothing when nothing it names is here; a star does not cross folders', () => {
    expect(
      suggestedBy({ suggestFor: { files: ['*.rb'], dependencies: ['prisma'] } }, evidence),
    ).toBeNull()
    expect(suggestedBy({ suggestFor: { files: ['infra*'] } }, evidence)).toBeNull()
    expect(suggestedBy({ opens: ['docx'] }, evidence)).toBeNull()
    expect(suggestedBy({}, evidence)).toBeNull()
  })
})
