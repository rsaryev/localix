import { describe, expect, test } from 'bun:test'
import { cameraCommand, PAN_STEP, type CameraKeyEvent } from './keyboard'

const press = (key: string, extra: Partial<CameraKeyEvent> = {}): CameraKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
})

describe('camera keys', () => {
  test('arrows move the view opposite to the world, Shift further', () => {
    expect(cameraCommand(press('ArrowRight'))).toEqual({ kind: 'pan', dx: -PAN_STEP.small, dy: 0 })
    expect(cameraCommand(press('ArrowUp', { shiftKey: true }))).toEqual({
      kind: 'pan',
      dx: 0,
      dy: PAN_STEP.large,
    })
  })

  test('plus and minus step the zoom, typed with or without Shift', () => {
    expect(cameraCommand(press('='))).toEqual({ kind: 'zoom', direction: 1 })
    expect(cameraCommand(press('+', { shiftKey: true }))).toEqual({ kind: 'zoom', direction: 1 })
    expect(cameraCommand(press('-'))).toEqual({ kind: 'zoom', direction: -1 })
  })

  test('Shift+digit is read from the physical key, whatever the layout types', () => {
    // A US layout types `!` for Shift+1, a French one `1`, a German one `!` too — `code` is stable.
    expect(cameraCommand(press('!', { shiftKey: true, code: 'Digit1' }))).toEqual({ kind: 'fit' })
    expect(cameraCommand(press('1', { shiftKey: true, code: 'Digit1' }))).toEqual({ kind: 'fit' })
    expect(cameraCommand(press('@', { shiftKey: true, code: 'Digit2' }))).toEqual({
      kind: 'fit-selection',
    })
    expect(cameraCommand(press(')', { shiftKey: true, code: 'Digit0' }))).toEqual({
      kind: 'actual-size',
    })
    expect(cameraCommand(press('1', { code: 'Digit1' }))).toBeNull()
  })

  test('a key with Alt, Ctrl or Meta belongs to the app, not the camera', () => {
    expect(cameraCommand(press('ArrowUp', { altKey: true }))).toBeNull()
    expect(cameraCommand(press('=', { metaKey: true }))).toBeNull()
    expect(cameraCommand(press('-', { ctrlKey: true }))).toBeNull()
  })
})
