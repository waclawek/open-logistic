---
title: "Confirm the delivery repository after an owner correction"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["repository-target","pull-requests"]
---

# Confirm the delivery repository after an owner correction

A source specification can originate in an upstream worktree while the owner wants delivery in an independent repository. An inherited remote and an earlier PR are not evidence of the current destination. After a correction, verify the requested repository, base branch and existing implementation before any publication. Close an incorrectly opened PR; never reopen it based only on a generic request to continue. Resume from the destination's current code and avoid duplicating changes already imported there.
