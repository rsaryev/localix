import { describe, expect, test } from 'bun:test'
import workItemFocusSurface from '@/entities/workspace-grid/WorkItemFocus.surface'
import fileSurface from '@/features/inspector/ui/FileTab.surface'
import { GLOBAL_SCOPE } from '@/entities/workspace-grid/model/scope'
import { makeLeaf } from '@/entities/workspace-grid/model/tree'
import { CORE_WORK_ITEM_KINDS, type WorkItem } from '@/shared/lib/workItem'
import {
  CORE_WORK_ITEM_ADDRESSABILITY,
  resolveExistingWorkItemFocus,
  workItemAddressability,
} from '@/entities/workspace-grid/model/workItemAddressability'

describe('core WorkItem addressability metadata', () => {
  test('publishes one read-only runtime location in the canonical Localix namespace', () => {
    expect(workItemFocusSurface).toMatchObject({
      id: 'work-item.focus',
      uri: 'localix://ui/work-item/focus',
      effect: 'read',
      surface: 'work-item',
      agent: {
        description: 'Focus an existing workspace tab when its live tab id is already known.',
        availability: 'runtime',
      },
      exposure: { search: false, palette: false },
      params: { id: { type: 'string' } },
    })
  })

  test('opens files directly through typed Localix locations', () => {
    expect(fileSurface.uri).toBe('localix://ui/work-item/file')
    expect(fileSurface.resolve({ path: 'src/main.ts', line: 42 })).toEqual({
      kind: 'file',
      path: 'src/main.ts',
      line: 42,
    })
  })

  test('covers the single source-of-truth core vocabulary exactly', () => {
    expect(Object.keys(CORE_WORK_ITEM_ADDRESSABILITY).sort()).toEqual(
      [...CORE_WORK_ITEM_KINDS].sort(),
    )
  })

  test('keeps the generic runtime view bridge directly addressable', () => {
    expect(workItemAddressability('mini-app-view')).toEqual({
      mode: 'direct',
      owner: 'runtime mini-app-view location',
    })
  })

  test('gives contributed tables and custom mini app kinds the payload-free focus fallback', () => {
    for (const kind of ['table', 'vendor:custom-editor']) {
      expect(workItemAddressability(kind)).toEqual({
        mode: 'focus-existing',
        locationId: 'work-item.focus',
        reason: 'Mini-app-owned payloads remain with the mounted contribution.',
      })
    }
  })
})

describe('existing WorkItem focus resolution', () => {
  const item: WorkItem = {
    kind: 'mini-app-view',
    id: 'mini-app-view:call-1',
    title: 'View result',
    scope: 'session-a',
    payload: { html: '<private-payload>' },
  }

  test('resolves an exact mounted tab without returning its payload', () => {
    expect(
      resolveExistingWorkItemFocus(
        {
          root: makeLeaf('group-1', [item.id]),
          items: { [item.id]: item },
          activeScope: 'session-a',
        },
        item.id,
      ),
    ).toEqual({ kind: 'work-item-focus', id: item.id })
  })

  test('fails closed for missing, detached, and background-scope tabs', () => {
    expect(
      resolveExistingWorkItemFocus(
        {
          root: makeLeaf('group-1'),
          items: {},
          activeScope: 'session-a',
        },
        item.id,
      ),
    ).toBeNull()

    expect(
      resolveExistingWorkItemFocus(
        {
          root: makeLeaf('group-1'),
          items: { [item.id]: item },
          activeScope: 'session-a',
        },
        item.id,
      ),
    ).toBeNull()

    expect(
      resolveExistingWorkItemFocus(
        {
          root: makeLeaf('group-1', [item.id]),
          items: { [item.id]: item },
          activeScope: 'session-b',
        },
        item.id,
      ),
    ).toBeNull()
  })

  test('allows global tabs in every active scope', () => {
    const globalItem = { ...item, id: 'mini-app:panel', scope: GLOBAL_SCOPE }
    expect(
      resolveExistingWorkItemFocus(
        {
          root: makeLeaf('group-1', [globalItem.id]),
          items: { [globalItem.id]: globalItem },
          activeScope: 'session-b',
        },
        globalItem.id,
      ),
    ).toEqual({ kind: 'work-item-focus', id: globalItem.id })
  })
})
