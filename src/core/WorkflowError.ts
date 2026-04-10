export enum WorkflowErrorCode {
    INVALID_SERIALIZED_DATA = 'INVALID_SERIALIZED_DATA',
    INVALID_CHAIN_ID = 'INVALID_CHAIN_ID',
    INVALID_BIGINT = 'INVALID_BIGINT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    WASM_HASH_MISMATCH = 'WASM_HASH_MISMATCH',
    WASM_HASH_REQUIRED = 'WASM_HASH_REQUIRED',
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