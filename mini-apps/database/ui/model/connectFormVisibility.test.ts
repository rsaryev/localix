import { describe, expect, test } from 'bun:test'
import { shouldShowConnectForm } from './connectFormVisibility'

describe('shouldShowConnectForm', () => {
  test('a genuinely empty account gets the form', () => {
    // The reverse direction, and the reason the rule can't just be "never auto-open":
    // a real first-time user must land straight in the form. If this ever goes red, the
    // fix below has over-reached and onboarding is broken.
    expect(
      shouldShowConnectForm({ adding: false, loading: false, connectionCount: 0, listError: null }),
    ).toBe(true)
  })

  test('an IN-FLIGHT list does not get the form', () => {
    // The flash bug: before the mount fetch resolves the list is empty AND listError is
    // still null, so a user WITH saved connections saw the full form on every mount.
    expect(
      shouldShowConnectForm({ adding: false, loading: true, connectionCount: 0, listError: null }),
    ).toBe(false)
  })

  test('a FAILED list does not get the form', () => {
    // The bug: empty-because-we-never-heard-back is indistinguishable from empty-because-
    // none-exist, so the sidebar asked for credentials the user had already saved.
    expect(
      shouldShowConnectForm({
        adding: false,
        loading: false,
        connectionCount: 0,
        listError: 'offline',
      }),
    ).toBe(false)
  })

  test('an explicit "add" click wins even while the list is failing', () => {
    expect(
      shouldShowConnectForm({
        adding: true,
        loading: false,
        connectionCount: 0,
        listError: 'offline',
      }),
    ).toBe(true)
  })

  test('an explicit "add" click wins even while the list is loading', () => {
    expect(
      shouldShowConnectForm({ adding: true, loading: true, connectionCount: 0, listError: null }),
    ).toBe(true)
  })

  test('an account with connections shows the list, not the form', () => {
    expect(
      shouldShowConnectForm({ adding: false, loading: false, connectionCount: 2, listError: null }),
    ).toBe(false)
  })
})
