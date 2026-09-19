# Windows managed test launcher review

Date: 2026-09-19. Verdict: **approve**, limited to the launcher correction.

## Reviewed scope

Reviewed `f43a2ab73..25895dfafc058504ca94d08cd9d3d7932c8016f8` on `cez/32c60056`. The review checkout and parent both started at that exact tip. The complete diff contains only the Windows output spec, `packages/cli/src/lib/testing/integration.ts`, and its new `yarn-launcher.test.ts`. No blocking introduced regression was found. This is not approval of runtime readiness or the logistics release.

Read the root, CLI, QA, compatibility and spec guides, the startup investigation, local code-review skill/checklist, and relevant Windows launcher lesson. The shared `.agents/skills/om-code-review` installation is absent in both worktrees; the local `.ai/skills/om-code-review` extension and explicit bounded task order governed this review. CLI infrastructure, unit tests and documentation are the affected layers; no UI, database, generated registry, template or public CLI command changed.

## Source contracts checked

- `integration.ts:806-833`: only detached Windows launches switch to `process.execPath`. The wrapper is constant source; validated arguments are passed separately. Existing `resolveSpawnCommand` still rejects control characters and Windows percent/exclamation expansion. Nested Yarn uses the existing cross-spawn dependency, inherits the supplied environment/cwd/stdio, and is not detached. Its nonzero exit propagates; spawn failure produces diagnostics and exit 1.
- `integration.ts:833-847`: stdout and stderr each retain their bounded tail in both modes; verbose also forwards each to its matching stream. Silent stdin stays ignored and verbose stdin stays inherited. POSIX/non-detached executable and argument selection remain unchanged; verbose output intentionally changes from inherited streams to capture-and-tee on all platforms, so TTY detection is not byte-identical.
- `integration.ts:1853-1937`: the existing Windows taskkill tree owner and POSIX process-group logic are unchanged. The returned PID is the detached Node wrapper; the real Windows test proves its live Yarn/Node descendant is removed. This does not establish cleanup of every possible already-orphaned process topology.
- `integration.ts:3805`: the production caller remains `run start`, with the same app cwd, command environment and detached ownership. No general shell-quoting change was introduced. The reported pre-existing Corepack embedded-double-quote/parentheses limitation is outside this fix; no broader quoting guarantee is claimed.
- Dependency resolution is rooted at the CLI package manifest via `createRequire`, not the app cwd. `resolver.ts:74-90,596-605` maps monorepo to `packages/cli` and standalone to `node_modules/@open-mercato/cli`; cross-spawn is already a production dependency. Both manifest anchors resolved and loaded the installed cross-spawn function in a read-only probe. The installed-package anchor here is a workspace link, not an independently installed standalone app.

## Independent validation

Runner: **local Windows**, deliberately required for the OS regression and bounded by the task order. No Docker/runtime lifecycle probes, database access, credential files, generation or builds were run. Parent-installed dependencies were used from its worktree; reviewed source and Jest config had no working-tree diff before/after testing.

Executed with the existing unmodified CLI Jest config:

```powershell
node node_modules/jest/bin/jest.js --config packages/cli/jest.config.cjs --testMatch '**/yarn-launcher.test.ts' '**/spawn.test.ts' '**/integration.test.ts' --testNamePattern 'managed Yarn launch|resolveSpawnCommand|isWindowsCmdScript|waitForApplicationReadiness|createBoundedOutputBuffer|formatCapturedOutput|killProcessTree|terminateProcessTree|registerEphemeralShutdownHandlers|process.tree' --runInBand --no-cache --passWithNoTests=false
```

Result: **3 suites passed; 37 tests passed, 19 skipped; 4.574 seconds**, Node v24.19.0. All six real Windows launcher tests ran: silent/verbose streams, exit 7, cwd/environment and argument propagation, foreground version command, missing Yarn failure, unsafe argument rejection, and live descendant cleanup. Existing selected readiness, bounded-output, shutdown and spawn-contract tests also passed. Two real POSIX cases are platform-skipped; 17 cache/options tests were intentionally excluded because their hooks read/rewrite the parent's ephemeral state while its official harness runs concurrently.

`git diff f43a2ab73..25895dfaf --check` passed. TypeScript JS compiler transpilation of both changed TypeScript files reported zero diagnostics (syntax/transpilation only, not strict type checking). The parent's reported 54-test run, CLI build and strict scoped check were not independently repeated; this review does not adopt them as independently observed evidence.

## Remaining release gate

The parent must inspect the official isolated runtime retry and complete logistics integration verification. Output capture makes a startup error observable; it does not prove that startup succeeds. No runtime/full-release pass is claimed here. Only this review note is committed by the reviewer.
