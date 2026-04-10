import { validateSessionParams, validateSerializedSession } from '../src/core/builders/SessionService';
import { SessionSignatureError } from '../src/core/WorkflowError';
import { Workflow } from '../src/core/Workflow';
import { Job } from '../src/core/Job';
import { Address } from 'viem';

// Helper to create a valid base64url-encoded session object
function encodeSession(data: object): string {
    const json = JSON.stringify(data);
    const base64 = Buffer.from(json).toString('base64');
    // Convert to base64url
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Minimal valid session payload (mirrors ZeroDev format)
const VALID_SESSION_DATA = {
    validatorAddress: '0x1234567890abcdef1234567890abcdef12345678',
    executorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    enableData: '0x00',
    isPreInstalled: false,
};

const VALID_SESSION_STR = encodeSession(VALID_SESSION_DATA);

const VALID_EXECUTOR: Address = '0x1234567890abcdef1234567890abcdef12345678';
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

function makeMockWorkflow(overrides: Partial<{ validUntil: Date; validAfter: Date }> = {}): Workflow {
    return {
        validUntil: overrides.validUntil,
        validAfter: overrides.validAfter,
        count: 1,
        interval: 60,
        triggers: [],
        jobs: [],
        owner: { address: VALID_EXECUTOR, type: 'local' } as any,
    } as unknown as Workflow;
}

function makeMockJob(chainId = 1): Job {
    return { id: 'job-1', steps: [], chainId, session: VALID_SESSION_STR } as any;
}

// Minimal mock signer that looks like a ZeroDev Signer
const mockSigner = {
    address: VALID_EXECUTOR,
    signMessage: async () => '0x00',
    signTypedData: async () => '0x00',
} as any;

describe('validateSessionParams', () => {
    it('passes with valid parameters', () => {
        const workflow = makeMockWorkflow();
        const job = makeMockJob();
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, mockSigner)).not.toThrow();
    });

    it('throws SessionSignatureError for zero executor address', () => {
        const workflow = makeMockWorkflow();
        const job = makeMockJob();
        expect(() => validateSessionParams(workflow, job, ZERO_ADDRESS, mockSigner))
            .toThrow(SessionSignatureError);
        try {
            validateSessionParams(workflow, job, ZERO_ADDRESS, mockSigner);
        } catch (e: any) {
            expect(e.reason).toBe('unknown_signer');
        }
    });

    it('throws SessionSignatureError for null/undefined owner', () => {
        const workflow = makeMockWorkflow();
        const job = makeMockJob();
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, null as any))
            .toThrow(SessionSignatureError);
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, undefined as any))
            .toThrow(SessionSignatureError);
    });

    it('throws SessionSignatureError for expired session (validUntil in the past)', () => {
        const pastDate = new Date(Date.now() - 60000); // 1 minute ago
        const workflow = makeMockWorkflow({ validUntil: pastDate });
        const job = makeMockJob();
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, mockSigner))
            .toThrow(SessionSignatureError);
        try {
            validateSessionParams(workflow, job, VALID_EXECUTOR, mockSigner);
        } catch (e: any) {
            expect(e.reason).toBe('expired');
        }
    });

    it('passes for session with validUntil in the future', () => {
        const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
        const workflow = makeMockWorkflow({ validUntil: futureDate });
        const job = makeMockJob();
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, mockSigner)).not.toThrow();
    });

    it('throws SessionSignatureError for missing chain ID', () => {
        const workflow = makeMockWorkflow();
        const job = makeMockJob(0);
        expect(() => validateSessionParams(workflow, job, VALID_EXECUTOR, mockSigner))
            .toThrow(SessionSignatureError);
    });
});

describe('validateSerializedSession', () => {
    it('passes for valid base64url-encoded session', () => {
        expect(() => validateSerializedSession(VALID_SESSION_STR)).not.toThrow();
    });

    it('throws SessionSignatureError for empty session string', () => {
        expect(() => validateSerializedSession('')).toThrow(SessionSignatureError);
        try {
            validateSerializedSession('');
        } catch (e: any) {
            expect(e.reason).toBe('missing_session');
        }
    });

    it('throws SessionSignatureError for whitespace-only session string', () => {
        expect(() => validateSerializedSession('   ')).toThrow(SessionSignatureError);
    });

    it('throws SessionSignatureError for invalid base64 (tampered payload)', () => {
        // Not valid base64url that decodes to JSON
        expect(() => validateSerializedSession('not-valid-base64-json!!!')).toThrow(SessionSignatureError);
        try {
            validateSerializedSession('not-valid-base64-json!!!');
        } catch (e: any) {
            expect(e.reason).toBe('parse_error');
        }
    });

    it('throws SessionSignatureError when decoded data is not an object', () => {
        // Encode a primitive value instead of an object
        const primitiveSession = encodeSession('just a string' as any);
        // JSON.parse of a string literal is still a string, not an object
        const base64 = Buffer.from('"just a string"').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(() => validateSerializedSession(base64)).toThrow(SessionSignatureError);
        try {
            validateSerializedSession(base64);
        } catch (e: any) {
            expect(e.reason).toBe('tampered_payload');
        }
    });

    it('throws SessionSignatureError for null-encoded session', () => {
        const nullSession = Buffer.from('null').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(() => validateSerializedSession(nullSession)).toThrow(SessionSignatureError);
        try {
            validateSerializedSession(nullSession);
        } catch (e: any) {
            expect(e.reason).toBe('tampered_payload');
        }
    });
});

describe('SessionSignatureError', () => {
    it('has correct name and code', () => {
        const error = new SessionSignatureError('test', 'expired');
        expect(error.name).toBe('SessionSignatureError');
        expect(error.code).toBe('SESSION_SIGNATURE_ERROR');
        expect(error.reason).toBe('expired');
    });

    it('preserves cause chain when provided', () => {
        const cause = new Error('original error');
        const error = new SessionSignatureError('wrapper', 'invalid_signature', cause);
        expect(error.cause).toBe(cause);
        expect(error.details.cause).toBe('original error');
    });

    it('works without a cause', () => {
        const error = new SessionSignatureError('no cause', 'stale_nonce');
        expect(error.cause).toBeUndefined();
        expect(error.reason).toBe('stale_nonce');
    });
});
