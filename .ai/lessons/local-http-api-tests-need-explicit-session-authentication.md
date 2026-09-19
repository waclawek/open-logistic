---
title: "Local HTTP API tests need explicit session authentication"
modules: ["logistics"]
areas: ["integration", "testing"]
topics: ["authentication", "fixtures", "cookies"]
---

# Local HTTP API tests need explicit session authentication

A successful login response does not prove that later API calls carry its session. A production build can issue Secure cookies that a Playwright API client omits over the managed local HTTP URL. Inspect cookie names and attributes in the trace without printing values before treating a subsequent 401 as a domain failure.

For API-focused scenarios, use the real login-issued bearer token and retain the selected tenant/organization cookies. Keep tokens within the test fixture and preserve production cookie security. Session-cookie/browser authentication needs separate browser coverage; bearer-authenticated API passes do not establish that coverage.
