import { expect, test } from 'bun:test'
import { DockerApiError } from '../dockerApi'
import { dockerActionIssue } from './useDockerSidebarActions'

test("the classified sentence and the engine's own words stay apart", () => {
  // They used to be joined with ": ", which is how a canvas strip ended up carrying a full
  // `dial unix …: connect: no such file or directory`. The sentence goes on the line; the raw
  // text goes to the Event Center, where there is room to read it.
  expect(
    dockerActionIssue(new DockerApiError('Could not remove image', 'engine_error', 'in use')),
  ).toEqual({ code: 'engine_error', message: 'Could not remove image', detail: 'in use' })
})

test('a plain error keeps its message, an untrusted shape gets a sentence', () => {
  expect(dockerActionIssue(new Error('permission denied')).message).toBe('permission denied')
  expect(dockerActionIssue({ message: 'untrusted shape' }).message).toBe(
    'The container action did not complete.',
  )
})
