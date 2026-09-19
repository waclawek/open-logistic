# Logistics foundation verification

Verified on 19 September 2026 against implementation commit `c6421b465e1453b6583246fa9e1d4ecd09df6c3b`. The imported Open Logistic implementation has the same application source; repository identity, specification and evidence documentation were added afterward.

## Results

- **48 unit tests passed**, including page metadata, default administrator access, five locales and planned-state content. An independent reviewer reproduced this run.
- **24 browser integration tests passed** in 59.1 seconds, with no failures, skipped tests or flaky results. The managed disposable environment run covered all seven routes, reloads and menu links; dashboard navigation; denial without grants; both wildcard forms; grant revocation; organization switching and spoofed selections; mobile keyboard navigation; session removal; Polish translations; and existing Customers navigation.
- **Template parity and scoped design-system lint passed.** The independent review's missing template and integration-source findings were resolved in the imported implementation.
- The implementation run completed both package builds, generation, translation synchronization/usage checks, full typechecking and the production application build. Generation used the existing static OpenAPI fallback after a JSON import-attribute warning.
- The original nested Windows worktree exposed harness path/shell assumptions and incomplete Jest discovery. Its full suite is not represented as a pass. Final gate verification was performed in an isolated Linux checkout, as recorded below.

The initial managed environment failed startup. A later run with an isolated runtime secret started successfully and completed all 24 scenarios. Local environment values and credentials are not included here.

## Final repository validation

The validation follow-up in [open-logistic PR #5](https://github.com/waclawek/open-logistic/pull/5) was verified against code commit `55849fdc4` using Node 24 in an isolated Linux container with locked dependencies. All configured gate commands passed:

| Command | Result |
| --- | --- |
| `yarn build:packages` | Passed, 38 tasks |
| `yarn generate` | Passed |
| `yarn build:packages` (after generation) | Passed, 38 tasks |
| `yarn i18n:check-sync` | Passed; repeated after the catalog fix |
| `yarn i18n:check-usage` | Passed; existing unused-key notices are advisory |
| `yarn typecheck` | Passed, 38 tasks |
| `yarn test` | Passed, 46 tasks, in 8m 51s |
| `yarn build:app` | Passed |

The full run executed 17,608 passing core tests and 783 passing scaffold tests, with their existing skips unchanged. The focused logistics run reproduced all 48 passing tests in Linux, and template parity passed. Five CLI-launcher tests and five lesson-catalog tests also passed. The translation-value scan completed in its existing advisory mode.

The gate caught a missing centralized ACL catalog entry despite the module-owned translation being present. The follow-up adds the same `logistics.view` label in all five central dictionaries. A locale-detection test's virtual mock was replaced with a regular mock of the installed Next module; the shared suite passed twice afterward and again in the full run. No assertions were relaxed. The docs search-index failure from the interrupted first run cleared when the full docs build completed; all 20 docs tests passed.

The logistics application and template source still match the browser-verified implementation, and the added central labels exactly match its existing translations. The browser evidence below therefore remains applicable. This is a Linux full-gate result; existing POSIX-oriented session-share fixtures are not represented as a complete Windows suite pass.

## Screenshot evidence

These screenshots come from the successful browser integration run with isolated QA fixtures. They were visually inspected for layout and translated/planned-state content. A separate manual browser check also confirmed administrator login and the dispatcher dashboard; it is not a replacement for the integration coverage.

### Dispatcher dashboard

![Dispatcher dashboard with seven navigation entries and six section links](screenshots/dashboard-desktop.png)

### Mobile section

![Mobile proposals and disruptions page](screenshots/section-mobile.png)

### Polish translation

![Polish section and navigation](screenshots/section-polish.png)

### Access control

![Access denied for a user without logistics.view](screenshots/access-denied.png)

This is evidence of the initial static navigation foundation. Operational transport management, records, maps and analytics remain planned, as specified.
