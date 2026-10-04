import { describe, test } from 'bun:test'
import { expectNoRawOwners } from '@localixai/kit/testing/ownership-contract'

const SRC_ROOT = new URL('../../', import.meta.url).pathname
const TARGET_BLANK = new RegExp(
  ['target', String.raw`\s*=\s*(?:["']_blank["']|\{\s*["']_blank["']\s*\})`].join(''),
)

describe('external navigation boundary', () => {
  test('routes every JSX new-tab link through ExternalAnchor', async () => {
    const offenders: string[] = []
    for (const path of new Bun.Glob('**/*.tsx').scanSync({ cwd: SRC_ROOT })) {
      if (path === 'shared/ui/external-anchor.tsx') continue
      const source = await Bun.file(`${SRC_ROOT}/${path}`).text()
      if (TARGET_BLANK.test(source)) offenders.push(path)
    }

    expectNoRawOwners(offenders, 'a target="_blank"')
  })
})
