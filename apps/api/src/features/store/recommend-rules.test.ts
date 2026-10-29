import { describe, expect, test } from 'bun:test'

import { suitedBy } from './recommend-rules'

const evidence = {
  open: ['infra/main.tf', 'README.md'],
  files: ['Dockerfile', 'package.json'],
  dependencies: ['@sentry/node'],
}

describe('what a listing says it is for, against what the person has', () => {
  test('an open file leads: matched by its name, a star standing for any characters', () => {
    expect(suitedBy({ files: ['*.tf', 'Dockerfile'] }, evidence)).toEqual({
      source: 'open',
      label: 'main.tf',
    })
  })

  test('then the project: a file at its root, then a package it depends on', () => {
    expect(suitedBy({ files: ['dockerfile'] }, evidence)).toEqual({
      source: 'project',
      label: 'Dockerfile',
    })
    expect(suitedBy({ dependencies: ['@sentry/node'] }, evidence)).toEqual({
      source: 'project',
      label: '@sentry/node',
    })
  })

  test('nothing when nothing it names is here; a star does not cross folders', () => {
    expect(suitedBy({ files: ['*.sql'], dependencies: ['prisma'] }, evidence)).toBeNull()
    expect(suitedBy({ files: ['infra*'] }, evidence)).toBeNull()
    expect(suitedBy(undefined, evidence)).toBeNull()
  })
})
