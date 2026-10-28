import { describe, test, expect } from 'bun:test'
import { applyOutputFilters } from './index'
import { neverWorse } from './never-worse'
import { splitTrailingMarkers } from './markers'
import { bunTestFilter } from './runners/bun'
import { cargoTestFilter } from './runners/cargo'
import { pytestFilter } from './runners/pytest'
import { goTestFilter } from './runners/go'
import { jestFilter, vitestFilter } from './runners/jest-vitest'
import { tscFilter } from './runners/tsc'
import { eslintFilter } from './runners/eslint'
import { installFilter } from './runners/install'
import { buildFilter } from './runners/build'

const pad = (n: number, line = 'noise line from a console.log in a test body') =>
  Array.from({ length: n }, (_, i) => `${line} ${i}`).join('\n')

// ── fixtures (captured from real runs) ──────────────

const BUN_PASS = `bun test v1.3.14 (0d9b296a)

src/a.test.ts:
${pad(30)}

 3756 pass
 0 fail
 9261 expect() calls
Ran 3756 tests across 364 files. [56.14s]`

const BUN_FAIL = `bun test v1.3.14 (0d9b296a)

sample.test.ts:
5 |   test('broken multiply', () => { expect(2 * 2).toBe(5) })
                                                    ^
error: expect(received).toBe(expected)

Expected: 5
Received: 4

      at <anonymous> (/tmp/sample.test.ts:5:49)
(fail) math > broken multiply [0.10ms]
(pass) math > adds [0.01ms]
(pass) math > subtracts [0.01ms]
${pad(10)}
(pass) strings > concat [0.01ms]
(fail) strings > broken upper [0.08ms]

 3 pass
 2 fail
 5 expect() calls
Ran 5 tests across 1 file. [6.00ms]`

const CARGO_PASS = `   Compiling failrs v0.1.0
running 2389 tests
${Array.from({ length: 60 }, (_, i) => `test module::test_case_${i} ... ok`).join('\n')}

test result: ok. 2389 passed; 0 failed; 8 ignored; 0 measured; 0 filtered out; finished in 0.81s

running 6 tests
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s`

const CARGO_FAIL = `running 5 tests
test tests::pass_one ... ok
test tests::broken_math ... FAILED
test tests::broken_logic ... FAILED
${pad(10, 'test tests::pass_more ... ok #')}

failures:

---- tests::broken_logic stdout ----

thread 'tests::broken_logic' (2604908) panicked at src/lib.rs:6:33:
logic is broken

---- tests::broken_math stdout ----

thread 'tests::broken_math' (2604909) panicked at src/lib.rs:5:32:
assertion \`left == right\` failed
  left: 2
 right: 3

failures:
    tests::broken_logic
    tests::broken_math

test result: FAILED. 3 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s`

const PYTEST_PASS = `============================= test session starts ==============================
platform darwin -- Python 3.12
collected 34 items

tests/test_a.py ..................                                       [ 52%]
tests/test_b.py ................                                         [100%]
${pad(10)}

============================== 34 passed in 1.23s ==============================`

const PYTEST_FAIL = `============================= test session starts ==============================
collected 34 items

tests/test_a.py ........F.........                                       [ 52%]
${pad(10)}

=================================== FAILURES ===================================
_________________________________ test_broken __________________________________

    def test_broken():
>       assert 1 + 1 == 3
E       assert 2 == 3

tests/test_a.py:12: AssertionError
=========================== short test summary info ============================
FAILED tests/test_a.py::test_broken - assert 2 == 3
========================= 1 failed, 33 passed in 1.30s =========================`

const GO_PASS = `=== RUN   TestAuth
--- PASS: TestAuth (0.00s)
=== RUN   TestParse
--- PASS: TestParse (0.01s)
${pad(20, '=== RUN   TestGen')}
PASS
ok      example.com/pkg1        0.123s
ok      example.com/pkg2        0.456s`

const GO_FAIL = `=== RUN   TestAuth
--- PASS: TestAuth (0.00s)
=== RUN   TestBroken
    main_test.go:15: expected 3, got 2
--- FAIL: TestBroken (0.00s)
${pad(20, '=== RUN   TestGen')}
FAIL
FAIL    example.com/pkg1        0.123s
ok      example.com/pkg2        0.456s`

const JEST_PASS = `PASS src/a.test.ts
PASS src/b.test.ts
${pad(20, 'PASS src/gen.test.ts #')}
Test Suites: 22 passed, 22 total
Tests:       310 passed, 310 total
Snapshots:   0 total
Time:        4.2 s
Ran all test suites.`

const JEST_FAIL = `PASS src/a.test.ts
FAIL src/b.test.ts
  ● math › broken multiply

    expect(received).toBe(expected)

    Expected: 5
    Received: 4

      at Object.<anonymous> (src/b.test.ts:5:20)
${pad(15, 'PASS src/gen.test.ts #')}
Test Suites: 1 failed, 21 passed, 22 total
Tests:       1 failed, 309 passed, 310 total
Time:        4.4 s`

const VITEST_PASS = ` ✓ src/a.test.ts (18 tests) 12ms
 ✓ src/b.test.ts (16 tests) 9ms
${pad(20, ' ✓ src/gen.test.ts (2 tests) 1ms #')}
 Test Files  22 passed (22)
      Tests  310 passed (310)
   Start at  10:00:00
   Duration  1.24s`

const VITEST_FAIL = ` ✓ src/a.test.ts (18 tests) 12ms
 ❯ src/b.test.ts (16 tests | 1 failed) 30ms
   × math > broken multiply
     → expected 4 to be 5

 FAIL  src/b.test.ts > math > broken multiply
AssertionError: expected 4 to be 5
 ❯ src/b.test.ts:5:20
${pad(15, ' ✓ src/gen.test.ts (2 tests) 1ms #')}
 Test Files  1 failed | 21 passed (22)
      Tests  1 failed | 309 passed (310)
   Duration  1.30s`

const TSC_FAIL = `${pad(15, 'file compiled, some cache noise')}
src/a.ts:12:7 - error TS2322: Type 'string' is not assignable to type 'number'.

12   const x: number = 'nope'
         ~
src/b.ts:4:10 - error TS2304: Cannot find name 'foo'.

4   return foo()
           ~~~

Found 2 errors in 2 files.`

const ESLINT_WARN_ONLY = `${pad(24, 'src/x.tsx\n  3:1  warning  Some warning  react-hooks/refs')}

✖ 24 problems (0 errors, 24 warnings)`

const ESLINT_FAIL = `/repo/src/good.tsx
  8:3  warning  Only a warning here  react-hooks/exhaustive-deps

/repo/src/bad.ts
  10:5  error  'x' is not defined  no-undef
  12:1  warning  Missing semicolon  semi

✖ 3 problems (1 error, 2 warnings)
  1 error and 1 warning potentially fixable with the \`--fix\` option.`

const BUN_INSTALL = `bun install v1.3.14 (0d9b296a)
${pad(30, '+ @types/node@20.0.0')}
23 packages installed [219.00ms]
Saved lockfile`

const NPM_INSTALL = `${pad(20, 'npm http fetch GET 200 https://registry.npmjs.org/foo')}
npm warn deprecated har-validator@5.1.5: this library is no longer supported

added 250 packages, and audited 251 packages in 12s

45 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities`

const PNPM_INSTALL = `Progress: resolved 500, reused 480, downloaded 20, added 500, done
${pad(30, '+ react 18.2.0')}
Packages: +500
++++++++++++++++++++++++++++++++++++++++++++++++++++
Done in 4.3s`

const INSTALL_PEER = `${pad(20, 'npm http fetch GET 200 https://registry.npmjs.org/bar')}
npm warn ERESOLVE overriding peer dependency
npm warn While resolving: my-app@1.0.0

added 10 packages in 3s`

const VITE_BUILD = `vite v5.0.10 building for production...
transforming (1) index.html
${pad(20, 'transforming module')}
✓ 234 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.30 kB
dist/assets/index-a1b2c3.css     12.34 kB │ gzip:  3.21 kB
dist/assets/index-d4e5f6.js     143.21 kB │ gzip: 46.10 kB
✓ built in 3.45s`

const TSUP_BUILD = `${pad(15, 'CLI Building entry: src/index.ts')}
CJS dist/index.js     12.30 KB
ESM dist/index.mjs    11.80 KB
DTS dist/index.d.ts    2.10 KB
⚡️ Build success in 1234ms`

const TURBO_BUILD = `${pad(20, '@localixai/ui:build: cache hit, replaying logs abc123')}
@localixai/ui:build: dist/assets/app-x1.js   200.00 kB │ gzip: 60.00 kB

 Tasks:    14 successful, 14 total
Cached:    13 cached, 14 total
  Time:    9.8s`

const VITE_BUILD_FAIL = `vite v5.0.10 building for production...
${pad(20, 'transforming module')}
x Build failed in 820ms
error during build:
[vite]: Rollup failed to resolve import "missing-pkg" from "src/a.ts"
Could not resolve "missing-pkg"`

// ── per-runner: pass → summary only, fail → failures preserved ─────────

describe('bun test filter', () => {
  test('pass-all keeps only header + summary', () => {
    const out = bunTestFilter.filter(BUN_PASS)!
    expect(out).toContain('3756 pass')
    expect(out).toContain('Ran 3756 tests across 364 files.')
    expect(out).not.toContain('noise line')
  })
  test('failures keep names + assertion, drop (pass) lines', () => {
    const out = bunTestFilter.filter(BUN_FAIL)!
    expect(out).toContain('(fail) math > broken multiply')
    expect(out).toContain('(fail) strings > broken upper')
    expect(out).toContain('Expected: 5')
    expect(out).toContain('2 fail')
    expect(out).not.toContain('(pass)')
  })
  test('uncertain shape returns null', () => {
    expect(bunTestFilter.filter('bun test v1.0.0\nsomething went sideways')).toBeNull()
  })
})

describe('cargo test filter', () => {
  test('pass-all keeps only summary lines', () => {
    const out = cargoTestFilter.filter(CARGO_PASS)!
    expect(out).toBe(
      'test result: ok. 2389 passed; 0 failed; 8 ignored; 0 measured; 0 filtered out; finished in 0.81s\n' +
        'test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s',
    )
  })
  test('failures keep panic blocks + failed-test list + summary', () => {
    const out = cargoTestFilter.filter(CARGO_FAIL)!
    expect(out).toContain('---- tests::broken_math stdout ----')
    expect(out).toContain('panicked at src/lib.rs:6:33')
    expect(out).toContain('    tests::broken_math')
    expect(out).toContain('test result: FAILED. 3 passed; 2 failed;')
    expect(out).not.toContain('pass_one ... ok')
  })
})

describe('pytest filter', () => {
  test('pass-all keeps final summary line only', () => {
    expect(pytestFilter.filter(PYTEST_PASS)).toBe(
      '============================== 34 passed in 1.23s ==============================',
    )
  })
  test('failures keep FAILURES section through the end', () => {
    const out = pytestFilter.filter(PYTEST_FAIL)!
    expect(out).toContain('test_broken')
    expect(out).toContain('assert 2 == 3')
    expect(out).toContain('1 failed, 33 passed')
    expect(out).not.toContain('collected 34 items')
  })
})

describe('go test filter', () => {
  test('pass-all keeps package result lines only', () => {
    expect(goTestFilter.filter(GO_PASS)).toBe(
      'ok      example.com/pkg1        0.123s\nok      example.com/pkg2        0.456s',
    )
  })
  test('failures keep FAIL blocks + detail, drop RUN/PASS noise', () => {
    const out = goTestFilter.filter(GO_FAIL)!
    expect(out).toContain('--- FAIL: TestBroken')
    expect(out).toContain('main_test.go:15: expected 3, got 2')
    expect(out).toContain('FAIL    example.com/pkg1')
    expect(out).not.toContain('=== RUN')
    expect(out).not.toContain('--- PASS')
  })
})

describe('jest filter', () => {
  test('pass-all keeps summary lines only', () => {
    const out = jestFilter.filter(JEST_PASS)!
    expect(out).toContain('Tests:       310 passed, 310 total')
    expect(out).not.toContain('PASS src/')
  })
  test('failures keep FAIL suite + ● details', () => {
    const out = jestFilter.filter(JEST_FAIL)!
    expect(out).toContain('FAIL src/b.test.ts')
    expect(out).toContain('● math › broken multiply')
    expect(out).toContain('Expected: 5')
    expect(out).not.toContain('PASS src/a.test.ts')
  })
})

describe('vitest filter', () => {
  test('pass-all keeps summary lines only', () => {
    const out = vitestFilter.filter(VITEST_PASS)!
    expect(out).toContain('Tests  310 passed (310)')
    expect(out).not.toContain('✓ src/a.test.ts')
  })
  test('failures keep × / FAIL blocks, drop ✓ lines', () => {
    const out = vitestFilter.filter(VITEST_FAIL)!
    expect(out).toContain('× math > broken multiply')
    expect(out).toContain('AssertionError: expected 4 to be 5')
    expect(out).not.toContain('✓ src/a.test.ts')
  })
})

describe('tsc filter', () => {
  test('errors keep every error TS line + summary, drop noise', () => {
    const out = tscFilter.filter(TSC_FAIL)!
    expect(out).toContain("error TS2322: Type 'string' is not assignable to type 'number'.")
    expect(out).toContain("error TS2304: Cannot find name 'foo'.")
    expect(out).toContain('Found 2 errors in 2 files.')
    expect(out).not.toContain('cache noise')
    expect(out).not.toContain('~~~')
  })
  test('no error TS line → null (clean/unrecognized run passes through)', () => {
    expect(tscFilter.filter(pad(30, 'tsc --noEmit produced only build chatter'))).toBeNull()
  })
})

describe('eslint filter', () => {
  test('warnings only → collapse to the summary line', () => {
    const out = eslintFilter.filter(ESLINT_WARN_ONLY)!
    expect(out).toBe('✖ 24 problems (0 errors, 24 warnings)')
  })
  test('errors → keep error file blocks + summary, drop warning-only blocks', () => {
    const out = eslintFilter.filter(ESLINT_FAIL)!
    expect(out).toContain('/repo/src/bad.ts')
    expect(out).toContain("10:5  error  'x' is not defined  no-undef")
    expect(out).toContain('✖ 3 problems (1 error, 2 warnings)')
    expect(out).toContain('potentially fixable')
    expect(out).not.toContain('/repo/src/good.tsx')
    expect(out).not.toContain('Only a warning here')
  })
  test('no ✖ summary → null (unrecognized shape passes through)', () => {
    expect(eslintFilter.filter(pad(30, 'lint output with no eslint summary line'))).toBeNull()
  })
})

describe('install filter', () => {
  test('bun install → keep summary + lockfile, drop the +pkg list', () => {
    const out = installFilter.filter(BUN_INSTALL)!
    expect(out).toContain('23 packages installed [219.00ms]')
    expect(out).toContain('Saved lockfile')
    expect(out).not.toContain('+ @types/node@20.0.0')
  })
  test('npm install → keep added/audited + deprecation warn, drop funding nag', () => {
    const out = installFilter.filter(NPM_INSTALL)!
    expect(out).toContain('added 250 packages, and audited 251 packages in 12s')
    expect(out).toContain('npm warn deprecated har-validator@5.1.5')
    expect(out).not.toContain('looking for funding')
    expect(out).not.toContain('npm fund')
    expect(out).not.toContain('npm http fetch')
  })
  test('pnpm install → keep Packages/Done, drop progress + dep list', () => {
    const out = installFilter.filter(PNPM_INSTALL)!
    expect(out).toContain('Packages: +500')
    expect(out).toContain('Done in 4.3s')
    expect(out).not.toContain('+ react 18.2.0')
    expect(out).not.toContain('Progress: resolved')
    expect(out).not.toContain('++++')
  })
  test('peer-dependency warnings are kept alongside the summary', () => {
    const out = installFilter.filter(INSTALL_PEER)!
    expect(out).toContain('npm warn ERESOLVE overriding peer dependency')
    expect(out).toContain('added 10 packages in 3s')
    expect(out).not.toContain('npm http fetch')
  })
  test('no install summary anchor → null (unrecognized shape passes through)', () => {
    expect(installFilter.filter(pad(30, 'command output with no install summary'))).toBeNull()
  })
})

describe('build filter', () => {
  test('vite success → keep done + modules, drop the per-asset size table', () => {
    const out = buildFilter.filter(VITE_BUILD)!
    expect(out).toContain('✓ built in 3.45s')
    expect(out).toContain('✓ 234 modules transformed.')
    expect(out).not.toContain('│ gzip:')
    expect(out).not.toContain('dist/assets/index-d4e5f6.js')
    expect(out).not.toContain('transforming (1)')
  })
  test('tsup success → keep Build success, drop per-format rows', () => {
    const out = buildFilter.filter(TSUP_BUILD)!
    expect(out).toContain('⚡️ Build success in 1234ms')
    expect(out).not.toContain('CJS dist/index.js')
    expect(out).not.toContain('DTS dist/index.d.ts')
  })
  test('turbo success → keep Tasks/Time, drop cache-replay + asset rows', () => {
    const out = buildFilter.filter(TURBO_BUILD)!
    expect(out).toContain('Tasks:    14 successful, 14 total')
    expect(out).toContain('Time:    9.8s')
    expect(out).not.toContain('cache hit, replaying logs')
    expect(out).not.toContain('app-x1.js')
  })
  test('build failure → every error line survives', () => {
    const out = buildFilter.filter(VITE_BUILD_FAIL)
    // No droppable asset rows here → filter is a no-op string; the error lines
    // must be present whether it returns the (equal) string or null-to-raw.
    const text = out ?? VITE_BUILD_FAIL
    expect(text).toContain('error during build:')
    expect(text).toContain('Could not resolve "missing-pkg"')
    expect(text).toContain('Rollup failed to resolve import "missing-pkg"')
  })
  test('no anchor + no error → null (unrecognized shape passes through)', () => {
    expect(buildFilter.filter(pad(30, 'some build-ish chatter with no done line'))).toBeNull()
  })
})

// ── registry semantics ──────────────────────────────────────────────────

describe('applyOutputFilters', () => {
  test('recognized pass output gets filtered + provenance marker', () => {
    const out = applyOutputFilters('cd apps/api && bun test', BUN_PASS, 'tc_1')
    expect(out).toContain('3756 pass')
    expect(out).toContain('[bun-test output filtered:')
    expect(out).toContain('ToolOutput action="get" tool_call_id="tc_1"')
    expect(out.length).toBeLessThan(BUN_PASS.length)
  })
  test('trailing [exit N] marker survives filtering', () => {
    const out = applyOutputFilters('cargo test', CARGO_FAIL + '\n[exit 101]', 'tc_2')
    expect(out.endsWith('[exit 101]')).toBe(true)
    expect(out).toContain('test result: FAILED.')
  })
  test('unrecognized output passes through untouched', () => {
    const raw = pad(40, 'plain command output')
    expect(applyOutputFilters('ls -la', raw)).toBe(raw)
  })
  test('small outputs are not filtered (no marker overhead)', () => {
    const raw = 'bun test v1.3.14\n 5 pass\n 0 fail\nRan 5 tests across 1 file. [5.00ms]'
    expect(applyOutputFilters('bun test', raw)).toBe(raw)
  })
  test('detected-but-unparseable output falls back to raw', () => {
    const raw = `bun test v1.3.14\n${pad(30)}\n(crash before summary)`
    expect(applyOutputFilters('bun test', raw)).toBe(raw)
  })
  test('tsc + eslint route through the registry (filtered + marker)', () => {
    const tscOut = applyOutputFilters('bun run type-check', TSC_FAIL, 'tc_t')
    expect(tscOut).toContain('error TS2322')
    expect(tscOut).toContain('[tsc output filtered:')
    expect(tscOut.length).toBeLessThan(TSC_FAIL.length)

    const eslintOut = applyOutputFilters('bun run lint', ESLINT_WARN_ONLY, 'tc_e')
    expect(eslintOut).toContain('✖ 24 problems (0 errors, 24 warnings)')
    expect(eslintOut).toContain('[eslint output filtered:')
    expect(eslintOut.length).toBeLessThan(ESLINT_WARN_ONLY.length)

    const installOut = applyOutputFilters('bun install', BUN_INSTALL, 'tc_i')
    expect(installOut).toContain('23 packages installed')
    expect(installOut).toContain('[install output filtered:')
    expect(installOut.length).toBeLessThan(BUN_INSTALL.length)

    const buildOut = applyOutputFilters('bun run build', VITE_BUILD, 'tc_b')
    expect(buildOut).toContain('✓ built in 3.45s')
    expect(buildOut).toContain('[build output filtered:')
    expect(buildOut.length).toBeLessThan(VITE_BUILD.length)
  })
  test('REGRESSION: every failed test name survives filtering (all runners)', () => {
    const cases: Array<[string, string, string[]]> = [
      ['bun test', BUN_FAIL, ['broken multiply', 'broken upper']],
      ['cargo test', CARGO_FAIL, ['broken_math', 'broken_logic']],
      ['pytest', PYTEST_FAIL, ['test_broken']],
      ['go test ./...', GO_FAIL, ['TestBroken']],
      ['npx jest', JEST_FAIL, ['broken multiply']],
      ['npx vitest run', VITEST_FAIL, ['broken multiply']],
    ]
    for (const [command, fixture, names] of cases) {
      const out = applyOutputFilters(command, fixture, 'tc_x')
      for (const name of names) expect(out).toContain(name)
    }
  })
})

// ── guards ──────────────────────────────────────────────────────────────

describe('neverWorse', () => {
  test('keeps filtered when smaller', () => expect(neverWorse('x'.repeat(100), 'ok')).toBe('ok'))
  test('falls back to raw when filtered is not smaller', () => {
    expect(neverWorse('ab', 'abc')).toBe('ab')
    expect(neverWorse('ab', 'xy')).toBe('ab')
  })
})

describe('splitTrailingMarkers', () => {
  test('splits exit/timeout/kill markers off the tail', () => {
    const { body, markers } = splitTrailingMarkers('line1\nline2\n[exit 1]\n[Killed by user]')
    expect(body).toBe('line1\nline2')
    expect(markers).toEqual(['[exit 1]', '[Killed by user]'])
  })
  test('no markers → untouched', () => {
    const { body, markers } = splitTrailingMarkers('line1\n[not a marker]')
    expect(body).toBe('line1\n[not a marker]')
    expect(markers).toEqual([])
  })
})
