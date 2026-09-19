# Logistics command authorization closure

Date: 2026-09-19. Verdict: **approve — R1/R2 targeted closure only**.

Reviewed parent `cez/32c60056` at `72bb44569`, also this review worktree's fork point. The fork-point-to-parent diff is empty; the corrective diff inspected in full is `git diff 4914a1e89..72bb44569` (four files: implementation contract, command context, authorization tests, command tests). No implementation edits. This closes the two findings in [logistics-command-foundation-review.md](logistics-command-foundation-review.md) against the approved [implementation contract](logistics-implementation-contract.md); it does not approve the unfinished operational release.

## Findings disposition

- **R1 closed.** `commands/context.ts:20` passes a copied auth object with `isSuperAdmin: false` to the actual fresh scope service. `directory/services/organizationScopeService.ts:53–70` invalidates the user ACL cache and reloads ACLs, then calls the actual directory resolver. Its `effectiveSuperAdmin = aclIsSuperAdmin || isSuperAdminActor` now derives superadmin authority solely from the fresh ACL. Current superadmins remain authorized; explicit current descendant grants still expand through the existing resolver. Rejected/deleted selections and selected-ID/tenant mismatches remain denied by context line 21. The incoming context is not mutated.
- **R2 closed.** `commands/context.ts:14–15` requires a concrete `selectedOrganizationId`. Neither null nor undefined falls back to `auth.orgId` or `actorOrgId`; both fail with 400 `organization_scope_required`. This applies before persistence to mutations and receipt reads via `transaction.ts:57` and `transaction.ts:42` respectively.
- **API keys remain intentionally excluded.** Context line 16 rejects `isApiKey`; the UUID principal check also rejects the native `api_key:<uuid>` subject. The amended contract explicitly limits this release to internal authenticated users. No keyed-principal namespace expansion is implied.

No remaining blocker/major finding in this targeted diff. No schema, dependency, core resolver, API or UI change is hidden in it. The final change matches the order; wider trip/API/UI completion is outside this closure.

## Independent executed evidence

Runner: **local**. `DOCKER_COMPOSE_FILE` unset; no local dev-compose candidates. Dev compose probe returned no running app. Fullapp compose probe failed interpolation for missing `JWT_SECRET`; no credentials were read or supplied.

Normal app Jest config, retaining both `setupFiles` and `setupFilesAfterEnv` unchanged, with only absolute root, parent dependency resolution and explicit logistics test discovery adjusted:

```powershell
$env:NODE_PATH='C:/Dev/open-logistic/.ai/cezar/worktrees/32c60056-a2a7-4922-a033-3ea531273fc1/node_modules'
node -e "const path=require('path');const config=require('./apps/mercato/jest.config.cjs');config.rootDir=path.resolve('apps/mercato');config.testMatch=['**/src/modules/logistics/__tests__/**/*.test.ts','**/src/modules/logistics/__tests__/**/*.test.tsx'];config.modulePaths=[process.env.NODE_PATH];require('jest').runCLI({config:JSON.stringify(config),runInBand:true},[process.cwd()]).then(r=>process.exit(r.results.success?0:1))"
```

Result: **7 suites / 234 tests passed, exit 0**. Node emitted sys-deprecation/WASI warnings only. The four committed authorization tests use the real default directory scope service/resolver and real feature policy with fake ACL storage/organization rows. They prove current superadmin success, subsequent revoked authority rejection (including receipt reads), descendant authorization, deleted-selection denial, and null-selection denial. The command suite additionally covers feature revocation at acceptance/replay, API-key rejection, and same/foreign actor-tenant null selection.

Additional independent probe: ran only `authorization.test.ts` with the same app setup and parent lookup, `cache: false`, wrapping the existing transformer's `createTransformer/process` **in memory** to append three review-only tests. No test or implementation file was written. Verified injection occurred and exactly **7 tests passed (4 committed + 3 probes), exit 0**:

1. For both null and undefined selections, and both same/foreign actor tenants, call actual `runReceiptedCommand` and `readCommandReceipt`; all eight calls reject with 400 `organization_scope_required`, mutation callback remains unused, and fresh ACL loading is not reached.
2. With stale `auth.isSuperAdmin=true`, fresh non-superadmin ACL restricted to A, and selected B, actual `runReceiptedCommand` rejects 403 before persistence or mutation callback.
3. With stale `auth.isSuperAdmin=false`, fresh superadmin ACL, different `actorTenantId/actorOrgId`, and an explicit B selection in the active tenant, actual authorization succeeds with the exact active tenant/B scope. This checks the trusted context representation of an active tenant override, not HTTP override parsing.

The resolver probe fixture has no registered persistence entity manager; expected denials therefore also prove these paths stop before attempting persistence resolution. `git diff --check 4914a1e89..72bb44569` passed.

## Limits and review method

Applied repository checklist, local `om-code-review` extension, applicable core/shared/auth rules, and descendant-scope lesson. The shared `.agents/skills/om-code-review/SKILL.md` remains absent; the approved contract permits this documented fallback.

This is source and isolated unit/control-flow evidence. RBAC storage and organization rows are mocked; no database, real HTTP session, PostgreSQL lock/concurrency, encryption integration, full build/typecheck or broad runtime gate was exercised. No migrations, credentials, implementation edits, children, pushes or base-branch merges. Existing release integration requirements remain intact.
