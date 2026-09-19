# Windows managed-test startup output

## Summary

The official ephemeral test runner starts the application through detached `yarn.cmd` on Windows. In a reproduced OS-level probe, that process returns an exit code but loses both output streams. This hides the application's startup failure. The user authorized a bounded CLI launcher/capture correction on 2026-09-19 as a prerequisite to logistics integration verification.

## Design

Only the managed testing launch path changes. On Windows when detaching Yarn, launch a fixed Node wrapper through `process.execPath`; it invokes the existing validated Yarn command/argument array through the CLI's existing cross-spawn dependency without detaching the nested command. This preserves active Yarn selection and avoids guessing Corepack/global installation paths. No user values are interpolated into executable source. Keep the wrapper detached, hidden and owned by the existing process-tree lifecycle. POSIX and non-detached launch selection remain unchanged.

Always pipe and retain bounded stdout/stderr. Silent mode retains diagnostics; verbose mode also forwards each stream to its corresponding terminal stream. The existing readiness error consumes the same combined tail. Inherited stdin behavior remains available in verbose mode.

## Scope and acceptance

Files: CLI integration launcher and focused launcher tests. Existing CLI command names, environment selection, argument validation, working directory, exit status, process-tree termination, readiness checks, database lifecycle and limits remain intact. No production dependency, generated-file, application schema, API or UI change.

Run real Windows child-process regressions for both streams, nonzero exit, arguments containing spaces/shell punctuation, cwd/environment propagation, silent/verbose capture and owned-tree termination. Run existing readiness/output/shutdown tests and CLI build, then rerun the official isolated runner. Inspect the first observable startup failure before selecting a further fix; output capture alone is not proof of runtime readiness. Integration fixtures remain in their owning modules and use the managed disposable database.

## Migration & Backward Compatibility

No public contract removal or change; additive internal test access only. No flags, migrations, template-script or QA-policy changes. Rollback restores the prior launcher implementation without changing application data. No standalone harness catalog surface is introduced.

## Status / Changelog

- 2026-09-19: Authorized prerequisite; direct-node wrapper probe preserved stdout, stderr and exit7. Implemented the wrapper and capture/tee path. Local Windows validation: six real process tests plus existing readiness/shutdown/spawn tests (54 passed, two POSIX-only skipped); CLI build passed. Strict scoped launcher/test compilation passed after including the existing CLI cross-spawn ambient declaration. Independent review approved and was merged. The official managed runner now reaches readiness and executes Playwright; capture exposed a rejected placeholder JWT during the earlier attempt. A process-only randomly generated test JWT supplied through the existing environment contract allowed startup without authentication-policy changes. Logistics HTTP assertions remain separately tracked.
