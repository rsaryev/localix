/**
 * The permission class of every `api_client` call shape. A wrong row here is a session mode
 * that lets a `DELETE` through as a read, or refuses a `list` as a write.
 */

import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyApiClientCall } from './api-tool'
import { classifyEnvironmentCall, classifyHttpRequestCall } from './call-class'

const READ: CallClass = { effect: 'read' }
const FILES: CallClass = { effect: 'files' }
const FILES_GONE: CallClass = { effect: 'files', irreversible: true }
const EXTERNAL: CallClass = { effect: 'external' }
const EXTERNAL_GONE: CallClass = { effect: 'external', irreversible: true }

describe('classifyHttpRequestCall', () => {
  const rows: Array<[string, unknown, CallClass]> = [
    ['list', { action: 'list' }, READ],
    ['get', { action: 'get', name: 'x' }, READ],
    ['send GET', { action: 'send', url: 'https://a.dev', method: 'get' }, READ],
    ['send HEAD', { action: 'send', url: 'https://a.dev', method: 'HEAD' }, READ],
    ['send without a method or name', { action: 'send', url: 'https://a.dev' }, READ],
    ['send POST', { action: 'send', url: 'https://a.dev', method: 'POST' }, EXTERNAL],
    ['send PATCH', { action: 'send', url: 'https://a.dev', method: 'PATCH' }, EXTERNAL],
    ['send DELETE', { action: 'send', url: 'https://a.dev', method: 'DELETE' }, EXTERNAL_GONE],
    // The stored method is unknown before the store is read — it may be DELETE.
    ['send a saved request, no method', { action: 'send', name: 'drop-user' }, EXTERNAL_GONE],
    ['send a saved request as GET', { action: 'send', name: 'drop-user', method: 'GET' }, READ],
    ['save', { action: 'save', name: 'x', url: 'https://a.dev' }, FILES],
    ['export', { action: 'export' }, FILES],
    ['delete', { action: 'delete', name: 'x' }, FILES_GONE],
    ['import preview', { action: 'import', source: 'curl https://a.dev' }, READ],
    ['import save:true', { action: 'import', source: 'curl https://a.dev', save: true }, FILES],
    ['unknown action', { action: 'purge' }, EXTERNAL],
    ['no input', undefined, EXTERNAL],
  ]
  test.each(rows)('%s', (_label, input, expected) => {
    expect(classifyHttpRequestCall(input)).toEqual(expected)
  })
})

describe('classifyEnvironmentCall', () => {
  const rows: Array<[string, unknown, CallClass]> = [
    ['list', { action: 'list' }, READ],
    ['get', { action: 'get', name: 'dev' }, READ],
    ['save', { action: 'save', name: 'dev', variables: [] }, FILES],
    ['use', { action: 'use', name: 'dev' }, FILES],
    ['delete', { action: 'delete', name: 'dev' }, FILES_GONE],
    ['unknown action', { action: 'wipe' }, EXTERNAL],
    ['no input', null, EXTERNAL],
  ]
  test.each(rows)('%s', (_label, input, expected) => {
    expect(classifyEnvironmentCall(input)).toEqual(expected)
  })
})

describe('classifyApiClientCall', () => {
  const rows: Array<[string, unknown, CallClass]> = [
    ['request list', { action: 'list' }, READ],
    ['environment use', { action: 'use', target: 'environment', name: 'dev' }, FILES],
    ['environment delete', { action: 'delete', target: 'environment', name: 'dev' }, FILES_GONE],
    ['request DELETE', { action: 'send', url: 'https://a.dev', method: 'DELETE' }, EXTERNAL_GONE],
    [
      'batch of reads',
      { action: 'batch', operations: [{ action: 'list' }, { action: 'get', name: 'x' }] },
      READ,
    ],
    [
      'batch hiding a DELETE behind a read',
      {
        action: 'batch',
        operations: [{ action: 'list' }, { action: 'send', url: 'https://a', method: 'DELETE' }],
      },
      EXTERNAL_GONE,
    ],
    [
      'batch mixing files and reads',
      { action: 'batch', operations: [{ action: 'list' }, { action: 'save', name: 'x' }] },
      FILES,
    ],
    ['empty batch', { action: 'batch', operations: [] }, EXTERNAL],
    ['batch with a non-object operation', { action: 'batch', operations: ['list'] }, EXTERNAL],
    ['unknown action', { action: 'nuke' }, EXTERNAL],
  ]
  test.each(rows)('%s', (_label, input, expected) => {
    expect(classifyApiClientCall(input)).toEqual(expected)
  })
})
