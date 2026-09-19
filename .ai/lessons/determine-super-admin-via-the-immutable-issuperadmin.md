---
title: "Determine super-admin via the immutable `isSuperAdmin` flag, never by role name"
modules: ["auth","events","logistics"]
areas: ["testing","module-data","debugging"]
topics: ["access-control","command-pattern","data-scoping"]
---

# Determine super-admin via the immutable `isSuperAdmin` flag, never by role name

**Context**: The scheduler module gated system-scoped jobs (create/update/delete commands, the create route, the trigger route, and the list visibility filter) by checking whether the auth context's `roles` array contained a string equal to `'superadmin'`.

**Problem**: Role names are tenant-mutable and trivially spoofable — any tenant that creates a role literally named `superadmin` would have passed the gate, while a genuine super-admin whose role happens to be named differently would have been denied. Comparing user names or role names to a hard-coded `'superadmin'` string is a privilege-escalation footgun and contradicts the project rule against `requireRoles`.

**Rule**: Determine super-admin status only from the immutable `auth.isSuperAdmin === true` flag, which is derived at session/API-key resolution from the `RoleAcl.is_super_admin` / `UserAcl.is_super_admin` columns (`packages/core/src/modules/auth/lib/sessionIntegrity.ts`). Never compare `auth.roles`, usernames, or any user-supplied name to a privileged string. For non-super-admin authorization prefer feature-based guards (`requireFeatures` + immutable IDs from `acl.ts`). Add a regression test that a spoofed role named `superadmin` (without the `isSuperAdmin` flag) is rejected.

**Applies to**: every authorization check — API routes, command handlers, list/visibility filters, widgets, AI tools — across all modules. Audit for `=== 'superadmin'`, `.includes('superadmin')`, and `roles.some(... 'superadmin')` and replace with `auth?.isSuperAdmin === true`.

**Fresh command authorization refinement (2026-09-19)**: The flag is a trusted identity attribute, not a permanently valid grant. Logistics must reload current permissions for mutations and receipt reads. The directory resolver combines the incoming flag with the freshly loaded ACL using OR; passing a stale true flag into `resolveFresh` therefore preserved revoked organization authority. The app-specific command boundary now clears the incoming flag for that fresh reload, allowing only the newly loaded ACL to grant superadmin. Tests against the actual default resolver prove revoked authority fails while current superadmins and authorized descendants still work. Explicit null/all-organizations selection must fail scope-required rather than silently falling back to the actor's home organization. See logistics command authorization closure and `commands/context.ts`.

**HTTP selection refinement (2026-09-19)**: A restricted user's explicit all-organizations cookie can be converted to its account organization by the request resolver before command authorization sees it. Preserve that explicit request intent at the app boundary: reject the platform all-organizations cookie token even when a resolved selectedId is concrete. Prove this with real HTTP coverage as well as direct command tests; a mocked null selectedId alone missed the runtime fallback.
