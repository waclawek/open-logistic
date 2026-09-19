# Independent cancellation increment review

Verdict: **changes** — one high-priority reason-retention defect in cancellation. Scope normalization closure **passes** this bounded review.

Reviewed `0900601af46fb4588cfeb9bf7daad8787cc1228f` and `b85657c6f4f907b6988469041c3a9098a23e5041` on `cez/32c60056`, each against its first parent. Reviewer checkout HEAD was exactly `0900601af`. Read the tree brief, accepted App Spec, job-intake spec/shared implementation contract, available `.ai/review-checklist.md`, and relevant core/shared/auth/spec guidelines. The shared review skill is absent; no execution of it is claimed.

## R1 — retain the cancellation reason across audit failure

**High priority.** `apps/mercato/src/modules/logistics/commands/jobs.ts:74` keeps the reason only in a local variable; `:95–100` attaches it to a result symbol and suppresses audit when that symbol is absent. No cancellation reason is stored with the job or receipt transaction. This creates a permanent history gap on an ordinary postcommit audit-write failure.

The actual CommandBus awaits the handler, then builds metadata, then persists the audit (`packages/shared/src/lib/commands/command-bus.ts:265–268,325,631–637`). `ActionLogService.log` forks its own EntityManager and flushes separately (`packages/core/src/modules/audit_logs/services/actionLogService.ts:245–250`). The bus does not roll back the already-committed logistics transaction if that flush fails. The cancellation route maps this exception to a generic 500; the next HTTP attempt returns the committed receipt before reaching the bus (`api/jobs/[id]/cancel/route.ts:22–23`). Even a direct bus retry suppresses logging because the receipt path does not set the symbol.

Independently reproduced with the **real CommandBus**, real cancellation/transaction helpers, and the existing command suite's in-memory persistence fixture:

1. Make `actionLogService.log` reject once with `Audit database unavailable`.
2. Execute cancellation through CommandBus. It rejects, but the job is cancelled, both receipt rows are committed, and rollback was never called.
3. Assert that neither the job nor persisted receipt rows contain the reason.
4. Retry the identical command after the logger has recovered. It succeeds with the original request ID, but the logger was called only once total: the reason is never persisted.

The successful audit path was separately exercised through the real bus: the reason reaches its actual redo/audit envelope, remains absent from the public result, and replay produces no duplicate log. Thus the defect is durability across failure, not an assumption that the bus drops metadata or the symbol on the happy path. Audit encryption configuration includes `command_payload`; encryption does not fix this lost-write window.

Required correction: retain encrypted cancellation evidence atomically with the domain/receipt result, or provide an equally durable transactional audit handoff with idempotent completion. A memory-only symbol plus unconditional replay suppression cannot be the sole record of the mandatory reason. Preserve fresh authorization, original-request digest semantics, and no generic undo. Add a regression through actual CommandBus covering audit failure followed by retry. The chosen persistence solution remains the implementer's decision; this review makes no source/schema change.

## Other bounded findings

- Cancellation revalidates its input, locks the scoped job, requires its version even with the global optimistic-lock opt-out, allows only draft/ready with no terminal timestamp, advances the version, and atomically commits state plus receipt. Assigned, in-transit and terminal states are rejected without a custody shortcut. Generic undo is disabled.
- Receipt keys include actor/action/tenant/organization/request ID. The transaction takes the receipt advisory lock before the job lock. Identical contenders reaching the command transaction replay; different payload digests conflict. Different request IDs serialize on the job lock and then fail version/state checks. This is source-level locking evidence, not an independent PostgreSQL concurrency result.
- Current authorization precedes route receipt preflight and command receipt replay. The original validated HTTP input is stored as a server Request symbol/digest; modified guard input is revalidated, and resource/request identity changes are rejected. No client header is trusted as that symbol.
- Registry and legacy mutation guards use fresh granted features. The real route helper catches callback failures, preserving a committed 200. An independent callback-failure probe verified that behavior on cancellation and that a command 409 does not run callbacks. Existing route tests cover blocking guards, identity tampering and authorized preflight replay.
- Index/event work runs after domain commit. Public cancellation results and emitted cancellation events omit the reason. Side-effect recovery uses the existing foundation's best-effort telemetry path; this review does not claim durable delivery or rollback after a postcommit failure.
- `b85657c6f` trims the decoded organization cookie before comparison, matching the directory scope normalization. Existing regressions through the actual directory scope service reject raw, encoded, space-padded and tab-padded all-organization tokens at authorization, receipt reads and receipted mutation entry; no mutation occurs. The full authorization suite passed, including current ACL/scope revocation cases.
- The two deltas add only the intended action/event/receipt-enum/locales/tests/spec evidence and the normalization fix. No production dependency, platform implementation or schema change was introduced. No future trip, promise or UI work is classified as a defect of this increment.

## Independent validation and reproducibility

Runner: **local**. `DOCKER_COMPOSE_FILE` unset; no local dev-compose candidates. `compose.fullapp.dev.yml` reported no running app; `compose.fullapp.yml` failed interpolation for absent JWT_SECRET. No credential was supplied, runtime started, migration applied or state-mutating CLI invoked.

Normal app Jest setup files and transformer were preserved. Explicit test discovery is needed in this nested worktree: an initial ordinary `--runTestsByPath` invocation discovered zero tests and is **not** counted as validation. Corrected full-suite command:

```powershell
$env:NODE_PATH='C:/Dev/open-logistic/.ai/cezar/worktrees/32c60056-a2a7-4922-a033-3ea531273fc1/node_modules'
node -e "const path=require('path');const config=require('./apps/mercato/jest.config.cjs');config.rootDir=path.resolve('apps/mercato');config.testMatch=['**/src/modules/logistics/__tests__/**/*.test.ts','**/src/modules/logistics/__tests__/**/*.test.tsx'];config.modulePaths=[process.env.NODE_PATH];require('jest').runCLI({config:JSON.stringify(config),runInBand:true,cache:false},[process.cwd()]).then(r=>process.exit(r.results.success?0:1))"
```

Result: **14 suites / 402 tests passed**, exit 0, 9.496 seconds. Separate untouched command-suite baseline: **31 tests passed**, 4.651 seconds.

Two reviewer probes appended **only in transformer memory** to `commands.test.ts`: **33 tests passed**, exit 0, 4.511 seconds. No test/source file was edited. Reproduce from the same reviewed checkout with the NODE_PATH above, passing this JavaScript to `node` via a PowerShell literal here-string:

```javascript
const path = require('path');
const transformer = require('./scripts/jest-mikroorm-transformer.cjs');
const create = transformer.createTransformer;
const probes = String.raw`
describe('independent cancellation audit review probes', () => {
  it('real CommandBus retains reason on success and suppresses duplicate logs', async () => {
    const { CommandBus } = require('@open-mercato/shared/lib/commands/command-bus');
    const test = harness();
    const log = jest.fn(async () => null);
    test.ctx.container.register({ actionLogService: asValue({ log }) });
    const bus = new CommandBus();
    const input = { ...test.input, reason: 'Private cancellation reason' };
    const options = { input, ctx: test.ctx, skipCacheInvalidation: true };
    const first = await bus.execute('logistics.jobs.cancel', options);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).toContain(input.reason);
    expect(JSON.stringify(first.result)).not.toContain(input.reason);
    await bus.execute('logistics.jobs.cancel', options);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('reproduces permanently lost reason after audit persistence failure', async () => {
    const { CommandBus } = require('@open-mercato/shared/lib/commands/command-bus');
    const test = harness();
    const log = jest.fn().mockRejectedValueOnce(new Error('Audit database unavailable')).mockResolvedValue(null);
    test.ctx.container.register({ actionLogService: asValue({ log }) });
    const bus = new CommandBus();
    const input = { ...test.input, reason: 'Private cancellation reason' };
    const options = { input, ctx: test.ctx, skipCacheInvalidation: true };
    await expect(bus.execute('logistics.jobs.cancel', options)).rejects.toThrow('Audit database unavailable');
    expect(test.job.status).toBe('cancelled');
    expect(test.rows).toHaveLength(2);
    expect(test.em.rollback).not.toHaveBeenCalled();
    expect(JSON.stringify([test.job, ...test.rows])).not.toContain(input.reason);
    const retry = await bus.execute('logistics.jobs.cancel', options);
    expect(retry.result.requestId).toBe(input.requestId);
    expect(log).toHaveBeenCalledTimes(1);
    expect(emitLogisticsEvent).toHaveBeenCalledTimes(1);
  });
});`;
transformer.createTransformer = (...args) => {
  const instance = create(...args);
  const process = instance.process.bind(instance);
  instance.process = (text, filename, options) => process(filename.replaceAll('\\\\','/').endsWith('/logistics/__tests__/commands.test.ts') ? text + probes : text, filename, options);
  return instance;
};
const config = require('./apps/mercato/jest.config.cjs');
config.rootDir = path.resolve('apps/mercato');
config.testMatch = ['**/src/modules/logistics/__tests__/commands.test.ts'];
config.modulePaths = [process.env.NODE_PATH];
require('jest').runCLI({ config: JSON.stringify(config), runInBand: true, cache: false }, [process.cwd()]).then(result => process.exit(result.results.success ? 0 : 1));
```

Additional callback probe: same transformer-memory mechanism against `actionRoutes.test.ts`, existing `fixture()` and `guard()` helpers. Register `validate: async () => ({ ok: true, shouldRunAfterSuccess: true })` and an `afterSuccess` mock throwing `Callback failed`. Set the fixture result action to `logistics.jobs.cancel`; POST valid cancellation input and assert status 200 / callback called once. Reject the next bus execution with `new CrudHttpError(409, {error: 'Conflict'})`; assert status 409 / callback still called once. **23 tests passed**, exit 0, 1.192 seconds; expected helper error log was printed.

`git diff --check` passed separately for both named commit deltas. No independent build, typecheck, encryption-at-rest runtime, HTTP server, database migration or actual concurrent transaction execution is claimed. Parent-reported compilation/generation and managed HTTP results are separate evidence. Existing mocks validate orchestration and source contracts, not PostgreSQL durability/locking itself.

The complete own-fleet/manual-dispatch release remains incomplete and is neither approved nor reduced by this review. Only this review note is committed.
