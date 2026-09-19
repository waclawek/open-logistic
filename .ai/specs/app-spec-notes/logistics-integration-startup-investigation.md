# Logistics managed integration startup investigation

Date: 2026-09-19. Scope: read-only investigation of the parent Windows worktree; this note is the sole committed change.

## Finding and review verdict

**Confirmed: the detached Windows command-shell launch loses child output in this environment. The underlying reason the application exits 1 is not confirmed.** Missing output must not be treated as proof that application bootstrap did not run, or as evidence of the earlier missing generated artifact (already repaired).

Verdict: **changes** for treating the managed harness as ready for logistics QA. Its startup failure remains unresolved; the evidence supports an observability defect, not a proven application fix. No implementation branch was named in a “Review of” field. The investigation started at the parent's committed tip, `75cbf71ce`, with an empty `git diff cez/32c60056...HEAD`.

## Source evidence

- `packages/cli/src/lib/testing/integration.ts:436` chooses `yarn.cmd` on Windows. It imports **cross-spawn** at line 10, not Node's raw spawn; diagnosing this as merely “Node cannot execute a .cmd file” would be incorrect.
- `packages/cli/src/lib/spawn.ts:28` preserves the command and arguments for cross-spawn and passes through `detached`. The installed cross-spawn resolves the benign Yarn probe to `C:\Windows\system32\cmd.exe /d /s /c ...`.
- `integration.ts:805-828` starts the child with `['ignore', 'pipe', 'pipe']` only when silent. Captured-output readers are installed only in that case. Verbose uses inherited stdio. `integration.ts:2338-2347` includes “Captured output” only when the reader returns nonempty text. Therefore **verbose has no captured-output reader by design**.
- `integration.ts:3786-3789` unconditionally requests `detached: true` for `yarn run start`. Successful initialization/build commands use the foreground `runYarnRawCommand` path at lines 717-750.
- `apps/mercato/package.json:12-13`: start runs `yarn mercato server start`; mercato runs `node ./scripts/mercato-cli.mjs`. That launcher walks ancestors to `node_modules/@open-mercato/cli/bin/mercato` and imports a file URL. `packages/cli/bin/mercato:10-23` checks for and imports `dist/bin.js`. Read-only realpath probes confirm these resolve into the **parent worktree's** CLI package, not this investigation worktree.
- `packages/cli/src/lib/cli-bootstrap-mode.ts:29-33`: `test:ephemeral` is bootstrap-free; `server start` gets full bootstrap. `packages/cli/src/bin.ts:76-115` loads app environment, optionally telemetry, and the generated application graph **before** calling `run`. Errors reach `console.error` and exit 1 at lines 129-136. A successful Next build does not establish that this separate bootstrap succeeds.
- `packages/cli/src/mercato.ts:2445-2469` prepares server environment and obtains its startup lock; the production startup banner and Next process launch occur later, at lines 2531-2544. Without reliable output, neither a bootstrap error nor a lock/server/worker error can be excluded.
- `scripts/typescript-js-require-hook.cjs:6-11` only redirects `typescript` resolution to `typescript-js`; `package.json:37` explicitly loads it for DS lint. `mercato.ts:359-383` preserves other NODE_OPTIONS while adjusting New Relic preload flags. The investigation process had empty NODE_OPTIONS; that does **not** establish the parent's runtime NODE_OPTIONS. No hook was injected, and no bootstrap was executed by this investigation.

The parent's task-local log (basename `logistics-ephemeral-32c60056.log`) records app start at line 3401, 2s/4s readiness messages at lines 3402-3403, and exit 1 at line 3404. Only selected diagnostic lines were inspected; no credential values are reproduced here. The child task has a different TEMP, so the parent's log was located in the parent's task temp directory.

## Bounded probes and validation

Runner: local Windows, intentionally restricted to process-resolution/version probes and a pure unit suite. No application, database or container was started/stopped. No environment/credential file was read. No migrations, builds, generation, bootstrap or runtime tests were run.

Node was v24.19.0 and Yarn was 4.17.1. Probes used parent-installed cross-spawn, parent root/app cwd, a 15-second bound, and no application command:

| Probe | Foreground result | Detached result |
|---|---|---|
| `yarn.cmd --version`, async with harness's piped stdio | exit 0, `4.17.1` | exit 0, empty stdout/stderr |
| Same command, synchronous capture | exit 0, `4.17.1` | exit 0, empty stdout/stderr |
| `cmd.exe /d /s /c "node --version"` | exit 0, Node version | exit 0, empty stdout/stderr |
| `yarn.cmd node --version` | exit 0, Node version | exit 0, empty stdout/stderr |
| Direct `process.execPath -e` printing `probe-ok` and setting exitCode 7 | exit 7, `probe-ok` | exit 7, `probe-ok` |

Setting windowsHide true did not restore the detached Yarn probe's output. This isolates observed output loss to the command-shell path; it does not prove the low-level Windows handle mechanism or explain application exit 1.

Executed in the parent worktree:

```powershell
node node_modules/jest/bin/jest.js --config packages/cli/jest.config.cjs --testMatch '**/spawn.test.ts' --runInBand --no-cache --passWithNoTests=false
```

Result: **1 suite, 7 tests passed**. These tests assert command/argument preservation and detached passthrough, not real Windows output capture. An initial `--runTestsByPath` invocation found zero tests and is not counted as passing coverage.

## Next safe official-runner step

The parent should first obtain authorization for a narrowly scoped harness diagnostics correction, since CLI/core edits are outside this investigation. Require a real Windows regression probe showing that the official detached launch captures both output streams and retains the exit status; include verbose mode in the capture design. Reusing the existing direct-JavaScript launcher approach is a candidate for evaluation, not an implemented or proven fix. Merely setting windowsHide or adding --verbose is insufficient based on these probes.

**After that correction is reviewed and built, the parent should rerun the unchanged official command `yarn test:integration:ephemeral:start --verbose` from its worktree**, using the harness's own isolation, state and lifecycle management. Inspect the now-observable first error before selecting a bootstrap, lock or worker fix. Do not run raw `yarn start`, hand-construct an ephemeral environment, attach to a developer DB, or repeat database resets to diagnose this symptom. No safe existing flag was found that repairs the detached capture path; another identical run now may reproduce exit 1 without adding evidence.

Actual startup root cause remains an explicit blocker. This note completes the bounded investigation, not runtime verification or permission to merge logistics work as QA-verified.
