import { describe, expect, test } from 'bun:test'
import type { MessageAttachment } from '@/shared/api/contracts'
import { attachmentRenderKind, isFigureRender } from './attachmentRender'

const image: MessageAttachment = {
  kind: 'image',
  mediaType: 'image/png',
  data: 'x',
  name: 'a.png',
  size: 1,
}
const video: MessageAttachment = {
  kind: 'video',
  mediaType: 'video/mp4',
  data: 'x',
  name: 'v.mp4',
  size: 1,
}
const file: MessageAttachment = {
  kind: 'file',
  mediaType: 'application/pdf',
  data: 'x',
  name: 'd.pdf',
  size: 1,
}
const audio: MessageAttachment = {
  kind: 'audio',
  mediaType: 'audio/webm',
  data: 'x',
  name: 'voice.webm',
  size: 1,
}
const text: MessageAttachment = { kind: 'text', name: 't.txt', text: 'hi', size: 1 }

describe('attachmentRenderKind', () => {
  test('every image is a figure, whoever produced it', () => {
    expect(attachmentRenderKind(image)).toBe('image')
    expect(isFigureRender(attachmentRenderKind(image))).toBe(true)
  })
  test('video → figure', () => {
    expect(attachmentRenderKind(video)).toBe('video')
  })
  test('audio → voice bubble', () => {
    expect(attachmentRenderKind(audio)).toBe('audio')
  })
  test('file → generic chip', () => {
    expect(attachmentRenderKind(file)).toBe('file')
  })
  test('text → generic chip', () => {
    expect(attachmentRenderKind(text)).toBe('text')
  })
})

describe('render-kind predicates', () => {
  test('figures are images + videos; everything else is a chip', () => {
    expect(isFigureRender('image')).toBe(true)
    expect(isFigureRender('video')).toBe(true)
    expect(isFigureRender('audio')).toBe(false)
    expect(isFigureRender('file')).toBe(false)
    expect(isFigureRender('text')).toBe(false)
  })
})
