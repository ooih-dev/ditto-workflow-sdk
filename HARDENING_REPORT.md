# Ditto SDK Security Hardening Report

Branch: `fix/sdk-security-v2`
Date: 2026-04-10

## Summary

9 security tasks completed addressing 3 CRITICAL and 5 HIGH findings from the 2026-04-09 audit. All fixes include regression tests.

## Tasks Completed

| Task | Title | Severity | Files Changed |
|------|-------|----------|---------------|
| 1 | Re-enable workflow validation on submit/execute | CRITICAL | WorkflowSubmitter.ts, WorkflowExecutor.ts, WorkflowValidator.ts |
| 2 | WASM content hash verification on IPFS download | CRITICAL | WasmRefResolver.ts, IpfsStorage.ts |
| 3 | Fail-closed on stale/invalid session signature | CRITICAL | SessionService.ts |
| 4 | Cap valueLimit in PermissionBuilder | HIGH | PermissionBuilder.ts, constants.ts |
| 5 | Validate IPFS URL/gateway against allow-list | HIGH | IpfsStorage.ts, constants.ts |
| 6 | Fail loudly on missing ABI returns in DataRefResolver | HIGH | DataRefResolver.ts |
| 7 | Recursion depth limit + prototype pollution guard | HIGH | WorkflowSerializer.ts |
| 8 | Propagate session errors from WorkflowExecutor | HIGH | WorkflowExecutor.ts, SessionService.ts |
| 9 | Security regression test suite | - | test/security.spec.ts |

## Verification Results

- `npm run build`: PASS (exit 0)
- `npm run lint`: PASS (0 errors, 180 warnings)
- `npm test`: PASS (9 suites, 133 tests, 0 failures)

## Stats

- Total test suites: 9
- Total tests: 133 (all new — no pre-existing test suite)
- New test files: 9
- Total files changed vs master: 29
- Commits on branch: 10 (including plan commit)

## New Error Types

All new error classes extend `WorkflowError` and are exported from `src/index.ts`:

- `WorkflowValidationError` — malformed workflow rejected at submit/execute
- `WasmHashMismatchError` — WASM bytes don't match expected sha256
- `WasmHashRequiredError` — WASM descriptor missing required hash field
- `SessionSignatureError` — session auth failure (expired, stale nonce, bad sig)
- `IpfsUrlValidationError` — IPFS URL fails allow-list or format check
- `DataRefAbiError` — ABI fragment missing outputs definition
- `WorkflowSerializeDepthError` — recursion depth exceeded during serialization

## Known Issues / Follow-ups

- 180 lint warnings remain (all `@typescript-eslint/no-explicit-any` on pre-existing code) — not in scope for this security-focused branch.
- `ALLOWED_IPFS_GATEWAYS` allow-list should be reviewed and updated as gateway infrastructure evolves.
- `DEFAULT_VALUE_LIMIT` (1 ETH) is conservative; teams may need to adjust per deployment via `allowUnlimited: true` opt-in.
