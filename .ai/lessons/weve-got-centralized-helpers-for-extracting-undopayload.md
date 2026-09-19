---
title: "We've got centralized helpers for extracting `UndoPayload`"
modules: ["shared","logistics"]
areas: ["module-data"]
topics: ["command-pattern","weve","centralized","concurrency"]
---

# We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

Safe redo needs the version actually committed by undo, not just an equality check against old values. A later edit can return to the same values while expressing a new decision. Logistics retains that version in its atomic undo receipt, keyed by the original action-log ID, and checks it under the job lock. Canonicalize storage representations (numeric scale, cleared custom fields) independently of this version check; normalization must never remove concurrency protection. Verify real route guards and receipt ordering as well as direct command behavior.
