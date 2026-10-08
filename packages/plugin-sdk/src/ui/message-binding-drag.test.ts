import { describe, expect, test } from 'bun:test'

import {
  MESSAGE_BINDING_DRAG_MAX_BYTES,
  MESSAGE_BINDING_DRAG_VERSION,
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  MESSAGE_BINDING_MIME,
  type MessageBindingDragKind,
  composerDropHint,
  createMessageBindingDraft,
  messageBindingDragKind,
  OS_FILES_DRAG_KIND,
  promptHasToken,
  readMessageBindingDrag,
  setMessageBindingDrag,
} from './message-binding-drag'

function fakeDataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'uninitialized',
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types() {
      return [...store.keys()]
    },
  } as unknown as DataTransfer & { types: string[] }
}

/** A transport whose custom-MIME data reads back EMPTY while the type is still
 *  advertised — the WebView behaviour the in-memory fallback exists for. */
function amnesiacDataTransfer(types: readonly string[]) {
  return {
    setData: () => undefined,
    getData: () => '',
    types: [...types],
  } as unknown as DataTransfer
}

/** Write a hand-built envelope the way a hostile or stale producer would. */
function withRawPayload(payload: unknown): DataTransfer {
  const dataTransfer = fakeDataTransfer()
  dataTransfer.setData(MESSAGE_BINDING_MIME, JSON.stringify(payload))
  return dataTransfer
}

const validEnvelope = {
  kind: 'context',
  version: MESSAGE_BINDING_DRAG_VERSION,
  source: 'drag',
  target: { kind: 'file', token: '@src/a.ts', label: 'a.ts', attributes: { path: 'src/a.ts' } },
}

describe('message-binding drag transport', () => {
  test('advertises the target kind and round-trips the canonical draft', () => {
    const dataTransfer = fakeDataTransfer()
    const binding = createMessageBindingDraft('call', 'tc_1', 'Read file')
    setMessageBindingDrag(dataTransfer, binding)
    expect(dataTransfer.types).toContain(MESSAGE_BINDING_MIME)
    expect(dataTransfer.types).toContain(`${MESSAGE_BINDING_KIND_MIME_PREFIX}call`)
    expect(messageBindingDragKind(dataTransfer.types)).toBe('call')
    expect(readMessageBindingDrag(dataTransfer)).toEqual(binding)
  })

  test('uses one compact labeled drag preview for every binding kind', () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const dragElement = {
      textContent: '',
      style: { cssText: '' },
      remove: () => undefined,
    }
    let captured: { element: Element; x: number; y: number } | null = null
    const dataTransfer = Object.assign(fakeDataTransfer(), {
      setDragImage: (element: Element, x: number, y: number) => {
        captured = { element, x, y }
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => dragElement,
        body: { appendChild: () => dragElement },
      } as unknown as Document,
    })

    try {
      setMessageBindingDrag(
        dataTransfer,
        createMessageBindingDraft(
          'resource',
          'localix://resource/vault/items/OPENAI_KEY',
          'OpenAI key',
        ),
      )
    } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else Reflect.deleteProperty(globalThis, 'document')
    }

    expect(dragElement.textContent).toBe('OpenAI key')
    expect(captured).toMatchObject({ x: 12, y: 14 })
  })

  test('every binding target kind advertises itself', () => {
    const kinds: MessageBindingDragKind[] = [
      'file',
      'session',
      'project',
      'message',
      'terminal',
      'call',
      'resource',
      'snippet',
    ]
    for (const kind of kinds) {
      const dataTransfer = fakeDataTransfer()
      setMessageBindingDrag(dataTransfer, createMessageBindingDraft(kind, 'x'))
      expect(messageBindingDragKind(dataTransfer.types)).toBe(kind)
      expect(composerDropHint(kind)).not.toBe('Link to message')
    }
  })

  test('snippet content and language stay inside target attributes', () => {
    const dataTransfer = fakeDataTransfer()
    const binding = createMessageBindingDraft('snippet', 'Output', 'Output', {
      content: 'row 1\nrow 2',
      language: 'text',
    })
    setMessageBindingDrag(dataTransfer, binding)
    expect(readMessageBindingDrag(dataTransfer)).toEqual(binding)
  })

  test('old or unrelated MIME types are not accepted', () => {
    expect(messageBindingDragKind(['application/x-localix-agent-ref'])).toBeNull()
    expect(messageBindingDragKind(['Files', 'text/plain'])).toBeNull()
    expect(messageBindingDragKind([MESSAGE_BINDING_MIME])).toBe('binding')
  })

  test('the drag effect is claimed only when the source has not chosen one', () => {
    const unclaimed = fakeDataTransfer()
    setMessageBindingDrag(unclaimed, createMessageBindingDraft('file', 'src/a.ts'))
    expect(unclaimed.effectAllowed).toBe('copy')

    // A tab-strip / list-reorder drag arms this binding on top of its own reorder move.
    const reorder = Object.assign(fakeDataTransfer(), { effectAllowed: 'move' })
    setMessageBindingDrag(reorder, createMessageBindingDraft('terminal', 'term-1', 'Shell'))
    expect(reorder.effectAllowed).toBe('move')
  })

  test('text/plain rides along only when the producer asks for it', () => {
    const silent = fakeDataTransfer()
    setMessageBindingDrag(silent, createMessageBindingDraft('file', 'src/a.ts'))
    expect(silent.types).not.toContain('text/plain')

    const opted = fakeDataTransfer()
    setMessageBindingDrag(opted, createMessageBindingDraft('file', 'src/a.ts'), {
      plainText: '@src/a.ts',
    })
    expect(opted.getData('text/plain')).toBe('@src/a.ts')
  })
})

describe('message-binding drag payload validation', () => {
  test('a payload from another schema version is refused', () => {
    expect(readMessageBindingDrag(withRawPayload({ ...validEnvelope }))).not.toBeNull()
    expect(readMessageBindingDrag(withRawPayload({ ...validEnvelope, version: 2 }))).toBeNull()
    const unversioned: Record<string, unknown> = { ...validEnvelope }
    delete unversioned.version
    expect(readMessageBindingDrag(withRawPayload(unversioned))).toBeNull()
  })

  test('a hostile payload is refused rather than cast', () => {
    const target = validEnvelope.target
    const refused: unknown[] = [
      'not-an-object',
      { ...validEnvelope, source: 'evil' },
      { ...validEnvelope, target: { ...target, kind: 'shell-command' } },
      { ...validEnvelope, target: { ...target, token: 'x'.repeat(4097) } },
      { ...validEnvelope, target: { ...target, label: 'x'.repeat(513) } },
      { ...validEnvelope, target: { ...target, uri: 'x'.repeat(4097) } },
      { ...validEnvelope, target: { kind: 'resource', token: '@resource:x', label: 'x' } },
      { ...validEnvelope, target: { ...target, attributes: { nested: { deep: { deeper: 1 } } } } },
      { ...validEnvelope, target: { ...target, attributes: { path: ['a', 'b'] } } },
      { ...validEnvelope, target: { ...target, attributes: { size: Number.POSITIVE_INFINITY } } },
      { ...validEnvelope, target: { ...target, attributes: { ['k'.repeat(65)]: 'v' } } },
      // A computed key, so this is an OWN property rather than the literal's
      // prototype setter — exactly how it survives a JSON round-trip.
      { ...validEnvelope, target: { ...target, attributes: { ['__proto__']: 'polluted' } } },
      {
        ...validEnvelope,
        target: {
          ...target,
          attributes: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 'v'])),
        },
      },
      { ...validEnvelope, target: { kind: 'snippet', token: '', label: 'Output' } },
    ]
    for (const payload of refused) {
      expect(readMessageBindingDrag(withRawPayload(payload))).toBeNull()
    }
  })

  test('a valid payload is rebuilt from known fields, dropping smuggled ones', () => {
    const dataTransfer = withRawPayload({
      ...validEnvelope,
      injected: 'ignored',
      target: { ...validEnvelope.target, injected: 'ignored' },
    })
    expect(readMessageBindingDrag(dataTransfer)).toEqual({
      kind: 'context',
      source: 'drag',
      target: {
        kind: 'file',
        token: '@src/a.ts',
        label: 'a.ts',
        attributes: { path: 'src/a.ts' },
      },
    })
  })

  // A dragged plugin tab brings its plugin's tools to the turn, so its owner survives the drop —
  // and only as a plugin name.
  test('the owner of a dragged plugin tab survives the drop; a malformed one is dropped', () => {
    expect(
      readMessageBindingDrag(withRawPayload({ ...validEnvelope, plugin: 'fixture-board' })),
    ).toMatchObject({
      plugin: 'fixture-board',
    })
    expect(
      readMessageBindingDrag(withRawPayload({ ...validEnvelope, plugin: '../../etc' })),
    ).not.toHaveProperty('plugin')
  })

  test('an oversized payload is never armed and never read back', () => {
    const dataTransfer = fakeDataTransfer()
    const binding = createMessageBindingDraft('snippet', 'Huge', 'Huge', {
      content: 'x'.repeat(MESSAGE_BINDING_DRAG_MAX_BYTES + 1),
    })
    setMessageBindingDrag(dataTransfer, binding)
    expect(dataTransfer.types).toEqual([])
    expect(readMessageBindingDrag(dataTransfer)).toBeNull()

    // Also refused when it arrives from somewhere that did not go through the writer.
    const oversized = withRawPayload({
      ...validEnvelope,
      target: {
        kind: 'snippet',
        token: '',
        label: 'Huge',
        attributes: { content: 'x'.repeat(MESSAGE_BINDING_DRAG_MAX_BYTES + 1) },
      },
    })
    expect(readMessageBindingDrag(oversized)).toBeNull()
  })

  test('an empty getData falls back to the in-flight payload only for our own MIME', () => {
    const binding = createMessageBindingDraft('call', 'tc_1', 'Read file')
    setMessageBindingDrag(fakeDataTransfer(), binding)

    expect(readMessageBindingDrag(amnesiacDataTransfer([MESSAGE_BINDING_MIME]))).toEqual(binding)
    expect(readMessageBindingDrag(amnesiacDataTransfer(['text/plain', 'Files']))).toBeNull()
  })
})

describe('composerDropHint', () => {
  test('describes uploads, known bindings, future kinds, and junk', () => {
    expect(composerDropHint(OS_FILES_DRAG_KIND)).toBe('Drop files to attach')
    expect(composerDropHint('call')).toBe('Link tool call to message')
    expect(composerDropHint('task')).toBe('Link task to message')
    expect(composerDropHint('snippet')).toBe('Attach snippet to message')
    expect(composerDropHint('my-thing')).toBe('Link my thing to message')
    expect(composerDropHint('WeIrD<js>')).toBe('Link to message')
  })
})

describe('promptHasToken', () => {
  test('matches only whole tokens and can skip an embedded occurrence', () => {
    expect(promptHasToken('see @src/a.ts here', '@src/a.ts')).toBe(true)
    expect(promptHasToken('see @src/a.ts.bak here', '@src/a.ts')).toBe(false)
    expect(promptHasToken('@src/a.ts.bak and @src/a.ts', '@src/a.ts')).toBe(true)
    expect(promptHasToken('x@src/a.ts', '@src/a.ts')).toBe(false)
    expect(promptHasToken('anything', '')).toBe(false)
  })
})

test('a legacy mixed tab payload is rejected before reading or showing link targets', () => {
  const transfer = fakeDataTransfer()
  const binding = createMessageBindingDraft('session', 'conversation', 'Conversation')
  setMessageBindingDrag(transfer, binding)
  transfer.setData('application/x-localix-tab', 'chat:conversation')
  expect(messageBindingDragKind(transfer.types)).toBeNull()
  expect(readMessageBindingDrag(transfer)).toBeNull()
})
