import { expect, test } from 'bun:test'
import { act } from 'react'

test('UI tests load the React test bundle even when production mode is inherited', () => {
  expect(process.env.NODE_ENV).toBe('test')
  expect(typeof act).toBe('function')
})
