# CodeGuard AI Security, UI, and UX Audit

Date: 2026-07-01

## Executive Summary

I reviewed the React/Vite frontend and Express backend for security, UI, and UX issues. The highest-impact backend issues found in this pass were fixed immediately: permissive CORS defaults, missing abuse throttling, raw server error exposure, unsafe report lookup construction, production exposure of local demo data, and insufficient total extraction limits for uploaded archives.

No production dependency vulnerabilities were reported by `npm audit --omit=dev`.

## Critical Findings

No confirmed critical vulnerabilities remain after this pass.

## High Severity

### H-1: Local demo storage could be exposed in production

Status: Fixed

Location: `backend/src/services/supabaseStore.js:182`, `backend/src/services/supabaseStore.js:1101`; `backend/src/config.js:11`

Evidence: When Supabase was not configured, local seed data and local mutation paths were available. The code now gates local demo storage behind `config.enableLocalDemo`, which defaults to development-only unless `ENABLE_LOCAL_DEMO=true`.

Impact: If deployed without Supabase, a public instance could expose seeded project/user data and allow demo mutations.

Fix: Added `enableLocalDemo` config and `requireLocalDemoMode()` checks before local fallback reads/writes.

### H-2: Report lookup used interpolated filter syntax

Status: Fixed

Location: `backend/src/services/supabaseStore.js:481`, `backend/src/services/supabaseStore.js:520`, `backend/src/services/supabaseStore.js:1107`

Evidence: Report IDs are now validated with `validateLookupId()` and fetched through separate `.eq()` queries instead of interpolating IDs into `.or(...)` filter syntax.

Impact: Malformed IDs could interfere with storage query filters or trigger unexpected backend errors.

Fix: Added strict ID validation and parameterized report lookup by `id` then `project_id`.

### H-3: Archive uploads lacked a total extracted-size budget

Status: Fixed

Location: `backend/src/config.js:2`, `backend/src/services/archive.js:25`, `backend/src/services/archive.js:64`

Evidence: Per-file and file-count limits existed, but total extracted bytes were not capped. The extractor now enforces `MAX_TOTAL_EXTRACTED_MB`, defaulting to 25 MB.

Impact: A large archive with many acceptable small files could burn memory/CPU during analysis.

Fix: Added total extracted byte tracking for ZIP, RAR, and single-file flows.

## Medium Severity

### M-1: CORS default was too permissive for credentialed requests

Status: Fixed

Location: `backend/src/config.js:6`, `backend/server.js:96`, `backend/server.js:409`

Evidence: CORS no longer defaults to a broad `true` origin. The server now allows configured origins, no-origin same-server requests, and development loopback/private LAN origins only outside production.

Impact: Broad CORS with credentials increases cross-origin abuse risk if tokens/cookies are present.

Fix: Added explicit CORS origin validation and security regression test.

### M-2: Auth/upload/admin endpoints had no app-level throttling

Status: Fixed

Location: `backend/server.js:61`, `backend/server.js:131`, `backend/server.js:251`, `backend/server.js:388`

Evidence: Added in-memory rate limiters for login, registration, upload analysis, and admin/project mutations.

Impact: Brute-force login attempts, repeated registrations, and upload-analysis abuse could consume resources.

Fix: Added scoped rate limiting with `429` responses and `Retry-After`.

### M-3: 500 errors exposed raw internal messages

Status: Fixed

Location: `backend/server.js:359`, `backend/server.js:426`, `backend/server.js:434`

Evidence: The error handler now returns generic text for server errors while preserving safe 4xx messages.

Impact: Raw errors can reveal internals useful to attackers.

Fix: Added `statusFromError()` and `publicErrorMessage()`.

### M-4: Frontend fallback auth session persisted in localStorage

Status: Improved

Location: `frontend/src/lib/api.js:29`, `frontend/src/lib/api.js:42`, `frontend/src/lib/api.js:155`

Evidence: The backend fallback session now uses `sessionStorage` and migrates/removes old `localStorage` session data.

Impact: Persistent browser storage increases token exposure if XSS or local machine compromise occurs.

Fix: Moved fallback session persistence to session storage. Full mitigation would require server-managed `HttpOnly` cookies.

## Low Severity / Defense In Depth

### L-1: Express fingerprint header was not explicitly disabled

Status: Fixed

Location: `backend/server.js:81`

Evidence: Added `app.disable('x-powered-by')`.

Impact: Reduces framework fingerprinting.

### L-2: API 404s were not explicitly JSON

Status: Fixed

Location: `backend/server.js:354`

Evidence: Added `/api` JSON 404 handler.

Impact: More predictable API behavior and cleaner UX for bad endpoints.

### L-3: Frontend route IDs were not URL-encoded before API calls

Status: Fixed

Location: `frontend/src/lib/api.js:123`, `frontend/src/lib/api.js:127`, `frontend/src/lib/api.js:145`

Evidence: IDs are now passed through `encodeURIComponent()`.

Impact: Prevents malformed IDs from changing route structure.

## UI/UX Findings

### UX-1: Reports page showed stale demo evidence

Status: Fixed earlier in this session

Location: `frontend/src/App.jsx:90`, `frontend/src/App.jsx:2114`, `frontend/src/data/mockData.js`

Evidence: `selectedReport` now starts as `null`; reports render a proper empty state until a real report is opened.

### UX-2: Settings email overflowed on smaller screens

Status: Fixed earlier in this session

Location: `frontend/src/styles.css:2464`

Evidence: Settings cards now auto-fit and long values wrap.

### UX-3: Upload placeholders and branding were stale

Status: Fixed earlier in this session

Location: `frontend/src/App.jsx:1814`; `frontend/index.html:8`

Evidence: Placeholders now use the requested thesis/student values; app metadata now uses CodeGuard AI.

## Remaining Recommendations

### R-1: Use HttpOnly server-managed sessions for production auth

The current Supabase/browser-token flow is workable for a SPA, but stronger production security would use server-managed `HttpOnly`, `Secure`, `SameSite` cookies or a backend-for-frontend pattern. This is an architectural change, not a quick patch.

### R-2: Verify Supabase RLS policies against real production data

The backend checks ownership/admin role in code, and the schema includes RLS, but production should verify policies with real roles and service-role boundaries.

### R-3: Add CI checks

Add `npm ci`, `npm test`, `npm run build`, and `npm audit --omit=dev` to CI so regressions are caught before deployment.

### R-4: Review production CORS and deployment origins

Set `CORS_ORIGIN` explicitly in production if frontend and backend are on different origins. Same-origin production deployments do not need broad CORS.

## Verification

Commands run:

```text
npm test
npm run build
npm audit --omit=dev --json
npm audit --workspace backend --omit=dev --json
npm audit --workspace frontend --omit=dev --json
```

Browser UI regression checks passed for desktop and mobile:

- Reports page shows `No report selected`
- Old demo report text is not visible
- Settings email does not overflow
- Upload placeholders are correct
