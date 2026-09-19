# Logistics runtime boundary review

Date: 2026-09-19. Verdict: **changes — bounded commit review only**.

Reviewed exactly `2da2a129571fe766d97c4795f22578a25679d35f` on `cez/32c60056`, using `git diff 2da2a1295^ 2da2a1295`. Reviewer HEAD initially equals that commit; fork-point-to-reviewed-tip delta is empty. Inspected all six changed files (job list projection, command authorization, timestamp helper, two tests, lesson). No core changes. Only this review note is committed by the reviewer.

Applied approved logistics App Spec, implementation contract, job-intake spec, prior authorization closure, core API/RBAC and shared feature-policy guidance, BACKWARD_COMPATIBILITY, local `.ai/skills/om-code-review/SKILL.md` and `.ai/review-checklist.md`. Shared `.agents/skills/om-code-review/SKILL.md` is absent. No source, spec, credential, migration or harness-state changes; no app/database boot.

## Required change

**R1 — major / High: all-organizations guard does not match resolver normalization.**

Location: `apps/mercato/src/modules/logistics/commands/context.ts:17–18`.

`parseSelectedOrganizationCookie` decodes but does not trim the cookie value. The directory resolver's `normalizeOrganizationId` trims it (`packages/core/src/modules/directory/utils/organizationScope.ts:149–153`) before recognizing the all-organizations token at lines 264–267. Thus `om_selected_org=%20__all__%20` or `om_selected_org=%09__all__%09` means an explicit all-organizations choice to the resolver, which falls back to the restricted actor's home organization without `selectionRejected`. The new exact comparison sees padded text and permits fresh authorization of that home organization.

An in-memory probe executing the actual parser, directory resolver and command boundary reproduced both accepted cases. Persistence, feature policy and the fresh-service response were stubbed; this is a source/unit counterexample, not managed HTTP evidence. The probe also confirms raw/encoded unpadded tokens return 400 and malformed percent encoding produces resolver rejection and boundary 403.

Impact: the explicit-selection invariant remains broken, allowing a mutation or receipt lookup under a silently substituted home organization. This does **not** demonstrate access outside the actor's current permitted organizations. Align the guard with the directory resolver's whitespace normalization and add space/tab encoded-token regressions covering mutation authorization and receipt reads. Preserve missing-cookie behavior and fresh ACL checks.

## Checks and invariants

- All nine projected timestamp properties correspond to TransportJob Date fields. Jobs GET and GET-by-id share the projection. ORM Date values and PostgreSQL strings normalize to UTC ISO; ordinary cargo/place/custom-field values are untouched. Nullable lifecycle dates remain null. Undefined values are coalesced to null at the route before the helper.
- Offset probes for +05:30 and -0530, PostgreSQL microseconds, null and invalid Date passed. Fractional sub-milliseconds truncate to JS Date precision, consistent with existing ORM/command versions; no new precision guarantee is claimed.
- Mutation/receipt versions already serialize through Date.toISOString; this patch does not alter those paths. The date helper rejects invalid/zoneless values rather than inventing a local-time interpretation.
- The fresh resolve still receives a copied auth object with stale isSuperAdmin cleared, invalidates/reloads ACLs, validates tenant/selection and applies feature authorization. The existing unit tests cover revocation, current superadmin and authorized descendants.
- readCommandReceipt and runReceiptedCommand still authorize before persistence/receipt replay; actor/action/requestId/digest scoping is unchanged. Incoming auth is not mutated.
- Missing/empty cookie is not an all-organizations token; concrete resolved selections retain normal authorization. Null selectedOrganizationId still fails scope-required. Malformed encoded selection is rejected by the actual resolver. R1 is specifically the difference in normalization of a recognized token.
- No entity/schema, dependency, public route, event, ACL identifier or core implementation change. The lesson accurately identifies the intended boundary, but the normalization edge remains.

## Reproducible evidence

Runner: **local**. DOCKER_COMPOSE_FILE unset; configured compose candidates produced no running app ID. Parent node_modules supplies dependencies. Normal app Jest transformer, resolver and all setup files retained.

```powershell
$env:NODE_PATH='C:/Dev/open-logistic/.ai/cezar/worktrees/32c60056-a2a7-4922-a033-3ea531273fc1/node_modules'
node "$env:NODE_PATH/jest/bin/jest.js" --config apps/mercato/jest.config.cjs --modulePaths "$env:NODE_PATH" --runInBand --no-cache --testMatch '**/logistics/__tests__/*.test.ts' --passWithNoTests=false
node "$env:NODE_PATH/jest/bin/jest.js" --config apps/mercato/jest.config.cjs --modulePaths "$env:NODE_PATH" --runInBand --no-cache --testMatch '**/logistics/__tests__/*.test.tsx' --passWithNoTests=false
git diff 2da2a1295^ 2da2a1295 --check
```

Results: **341 tests / 13 suites passed**, then **48 tests / 1 suite passed**; total **389 tests / 14 suites**. Diff whitespace check passed. Initial commands using the configured root-prefixed testMatch discovered zero tests on this Windows worktree; those were not counted as passing validation. The glob override changes discovery only.

The following JavaScript probe was executed through Node -e with NODE_PATH above, without writing executable files. It transpiles actual source with the installed typescript-js alias, avoiding TypeScript 7's non-programmatic stub. Run from repository root. Fixture IDs and policy/UUID helpers are simplified to isolate normalization; the normal Jest suites above separately exercise actual authorization services.

```javascript
const fs=require('fs'),ts=require('typescript-js'),assert=require('assert/strict');
function load(path,deps={}) {const e={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(e,id=>{if(id in deps)return deps[id];throw Error(id)});return e;}
const cookies=load('packages/core/src/modules/directory/utils/scopeCookies.ts'), constants=load('packages/core/src/modules/directory/constants.ts');
class CrudHttpError extends Error {constructor(status,body){super(body.code);this.status=status}}
const resolver=load('packages/core/src/modules/directory/utils/organizationScope.ts',{
'@open-mercato/core/modules/directory/data/entities':{Organization:class Organization{}},
'@open-mercato/core/modules/directory/constants':constants,
'@open-mercato/cache':{getCurrentCacheTenant:()=>null,runWithCacheTenant:(_,fn)=>fn()},
'./scopeCookies':cookies,
'@open-mercato/shared/lib/logger':{createLogger:()=>({child:()=>({})})}});
const {authorizeLogisticsCommand}=load('apps/mercato/src/modules/logistics/commands/context.ts',{
'@open-mercato/shared/security/featurePolicy':{authorizeFeatures:()=>true},
'@open-mercato/shared/lib/crud/errors':{CrudHttpError},
'@open-mercato/shared/lib/i18n/server':{resolveTranslations:async()=>({translate:x=>x})},
'../data/validators':{uuidSchema:{safeParse:()=>({success:true})}},
'@open-mercato/core/modules/directory/constants':constants,
'@open-mercato/core/modules/directory/utils/scopeCookies':cookies});
(async()=>{
for(const raw of [null,'om_selected_org=','om_selected_org=__all__','om_selected_org=%5F%5Fall%5F%5F','om_selected_org=%20__all__%20','om_selected_org=%09__all__%09','om_selected_org=%ZZ']) {
 const selected=cookies.parseSelectedOrganizationCookie(raw);
 const service={resolveFresh:async()=>({scope:{tenantId:'tenant',selectedId:'home',allowedIds:['home']},acl:{features:['logistics.*'],isSuperAdmin:false}})};
 const em={find:async()=>[{id:'home',descendantIds:[]}]};
 const initial=await resolver.resolveOrganizationScope({em,rbac:{loadAcl:async()=>({isSuperAdmin:false,features:['logistics.*'],organizations:['home']})},auth:{sub:'actor',tenantId:'tenant',orgId:'home'},selectedId:selected});
 const ctx={organizationScope:initial,auth:{sub:'actor',tenantId:'tenant',orgId:'home'},selectedOrganizationId:initial.selectedId,request:new Request('http://localhost/',raw===null?{}:{headers:{cookie:raw}}),container:{resolve:()=>service}};
 let result;try{result=(await authorizeLogisticsCommand(ctx,[])).scope.organizationId}catch(error){result=error.status}
 console.log(JSON.stringify({raw,selected,initialScope:initial,resolverRecognizesAll:constants.isAllOrganizationsSelection(selected?.trim()),boundary:result}));
 if(raw?.includes('%20')||raw?.includes('%09')) assert.equal(result,'home');
}
const {jobTimestampValue}=load('apps/mercato/src/modules/logistics/lib/jobTimestamp.ts');
for(const [input,expected] of [['2026-09-19 20:22:24.637+05:30','2026-09-19T14:52:24.637Z'],['2026-09-19 09:22:24.637-0530','2026-09-19T14:52:24.637Z'],['2026-09-19 14:52:24.637123+00','2026-09-19T14:52:24.637Z']]) assert.equal(jobTimestampValue('updatedAt',input),expected);
assert.throws(()=>jobTimestampValue('updatedAt',new Date(NaN)));assert.equal(jobTimestampValue('acceptedAt',null),null);
console.log('Timestamp offset/precision/null/invalid-Date probes passed');
})().catch(e=>{console.error(e);process.exitCode=1});
```

Observed padded-token cases: initialScope.selectedId = home, no selectionRejected, boundary = home. Unpadded raw/encoded tokens: boundary = 400. Malformed %ZZ: selectionRejected = true, boundary = 403. Timestamp probes passed.

## Boundaries

This verdict covers only this corrective commit. No independent app typecheck/build or real HTTP/database execution is claimed. Parent-reported typecheck and concurrent managed TC-LOG-008 execution are separate evidence. The full own-fleet/manual-dispatch release remains unfinished and its approved scope is unchanged.
