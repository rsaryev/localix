# Testing

Localix tests run on Bun Test, colocated with the code they cover. Use this page when you write a
test, when a suite is slow or flaky, or when you add a package that has tests.

## Terminology

| Term             | Meaning                                                                                     | Boundary                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Unit test        | A `*.test.ts` or `*.test.tsx` file. One process, no real time, shell, watcher or network.   | Large suites run as shards: N `bun test --shard` processes, each loading the module graph once. |
| DOM test         | A `*.dom.test.tsx` file: a unit test that renders into happy-dom.                           | Registers its own DOM; queries by role or label.                                                |
| Integration test | A `*.integration.test.ts` file. Drives real processes, PTYs, file watchers or long replays. | Runs in the package's `test:integration` script, never in `test`.                               |
| Test helper      | `@localixai/testing`: temp dirs, deadline-bound processes, git environment, network guard.  | Shared by every workspace; package fixtures stay in that package's `src/testing/`.              |

These follow the small and medium test sizes of
[Software Engineering at Google](https://abseil.io/resources/swe-book/html/ch11.html): a unit test
never waits on the machine, so the sharded run stays fast and deterministic.

## Where tests run

| Command                         | Runs                                                                               | When                            |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| `bun test path/to/file.test.ts` | One file, from the repository root or the package.                                 | While editing.                  |
| `.githooks/pre-commit`          | Format, lint, affected type checks and the changed or co-located tests.            | Every commit.                   |
| `.githooks/pre-push`            | The CI gates for the packages that differ from `origin/main` and their dependents. | Every push.                     |
| Pull-request CI                 | The same gates, `--affected` against the pull request's base.                      | Every pull request.             |
| Merge queue and `main` CI       | Every gate over the whole tree.                                                    | Before anything reaches `main`. |

Bun reads `bunfig.toml` only from the directory a run starts in, so every workspace with tests has
its own and lists `packages/testing/src/preload/index.ts` by its relative path. The preload removes
git's repository variables and makes a request to a non-loopback host fail at once, naming the URL.

## Tests first

Work red, green, refactor, as [AGENTS.md](../../AGENTS.md#tests-first-tdd) states:

1. For a bug, write a test that reproduces it at the layer where a person meets it, and run it to
   see it fail for the right reason. Then fix the code and see the test pass. The red run proves the
   test can fail; never break working code to get one.
2. For a feature or a change of behaviour, write its tests first, from what a person does and sees:
   the keys pressed, what is on screen, what the model was sent. Then write the code.
3. Refactor only on green. Delete a test that cannot fail, or that restates a text or a constant.

## Writing a test

1. Put real time, child processes, file watchers and PTYs in a `*.integration.test.ts` file. Keep
   everything else a unit test.
2. Never sleep in a unit test. Give the code under test its delay, clock or window as an option
   whose default is the production value, and pass a small one in the test (`attemptTransientRetry`
   takes `wait`; the bash tool takes `backgroundSettle`). Use `jest.useFakeTimers()` only for a
   timer you cannot inject, and restore real timers in `afterEach`.
3. Create directories with `tempDirPerTest()` or `makeTempDir()` from `@localixai/testing`. They are
   removed after the test, pass or fail. Never make one beside the test (`import.meta.dir`): the
   source lints walk those trees and can meet a half-written fixture. A fixture that must resolve
   the repository's own packages takes the API's git-ignored scratch root (`makeApiScratchDir`).
   `scripts/test-temp-dir-guard.test.ts` enforces both.
4. Start processes with `run()` or `runSync()` from `@localixai/testing`, which kill a child that
   misses its deadline with `SIGKILL`. A direct spawn needs `timeout` and `killSignal: 'SIGKILL'`.
5. Give every git child `scratchGitEnv()`: no inherited `GIT_*`, no global or system config, a fixed
   identity.
6. Stub `fetch` (`apps/api/src/testing/fetch-stub.ts`). A server in an integration test binds to
   `127.0.0.1` on port `0`. Wrap a deliberately live call in `allowNetwork()`.
7. Make each file pass alone, in random order and isolated (`--isolate`): register the DOM, call
   `mock.module` and reset stores in that file. Never rely on another file's setup.
8. Leave nothing on `globalThis`; `scripts/test-globals-guard.ts` fails the run otherwise.
9. Build data with the package's fixtures (`makeX(overrides)` in `src/testing/`). Add a builder
   rather than copying object literals between tests.
10. In DOM tests, query by role or label and act through events, as
    [Testing Library](https://testing-library.com/docs/guiding-principles) recommends. Assert on
    what a person sees, not on component internals.
11. Mock at boundaries — network, clock, processes, the file system — not modules you own.
12. Assert in every test, with no `if` around `expect`. Never commit `test.only`; Bun fails a run
    that has one when `CI` is set. Use `test.todo` or `test.skipIf(condition)` with a reason.
13. A regression test fails without its fix. Name the test after the behaviour it pins.

Before you finish, run the file alone and with `bun test --isolate --randomize <file>`.

## Adding a package with tests

| Need                  | Mechanism                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Unit tests            | `"test": "bun test src"`; past a few seconds, `bun ../../scripts/test-shards.mjs N src`.         |
| Integration tests     | `"test:integration": "bun test integration.test"`, and `--path-ignore-patterns` on `test`.       |
| Preloads              | A `bunfig.toml` whose `[test] preload` lists `scripts/test-deadline.ts` and the testing preload. |
| Inputs outside itself | `$TURBO_ROOT$/…` globs in the package's `turbo.json`, so the cache misses when they change.      |

`scripts/test-tiers.test.ts` fails when a package's integration files are not split this way or its
`bunfig.toml` does not list the preload.

Do not use `bun test --parallel` for a whole suite. It isolates every file, so each one loads and
transpiles the module graph again: on apps/api's chat tests four isolated workers spent four times
the CPU of a serial run, while four shards finished 2.5 times faster than serial at 1.4 times its
CPU.

## Finding a slow test

Write per-test timings with `bun test --reporter=junit --reporter-outfile=timings.xml src` and sort
by time. A suite that takes whole seconds is almost always waiting on a real timer, a real process
or a repeated scan; give it the option from step 2 or move it to the integration tier.
