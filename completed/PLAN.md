# Ditto SDK Security Hardening v2

## Context
Security audit (2026-04-09) identified 3 CRITICAL and 5 HIGH issues across WorkflowValidator, WasmRefResolver, SessionService, PermissionBuilder, IpfsStorage, DataRefResolver, WorkflowSerializer. The previous `fix/sdk-hardening` attempt drifted into scope creep (mass `any`-to-strict type conversions, ESLint strict mode, broad refactors). This run focuses ONLY on confirmed security findings. Each task MUST include tests proving the fix.

## Guidelines
- No scope creep: do not touch unrelated files, do not refactor `any` types unless a security fix requires it, do not change public API shape.
- Every task must add tests (unit + negative cases) in `test/` covering the fix. New dependencies only if strictly needed.
- Each task is one commit. Codex external review runs per task via Ralphex pipeline.
- Preserve backward compatibility where possible; if a breaking change is required, add a compatibility note in the commit body.
- Before committing each task: run `npm run build` and `npm test`. Lint must pass (`npm run lint`). Do not commit red builds.

## Task 1: [x] Re-enable workflow validation on submit and execute
**Files:** `src/core/execution/WorkflowSubmitter.ts`, `src/core/execution/WorkflowExecutor.ts`, `src/core/validation/WorkflowValidator.ts`
**Problem:** Workflow schema validation was disabled in the submit/execute paths, allowing malformed workflows through to on-chain execution. Zod schema (`WorkflowSchema.ts`) exists but is bypassed.
**Fix:** Call `WorkflowValidator.validate(workflow)` at the start of both `submit()` and `execute()`. Throw `WorkflowValidationError` (or extend `WorkflowError`) with the aggregated Zod issues on failure. No silent catches.
**Tests:** Add `test/WorkflowValidator.spec.ts` cases: valid workflow passes; missing required fields throw; malformed Step/Trigger rejected; negative value fields rejected. Add integration test that mocks `submit()` and asserts it throws for an invalid workflow.

## Task 2: [x] WASM content hash verification on IPFS download
**Files:** `src/core/WasmRefResolver.ts`, `src/storage/IpfsStorage.ts`
**Problem:** WASM blobs are fetched from IPFS by URL/CID and executed without verifying that the returned bytes match the expected hash. A malicious IPFS gateway could serve substituted bytes.
**Fix:** Require an expected `hash` (sha256 of the WASM bytes, hex-encoded) in the DataRef / WasmRef descriptor. After download, compute sha256 of the bytes and compare. On mismatch, throw `WasmHashMismatchError` and refuse to execute. If the descriptor lacks a hash, throw `WasmHashRequiredError` — do NOT fall back to "trust the gateway".
**Tests:** Hash match passes; hash mismatch throws; missing hash throws; empty blob handled. Use a deterministic small WASM fixture under `test/fixtures/`.

## Task 3: [x] Fail-closed on stale/invalid session signature
**Files:** `src/core/builders/SessionService.ts`
**Problem:** When session signature verification fails (stale, expired, or invalid), the code currently falls back to permitting the operation ("fail-open"). This defeats the purpose of session auth.
**Fix:** On any signature verification failure (stale nonce, expired timestamp, bad signature, unknown signer), throw `SessionSignatureError` immediately and abort the operation. No fallback path. Return value must never be "unverified" or "best-effort".
**Tests:** Valid signature passes; expired session throws; stale nonce throws; wrong signer throws; tampered payload throws. All error paths must be covered.

## Task 4: [x] Cap `valueLimit` in PermissionBuilder
**Files:** `src/core/builders/PermissionBuilder.ts`, `src/utils/constants.ts`
**Problem:** `valueLimit` defaults to `MAX_UINT256`, meaning a created session permission has unlimited spend authority. A bug or misuse can drain the smart account.
**Fix:** Introduce a `DEFAULT_VALUE_LIMIT` in `constants.ts` set to a conservative value (e.g. `parseEther("1")` — 1 ETH equivalent). `PermissionBuilder` must require an explicit `valueLimit` OR fall back to `DEFAULT_VALUE_LIMIT`. Throw if caller explicitly passes `MAX_UINT256` without also setting `allowUnlimited: true` opt-in. Document the opt-in flag in JSDoc.
**Tests:** Default usage caps at `DEFAULT_VALUE_LIMIT`; explicit lower value honored; `MAX_UINT256` without opt-in throws; `allowUnlimited: true` permits `MAX_UINT256`.

## Task 5: [x] Validate IPFS URL / gateway against allow-list
**Files:** `src/storage/IpfsStorage.ts`, `src/utils/constants.ts`
**Problem:** `IpfsStorage` accepts arbitrary IPFS gateway URLs from workflow data. A malicious workflow can redirect fetches to attacker-controlled hosts (RPC hijack analog).
**Fix:** Add `ALLOWED_IPFS_GATEWAYS` constant (start with `https://ipfs-service.dittonetwork.io`, `https://ipfs.io`, `https://cloudflare-ipfs.com`). Validate every URL before fetch: must be https, host must be in allow-list, path must match `/ipfs/<cid>` or `/ipns/<name>`. Reject with `IpfsUrlValidationError` otherwise. Allow runtime extension via `IpfsStorage` constructor option `allowedGateways: string[]` for advanced users.
**Tests:** Allowed gateway + valid CID passes; http:// rejected; non-allow-list host rejected; path traversal (`../`) rejected; query strings preserved but validated.

## Task 6: [x] DataRef ABI — fail loudly on missing returns
**Files:** `src/core/DataRefResolver.ts`
**Problem:** When a referenced call has no ABI return definition, `DataRefResolver` silently returns `undefined`/empty, masking configuration bugs and allowing workflows to proceed with uninitialized data.
**Fix:** If the ABI fragment for a DataRef lacks a `outputs` definition, throw `DataRefAbiError` at resolution time. Log the exact function signature for debuggability. Never return undefined from a DataRef resolution on "ABI says no output".
**Tests:** ABI with outputs resolves correctly; ABI without outputs throws; malformed ABI throws with clear message.

## Task 7: [x] Recursion depth limit + prototype pollution guard in WorkflowSerializer
**Files:** `src/core/builders/WorkflowSerializer.ts`
**Problem:** `WorkflowSerializer` recursively walks workflow objects without depth limit — a malicious deeply-nested payload can stack-overflow the process. It also copies keys without filtering `__proto__` / `constructor` / `prototype`, enabling prototype pollution via crafted JSON input.
**Fix:** Introduce `MAX_SERIALIZE_DEPTH = 32`. Track depth through recursion; throw `WorkflowSerializeDepthError` if exceeded. When iterating object keys, skip `__proto__`, `constructor`, `prototype`. Use `Object.create(null)` or a `Map` for intermediate accumulators where possible.
**Tests:** Depth-31 object serializes; depth-33 throws; object with `__proto__` key does not mutate Object prototype; `constructor` key ignored; normal workflow round-trips unchanged.

## Task 8: [x] Propagate session errors from WorkflowExecutor
**Files:** `src/core/execution/WorkflowExecutor.ts`, `src/core/builders/SessionService.ts`
**Problem:** When `SessionService` throws during workflow execution, the error is swallowed in a try/catch and execution continues returning a fake-success result. Callers cannot distinguish success from silent failure.
**Fix:** Remove the swallowing catch. Let `SessionSignatureError` and all session-related errors bubble to the caller. If any try/catch wraps the session path, it must re-throw (or wrap in `WorkflowError` preserving `cause`). `execute()` return type must never encode "unknown" state.
**Tests:** Successful session proceeds; session error propagates to caller; error has original `cause` chain intact.

## Task 9: [x] Security regression test suite
**Files:** `test/security.spec.ts` (new), optionally supporting fixtures in `test/fixtures/`
**Problem:** No single test file covers the security-critical invariants — fixes can regress silently.
**Fix:** Create `test/security.spec.ts` that imports and exercises the fixes from Tasks 1-8 end-to-end as integration-ish scenarios:
- Submit with invalid workflow throws (Task 1)
- WASM tampering throws (Task 2)
- Expired session throws (Task 3, 8)
- Default `valueLimit` is bounded (Task 4)
- Malicious IPFS URL rejected (Task 5)
- Empty-output ABI throws (Task 6)
- Deep/prototype-polluting payload rejected (Task 7)
Each scenario must have a pass case and a fail case. Use mocks where on-chain interaction is needed.

## Task 10: [x] Final verification — build, lint, full test suite
**Files:** n/a (CI-style run)
**Goal:** Verify the whole branch is green before declaring done.
**Steps:**
- `npm run build` — must exit 0.
- `npm run lint` — must report 0 errors (warnings acceptable, record count in commit body).
- `npm test` — must pass all suites including the new `test/security.spec.ts`.
- Count: total tests, new tests added, total files changed vs master. Write summary to `HARDENING_REPORT.md` at repo root with: tasks done, files touched, test counts, any follow-ups or known issues.
- Commit `HARDENING_REPORT.md` as the final commit of this branch.
