import { expect, test } from 'bun:test'
import { toModelMessages } from './chat'
import { isWireCarriableImage, withToolImages } from './model-attachments'

test('MIME eligibility remains case insensitive while wire attachment parts keep exact matching', () => {
  expect(isWireCarriableImage('IMAGE/PNG')).toBe(true)
  const wire = toModelMessages([
    {
      id: 'message',
      role: 'user',
      content: '',
      bindings: [
        { kind: 'image', mediaType: 'IMAGE/PNG', data: 'QUJD', name: 'image.png', size: 3 },
      ],
    },
  ])
  const user = wire.find((message) => message.role === 'user')!
  expect(user.content).toEqual([
    { type: 'file', mediaType: 'IMAGE/PNG', data: 'QUJD', filename: 'image.png' },
  ])
  expect(
    withToolImages('result', [
      { kind: 'image', mediaType: 'IMAGE/PNG', data: 'QUJD', name: 'image.png', size: 3 },
    ]),
  ).toEqual([
    { type: 'text', text: 'result' },
    { type: 'text', text: '[The image this tool returned is not included in this request.]' },
  ])
})
