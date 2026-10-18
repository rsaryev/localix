import { expect, test } from 'bun:test'
import { nativePageRendererLease } from './nativePageRendererLease'

test('a page reopened after it was closed can be closed again', () => {
  const tabId = 'reopened-page'
  try {
    expect(nativePageRendererLease.retire(tabId)).not.toBeNull()
    expect(nativePageRendererLease.retire(tabId)).toBeNull()
    nativePageRendererLease.revive(tabId)
    expect(nativePageRendererLease.retire(tabId)).not.toBeNull()
  } finally {
    nativePageRendererLease.forget(tabId)
  }
})

test('a page is held while its tab is mounted, shown or not', () => {
  const tabId = 'mounted-page'
  try {
    expect(nativePageRendererLease.mounted(tabId)).toBe(false)
    const lease = nativePageRendererLease.claim(tabId)
    expect(nativePageRendererLease.mounted(tabId)).toBe(true)
    nativePageRendererLease.release(tabId, lease)
    expect(nativePageRendererLease.mounted(tabId)).toBe(false)
  } finally {
    nativePageRendererLease.forget(tabId)
  }
})
