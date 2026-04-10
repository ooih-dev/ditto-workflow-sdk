import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WasmRefResolver, computeSha256Hex, WasmRef } from '../src/core/WasmRefResolver';
import { WasmHashMismatchError, WasmHashRequiredError } from '../src/core/WorkflowError';
import { IpfsStorage } from '../src/storage/IpfsStorage';

// Load deterministic WASM fixture
const WASM_FIXTURE = readFileSync(join(__dirname, 'fixtures', 'minimal.wasm'));
const WASM_FIXTURE_HASH = createHash('sha256').update(WASM_FIXTURE).digest('hex');
const WRONG_HASH = 'a'.repeat(64);

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// Mock WASM client
function createMockWasmClient(result: any = { ok: true, result: { value: 42 } }) {
  return { run: jest.fn().mockResolvedValue(result) };
}

// Mock database
function createMockDatabase(wasmBytes: Buffer | null = WASM_FIXTURE) {
  return { getWasmModule: jest.fn().mockResolvedValue(wasmBytes) };
}

function makeWasmRef(overrides: Partial<WasmRef> = {}): WasmRef {
  return {
    wasmHash: '0xabc123',
    contentHash: WASM_FIXTURE_HASH,
    input: { x: 1 },
    id: 'test-wasm-step',
    timeoutMs: 2000,
    ...overrides,
  };
}

describe('computeSha256Hex', () => {
  it('returns correct sha256 for known input', () => {
    const result = computeSha256Hex(Buffer.from('test'));
    expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('returns correct sha256 for WASM fixture', () => {
    expect(computeSha256Hex(WASM_FIXTURE)).toBe(WASM_FIXTURE_HASH);
  });

  it('handles empty buffer', () => {
    const result = computeSha256Hex(Buffer.alloc(0));
    // SHA256 of empty input is the well-known constant
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('WasmRefResolver - content hash verification', () => {
  it('passes when contentHash matches downloaded WASM bytes', async () => {
    const client = createMockWasmClient();
    const db = createMockDatabase();
    const resolver = new WasmRefResolver(client, db, undefined, mockLogger as any);

    const ref = makeWasmRef();
    const result = await resolver.executeWasmStep(ref);

    expect(result.ref).toBe(ref);
    expect(result.result).toEqual({ value: 42 });
    expect(client.run).toHaveBeenCalled();
  });

  it('throws WasmHashMismatchError when hash does not match', async () => {
    const client = createMockWasmClient();
    const db = createMockDatabase();
    const resolver = new WasmRefResolver(client, db, undefined, mockLogger as any);

    const ref = makeWasmRef({ contentHash: WRONG_HASH });

    await expect(resolver.executeWasmStep(ref)).rejects.toThrow(WasmHashMismatchError);
    await expect(resolver.executeWasmStep(ref)).rejects.toMatchObject({
      expected: WRONG_HASH,
      actual: WASM_FIXTURE_HASH,
      wasmId: 'test-wasm-step',
    });
    // WASM client should never be called if hash doesn't match
    expect(client.run).not.toHaveBeenCalled();
  });

  it('throws WasmHashRequiredError when contentHash is missing', async () => {
    const client = createMockWasmClient();
    const db = createMockDatabase();
    const resolver = new WasmRefResolver(client, db, undefined, mockLogger as any);

    const ref = makeWasmRef({ contentHash: '' as any });
    // Empty string is falsy
    await expect(resolver.executeWasmStep(ref)).rejects.toThrow(WasmHashRequiredError);

    // Also test undefined (cast to bypass TS)
    const ref2 = makeWasmRef({ contentHash: undefined as any });
    await expect(resolver.executeWasmStep(ref2)).rejects.toThrow(WasmHashRequiredError);

    expect(client.run).not.toHaveBeenCalled();
  });

  it('handles empty WASM blob from database', async () => {
    const client = createMockWasmClient();
    const db = createMockDatabase(Buffer.alloc(0));
    const resolver = new WasmRefResolver(client, db, undefined, mockLogger as any);

    // Empty buffer has a different hash than the fixture
    const ref = makeWasmRef();
    await expect(resolver.executeWasmStep(ref)).rejects.toThrow(WasmHashMismatchError);
  });

  it('throws when WASM module not found in database', async () => {
    const client = createMockWasmClient();
    const db = createMockDatabase(null);
    const resolver = new WasmRefResolver(client, db, undefined, mockLogger as any);

    const ref = makeWasmRef();
    await expect(resolver.executeWasmStep(ref)).rejects.toThrow('WASM module not found');
  });
});

describe('IpfsStorage - downloadAndVerify', () => {
  const MOCK_URL = 'https://ipfs-service.dittonetwork.io';

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns verified content when hash matches', async () => {
    const storage = new IpfsStorage(MOCK_URL);
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(WASM_FIXTURE.buffer.slice(
        WASM_FIXTURE.byteOffset,
        WASM_FIXTURE.byteOffset + WASM_FIXTURE.byteLength
      )),
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    const result = await storage.downloadAndVerify('QmTestCid', WASM_FIXTURE_HASH);
    expect(Buffer.compare(result, WASM_FIXTURE)).toBe(0);
  });

  it('throws on hash mismatch', async () => {
    const storage = new IpfsStorage(MOCK_URL);
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(WASM_FIXTURE.buffer.slice(
        WASM_FIXTURE.byteOffset,
        WASM_FIXTURE.byteOffset + WASM_FIXTURE.byteLength
      )),
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    await expect(
      storage.downloadAndVerify('QmTestCid', WRONG_HASH)
    ).rejects.toThrow('content hash mismatch');
  });

  it('throws on empty content', async () => {
    const storage = new IpfsStorage(MOCK_URL);
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    await expect(
      storage.downloadAndVerify('QmTestCid', WASM_FIXTURE_HASH)
    ).rejects.toThrow('empty content');
  });

  it('throws on failed download', async () => {
    const storage = new IpfsStorage(MOCK_URL);
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    await expect(
      storage.downloadAndVerify('QmTestCid', WASM_FIXTURE_HASH)
    ).rejects.toThrow('IPFS download failed');
  });
});
