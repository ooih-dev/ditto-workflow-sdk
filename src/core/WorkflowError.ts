export enum WorkflowErrorCode {
    INVALID_SERIALIZED_DATA = 'INVALID_SERIALIZED_DATA',
    INVALID_CHAIN_ID = 'INVALID_CHAIN_ID',
    INVALID_BIGINT = 'INVALID_BIGINT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    WASM_HASH_MISMATCH = 'WASM_HASH_MISMATCH',
    WASM_HASH_REQUIRED = 'WASM_HASH_REQUIRED',
    SESSION_SIGNATURE_ERROR = 'SESSION_SIGNATURE_ERROR',
    IPFS_URL_VALIDATION = 'IPFS_URL_VALIDATION',
    DATA_REF_ABI_ERROR = 'DATA_REF_ABI_ERROR',
    SERIALIZE_DEPTH_EXCEEDED = 'SERIALIZE_DEPTH_EXCEEDED',
    PROTOTYPE_POLLUTION = 'PROTOTYPE_POLLUTION',
}

export class WorkflowError extends Error {
    constructor(
        public readonly code: WorkflowErrorCode,
        message: string,
        public readonly details?: any
    ) {
        super(message);
        this.name = 'WorkflowError';
    }
}

export class WorkflowValidationError extends WorkflowError {
    constructor(
        message: string,
        public readonly validationErrors: string[]
    ) {
        super(WorkflowErrorCode.VALIDATION_FAILED, message, validationErrors);
        this.name = 'WorkflowValidationError';
    }
}

export class WasmHashMismatchError extends WorkflowError {
    constructor(
        public readonly expected: string,
        public readonly actual: string,
        public readonly wasmId: string
    ) {
        super(
            WorkflowErrorCode.WASM_HASH_MISMATCH,
            `WASM content hash mismatch for "${wasmId}": expected ${expected}, got ${actual}`,
            { expected, actual, wasmId }
        );
        this.name = 'WasmHashMismatchError';
    }
}

export class WasmHashRequiredError extends WorkflowError {
    constructor(public readonly wasmId: string) {
        super(
            WorkflowErrorCode.WASM_HASH_REQUIRED,
            `WASM content hash (contentHash) is required for step "${wasmId}" but was not provided`,
            { wasmId }
        );
        this.name = 'WasmHashRequiredError';
    }
}

export class IpfsUrlValidationError extends WorkflowError {
    constructor(
        message: string,
        public readonly url: string
    ) {
        super(
            WorkflowErrorCode.IPFS_URL_VALIDATION,
            message,
            { url }
        );
        this.name = 'IpfsUrlValidationError';
    }
}

export class DataRefAbiError extends WorkflowError {
    constructor(
        message: string,
        public readonly functionSignature: string
    ) {
        super(
            WorkflowErrorCode.DATA_REF_ABI_ERROR,
            message,
            { functionSignature }
        );
        this.name = 'DataRefAbiError';
    }
}

export class WorkflowSerializeDepthError extends WorkflowError {
    constructor(
        public readonly depth: number,
        public readonly maxDepth: number
    ) {
        super(
            WorkflowErrorCode.SERIALIZE_DEPTH_EXCEEDED,
            `Serialization depth ${depth} exceeds maximum allowed depth of ${maxDepth}`,
            { depth, maxDepth }
        );
        this.name = 'WorkflowSerializeDepthError';
    }
}

export class PrototypePollutionError extends WorkflowError {
    constructor(
        public readonly key: string
    ) {
        super(
            WorkflowErrorCode.PROTOTYPE_POLLUTION,
            `Potentially dangerous key "${key}" detected in workflow data`,
            { key }
        );
        this.name = 'PrototypePollutionError';
    }
}

export class SessionSignatureError extends WorkflowError {
    constructor(
        message: string,
        public readonly reason: 'expired' | 'stale_nonce' | 'invalid_signature' | 'unknown_signer' | 'tampered_payload' | 'missing_session' | 'parse_error',
        cause?: Error
    ) {
        super(
            WorkflowErrorCode.SESSION_SIGNATURE_ERROR,
            message,
            { reason, cause: cause?.message }
        );
        this.name = 'SessionSignatureError';
        if (cause) {
            this.cause = cause;
        }
    }
}