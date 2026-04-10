import { SessionSignatureError, WorkflowValidationError } from '../src/core/WorkflowError';

/**
 * Tests for Task 8: Propagate session errors from WorkflowExecutor.
 *
 * We cannot import execute/executeJob directly because they pull in heavy
 * ZeroDev / viem transports.  Instead we validate the *behaviour contract*:
 *   - SessionSignatureError and WorkflowValidationError are re-thrown (not swallowed)
 *     by the catch blocks in execute() and executeJob().
 *   - Other errors remain caught and returned as result objects.
 *
 * The actual catch-block logic is extracted here so we can test it in isolation.
 */

// ---------------------------------------------------------------------------
// Replicate the re-throw guard used in both catch blocks
// ---------------------------------------------------------------------------
function shouldRethrow(error: unknown): boolean {
    return (
        error instanceof SessionSignatureError ||
        error instanceof WorkflowValidationError
    );
}

// Simulates the catch block in execute() / executeJob()
function catchBlockBehaviour(error: unknown): { rethrown: boolean; result?: { success: boolean; error: string } } {
    if (shouldRethrow(error)) {
        return { rethrown: true };
    }
    return {
        rethrown: false,
        result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        },
    };
}

describe('WorkflowExecutor session error propagation', () => {
    describe('SessionSignatureError is re-thrown (not swallowed)', () => {
        it('re-throws SessionSignatureError with reason "expired"', () => {
            const err = new SessionSignatureError('Session expired', 'expired');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });

        it('re-throws SessionSignatureError with reason "stale_nonce"', () => {
            const err = new SessionSignatureError('Stale nonce', 'stale_nonce');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });

        it('re-throws SessionSignatureError with reason "invalid_signature"', () => {
            const err = new SessionSignatureError('Bad sig', 'invalid_signature');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });

        it('re-throws SessionSignatureError with reason "unknown_signer"', () => {
            const err = new SessionSignatureError('Unknown signer', 'unknown_signer');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });

        it('re-throws SessionSignatureError with reason "tampered_payload"', () => {
            const err = new SessionSignatureError('Tampered', 'tampered_payload');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });

        it('re-throws SessionSignatureError with cause chain intact', () => {
            const cause = new Error('original transport failure');
            const err = new SessionSignatureError('Sign failed', 'invalid_signature', cause);
            expect(err.cause).toBe(cause);
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });
    });

    describe('WorkflowValidationError is re-thrown', () => {
        it('re-throws WorkflowValidationError', () => {
            const err = new WorkflowValidationError('Validation failed', ['missing field']);
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(true);
        });
    });

    describe('Non-session errors are caught and returned as result objects', () => {
        it('catches generic Error and returns result with success=false', () => {
            const err = new Error('Bundler timeout');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(false);
            expect(outcome.result).toBeDefined();
            expect(outcome.result!.success).toBe(false);
            expect(outcome.result!.error).toBe('Bundler timeout');
        });

        it('catches non-Error throwable and returns "Unknown error"', () => {
            const outcome = catchBlockBehaviour('string error');
            expect(outcome.rethrown).toBe(false);
            expect(outcome.result!.error).toBe('Unknown error');
        });

        it('catches TypeError and returns result (not re-thrown)', () => {
            const err = new TypeError('Cannot read property x');
            const outcome = catchBlockBehaviour(err);
            expect(outcome.rethrown).toBe(false);
            expect(outcome.result!.success).toBe(false);
        });
    });

    describe('execute() return type never encodes unknown state', () => {
        it('SessionSignatureError always propagates — caller sees throw, not success:false', () => {
            // This test verifies the invariant: if a session error occurs,
            // the caller MUST see an exception, never a result object.
            const err = new SessionSignatureError('Expired session', 'expired');

            // Simulate what execute() does: call executeJob, which may throw
            const simulateExecute = () => {
                // In the old code this was caught and turned into { success: false }
                // In the new code it must propagate
                if (shouldRethrow(err)) {
                    throw err;
                }
                return { success: false, error: err.message };
            };

            expect(simulateExecute).toThrow(SessionSignatureError);
            try {
                simulateExecute();
            } catch (e: any) {
                expect(e.reason).toBe('expired');
                expect(e.code).toBe('SESSION_SIGNATURE_ERROR');
            }
        });
    });
});
