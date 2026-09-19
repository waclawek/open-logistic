# Logistics navigation foundation

Source doc: .ai/specs/2026-09-19-app-spec-logistics-dashboard.md
Source branch: cez/2b56ff55 (e7cdf8105)
Repository: waclawek/open-logistic
Status: complete
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal and scope

Deliver seven guarded logistics pages in the existing backend shell, logistics.view access, default administrator grants, five locales, and self-contained navigation/access tests. This is the specification's static foundation: no transport records, domain APIs, migrations, GPS, analytics or operational actions.

The owner imported the implementation, specification and screenshots into develop through d0d006782. Follow-up PR #5 completes validation and documentation; it does not duplicate the application changes. The incorrectly targeted upstream PR #6242 is closed without merging and is superseded by this repository.

## Implementation Plan

### Phase 1: Module and pages (spec C1)

1.1 Add module metadata, read feature, admin setup, and seven individually guarded page metadata files.
1.2 Build the translated dashboard links and planned-feature pages using Page, PageHeader, PageBody and EmptyState; activate the module and strict DS checks. Add unit coverage.

### Phase 2: Integration coverage and delivery (spec C2)

2.1 Add self-contained integration coverage for navigation, grants/wildcards/revocation, session and organization scope, mobile/keyboard access, and deployment instructions.
2.2 Run generators, targeted checks and the configured validation sequence; perform independent review and fix findings.
2.3 Publish the implementation PR, attach actual UI evidence, normalize labels and report verified results.

## Risks and validation

All new routes and ACL are additive. Existing authentication and organization guards handle requests; no mutable entities or optimistic-locking changes are involved.

Initial runner: local Windows. Both package builds, generation, translation synchronization/usage, typecheck and production app build passed. Full tests exposed existing Windows harness assumptions and a release-date documentation mismatch. Follow-up commits 4193f3ca2 and a91a17553 correct the date, native file URLs, separator/junction assertions, and npm/Yarn JavaScript entrypoint resolution without relaxing assertions or adding dependencies.

Final runner: isolated Node 24 Linux container with a code-only clone of this repository and locked dependencies. Ordered gate: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app. All eight commands passed. The full test command completed 46 tasks successfully; the production app build passed on code commit 55849fdc4.

## Verification evidence

The full Linux gate caught and resolved the centralized logistics ACL label omission and a virtual mock for the installed Next headers module. The complete shared suite passed twice after the mock correction and again in the full run. The interrupted docs build succeeded on rerun. See the verification report for per-command results and the original Windows limitations.

- 48 actual logistics unit tests passed; an independent reviewer reproduced them.
- 24 managed browser scenarios passed in 59.1 seconds, with zero failures/skips/flakes. Coverage includes seven routes/reloads, menus, dashboard links, permissions, wildcards, revocation, organization isolation, mobile keyboard use, missing sessions, Polish and existing Customers navigation.
- Screenshot evidence and exact implementation provenance: [verification report](../../docs/logistics/verification.md).
- Template parity, strict scoped design-system lint, and the seven targeted docs tests passed.
- Independent source review approved the feature after its template/coverage fixes and approved the subsequent validation tooling fixes after adding the Yarn version assertion.
- On the destination branch, five CLI launcher tests and the lesson catalog check passed.

## Progress

PR: https://github.com/waclawek/open-logistic/pull/5

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module and pages

- [x] 1.1 Add module metadata, feature, setup and seven guarded page metadata files. — db7d52547
- [x] 1.2 Build translated pages, activate the module, enforce DS rules and add unit coverage. — db7d52547

### Phase 2: Integration coverage and delivery

- [x] 2.1 Add integration coverage and deployment instructions. — 8d12cd7d3, c6421b465
- [x] 2.2 Run generators, validation and independent review; resolve findings. — 4193f3ca2, a91a17553, 589b6cae4, 55849fdc4
- [x] 2.3 Publish the PR with UI evidence, labels and verification report. — PR #5; screenshot evidence is preserved on develop and linked from the PR.

The follow-up PR is ready for human review after the complete gate and automated review/autofix pass. Applied the existing bug label. Configured pipeline, in-progress, priority-medium, risk-low and skip-qa labels are absent; the tracker existence guard skips them. GitHub self-approval is unavailable, so the automated review assessment is posted as a report rather than a formal approving review. No QA approval was applied.
