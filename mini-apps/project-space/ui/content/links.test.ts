import { describe, expect, test } from 'bun:test'
import {
  createMessageBindingDraft,
  type MessageContextBindingDraft,
} from '@localixai/mini-app-sdk/ui'
import { emptySpace } from '../../shared/format/document'
import { spaceTypes } from '../../shared/types'
import { dropEffectFor } from '../board/useBoardIO'
import { incomingFromPaste, opsFor } from './pipeline'
import { contentOfLink } from './links'

const pasted = (text: string) =>
  ({
    files: [],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  }) as unknown as DataTransfer

describe('what an app link becomes on the board', () => {
  test('a file or a folder is the board card that reads it', () => {
    expect(contentOfLink(createMessageBindingDraft('file', 'src/a.ts'))).toEqual({
      kind: 'path',
      path: 'src/a.ts',
      isDir: false,
    })
    expect(contentOfLink(createMessageBindingDraft('file', 'src/lib/'))).toMatchObject({
      path: 'src/lib',
      isDir: true,
    })
  })

  test('a snippet is code holding its text', () => {
    const snippet = createMessageBindingDraft('snippet', 'Query', 'Query', {
      content: 'select 1',
      language: 'sql',
    })
    expect(contentOfLink(snippet)).toEqual({
      kind: 'element',
      type: 'code',
      props: { code: 'select 1', language: 'sql', title: 'Query' },
    })
  })

  test.each([
    ['session', 'LOCALIX-42'],
    ['call', 'tc_1'],
    ['terminal', 'abcd1234ef'],
    ['project', 'p1'],
    ['message', 's1/m2'],
  ] as const)('a %s is an app link card that keeps the whole link', (kind, id) => {
    const link = createMessageBindingDraft(kind, id, `the ${kind}`)
    const content = contentOfLink(link)
    expect(content).toMatchObject({ kind: 'element', type: 'ref' })
    const props = content?.kind === 'element' ? content.props : {}
    expect(props).toMatchObject({ kind, token: link.target.token, label: `the ${kind}` })
    expect(spaceTypes.read('ref', props, 1).status).toBe('ok')
  })

  test('a provider resource keeps its URI and the mini app it came from', () => {
    const link: MessageContextBindingDraft = {
      ...createMessageBindingDraft('resource', 'localix://resource/database/c1/users', 'users'),
      miniApp: 'database',
    }
    expect(contentOfLink(link)).toMatchObject({
      type: 'ref',
      props: { kind: 'resource', uri: 'localix://resource/database/c1/users', miniApp: 'database' },
    })
  })

  test('a stored attachment is a link to its bytes, not a path', () => {
    const attachment = {
      kind: 'context',
      source: 'drag',
      target: {
        kind: 'file',
        token: '',
        label: 'shot.png',
        attributes: { mediaId: 'm1', name: 'shot.png' },
      },
    } as MessageContextBindingDraft
    expect(contentOfLink(attachment)).toMatchObject({ type: 'ref', props: { kind: 'file' } })
  })

  test('a kind a newer build adds still lands, as a plain link', () => {
    const future = {
      kind: 'context',
      source: 'drag',
      target: { kind: 'dashboard', token: '@dashboard:x', label: 'KPIs' },
    } as unknown as MessageContextBindingDraft
    const content = contentOfLink(future)
    expect(content?.kind === 'element' && spaceTypes.read('ref', content.props, 1).status).toBe(
      'ok',
    )
  })
})

describe('app links written as text', () => {
  test('a paste of nothing but links is those things; words around them make a note', async () => {
    const links = incomingFromPaste(pasted('@session:LOCALIX-42 localix://resource/git/abc'))
    expect(links.map((item) => (item.kind === 'link' ? item.link.target.kind : item.kind))).toEqual(
      ['session', 'resource'],
    )
    const ops = await opsFor(links, { x: 0, y: 0 }, 's', emptySpace())
    expect(ops.map((op) => op.op === 'create' && op.type)).toEqual(['ref', 'ref'])
    expect(incomingFromPaste(pasted('look at @session:LOCALIX-42'))).toEqual([
      { kind: 'text', text: 'look at @session:LOCALIX-42' },
    ])
  })

  test('a pasted @file: link is the file card, as a dragged file row is', async () => {
    const ops = await opsFor(
      incomingFromPaste(pasted('@file:src/a.ts')),
      { x: 0, y: 0 },
      's',
      emptySpace(),
    )
    expect(ops[0]).toMatchObject({ op: 'create', type: 'file', props: { path: 'src/a.ts' } })
  })
})

describe('a drop from a source that only allows moving', () => {
  test('is taken with an effect the source allows', () => {
    expect(dropEffectFor('copy')).toBe('copy')
    expect(dropEffectFor('uninitialized')).toBe('copy')
    expect(dropEffectFor('copyMove')).toBe('copy')
    // An editor tab arms its link on its own reorder gesture.
    expect(dropEffectFor('move')).toBe('move')
    expect(dropEffectFor('link')).toBe('link')
  })
})
