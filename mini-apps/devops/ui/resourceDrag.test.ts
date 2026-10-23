import { describe, expect, test } from 'bun:test'

import {
  MESSAGE_BINDING_MIME,
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  messageBindingDragKind,
  readMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { setDevOpsResourceDrag } from './resourceDrag'

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'uninitialized',
    get types() {
      return [...values.keys()]
    },
    setData(type: string, value: string) {
      values.set(type, value)
    },
    getData(type: string) {
      return values.get(type) ?? ''
    },
  } as unknown as DataTransfer
}

describe('DevOps resource drag', () => {
  test('writes the structured composer binding and a portable text fallback', () => {
    const transfer = fakeDataTransfer()
    setDevOpsResourceDrag(transfer, {
      uri: 'localix://resource/docker/image/sha256%3Aabc',
      label: 'api:latest',
    })

    expect(transfer.effectAllowed).toBe('copy')
    expect(transfer.getData('text/plain')).toBe(
      '@resource:localix://resource/docker/image/sha256%3Aabc',
    )
    expect(transfer.getData(`${MESSAGE_BINDING_KIND_MIME_PREFIX}resource`)).toBe('resource')
    expect(messageBindingDragKind(transfer.types)).toBe('resource')
    expect(readMessageBindingDrag(transfer)?.target.uri).toBe(
      'localix://resource/docker/image/sha256%3Aabc',
    )
    expect(JSON.parse(transfer.getData(MESSAGE_BINDING_MIME))).toMatchObject({
      kind: 'context',
      source: 'drag',
      target: {
        kind: 'resource',
        token: '@resource:localix://resource/docker/image/sha256%3Aabc',
        uri: 'localix://resource/docker/image/sha256%3Aabc',
        label: 'api:latest',
      },
    })
  })
})
