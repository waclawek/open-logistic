---
title: "Retain required command reasons atomically"
modules: ["logistics","audit_logs"]
areas: ["module-data","testing"]
topics: ["command-pattern","data-integrity"]
---

# Retain required command reasons atomically

**Context**: A cancellation committed its terminal state and receipt before CommandBus persisted separate audit metadata.

**Problem**: Audit failure followed by a receipt replay permanently lost the mandatory cancellation reason.

**Rule**: Retain mandatory domain evidence in the same transaction as the domain mutation and receipt, using platform encryption. Treat postcommit audit as secondary. Test failure and retry through the actual CommandBus.
