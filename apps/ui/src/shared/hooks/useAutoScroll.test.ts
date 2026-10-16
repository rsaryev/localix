import { describe, expect, it } from 'bun:test'

import {
  bottomScrollTop,
  contentChangeAction,
  isNearBottom,
  needsBottomScroll,
  shouldScheduleBottomReapply,
} from './useAutoScroll'

describe('bottomScrollTop', () => {
  it('captures the clamped browser landing position from one geometry snapshot', () => {
    expect(bottomScrollTop(1_200, 300)).toBe(900)
    expect(bottomScrollTop(200, 300)).toBe(0)
  })
})

describe('shouldScheduleBottomReapply', () => {
  it('coalesces auto-scroll verification frames and skips smooth scrolling', () => {
    expect(shouldScheduleBottomReapply('auto', false)).toBe(true)
    expect(shouldScheduleBottomReapply('auto', true)).toBe(false)
    expect(shouldScheduleBottomReapply('smooth', false)).toBe(false)
  })
})

describe('needsBottomScroll', () => {
  it('skips writes inside the browser landing tolerance', () => {
    expect(needsBottomScroll(900, 900)).toBe(false)
    expect(needsBottomScroll(899, 900)).toBe(false)
    expect(needsBottomScroll(898, 900)).toBe(true)
  })
})

describe('contentChangeAction', () => {
  it('uses one same-frame scroll while pinned instead of scheduling a duplicate', () => {
    expect(contentChangeAction(true, false, false)).toBe('scroll-now')
  })

  it('schedules one retry while pinned scrolling is temporarily blocked', () => {
    expect(contentChangeAction(true, true, false)).toBe('schedule-frame')
    expect(contentChangeAction(true, true, true)).toBe('none')
  })

  it('never re-pins an explicit reader just because streamed content grew', () => {
    expect(contentChangeAction(false, false, false)).toBe('none')
    expect(contentChangeAction(false, true, false)).toBe('none')
  })
})

describe('isNearBottom', () => {
  it('treats small distances as pinned to the latest content', () => {
    expect(isNearBottom(0)).toBe(true)
    expect(isNearBottom(40)).toBe(true)
    expect(isNearBottom(80)).toBe(true)
  })

  it('stops auto-scroll once the user is meaningfully away from the tail', () => {
    expect(isNearBottom(81)).toBe(false)
    expect(isNearBottom(240)).toBe(false)
  })
})
