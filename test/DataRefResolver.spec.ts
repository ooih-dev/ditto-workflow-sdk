import { DataRefResolver, DataRef, parseDataRef, createDataRefString, DATA_REF_PREFIX } from '../src/core/DataRefResolver';
import { DataRefAbiError } from '../src/core/WorkflowError';
import { Address } from 'viem';

// Mock dependencies
jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: jest.fn().mockReturnValue({
      getBlockNumber: jest.fn().mockResolvedValue(BigInt(12345)),
      readContract: jest.fn().mockResolvedValue(BigInt(1000)),
    }),
    http: jest.fn().mockReturnValue({}),
  };
});

jest.mock('../src/utils/chainConfigProvider', () => ({
  getChainConfig: jest.fn().mockReturnValue({
    1: {
      rpcUrl: 'https://rpc.example.com',
      chain: { id: 1, name: 'Ethereum' },
    },
  }),
}));

jest.mock('../src/utils/httpTransport', () => ({
  authHttpConfig: jest.fn().mockReturnValue({}),
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const TEST_ADDRESS: Address = '0x1234567890abcdef1234567890abcdef12345678';

describe('DataRefResolver - ABI validation', () => {
  let resolver: DataRefResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    resolver = new DataRefResolver('https://ipfs.example.com', undefined, undefined, mockLogger as any);
  });

  describe('ABI with outputs resolves correctly', () => {
    it('should resolve a DataRef with explicit returns clause', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'balanceOf(address) view returns (uint256)',
        args: [TEST_ADDRESS],
        chainId: 1,
      };

      const result = await resolver.resolveRef(ref);
      expect(result.value).toBe(BigInt(1000));
      expect(result.blockNumber).toBe(BigInt(12345));
      expect(result.ref).toBe(ref);
    });

    it('should resolve a DataRef with returns (no view modifier)', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'getPrice() returns (uint256)',
        args: [],
        chainId: 1,
      };

      const result = await resolver.resolveRef(ref);
      expect(result.value).toBe(BigInt(1000));
    });
  });

  describe('ABI without outputs throws DataRefAbiError', () => {
    it('should throw when ABI has no returns clause', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'balanceOf(address)',
        args: [TEST_ADDRESS],
        chainId: 1,
      };

      await expect(resolver.resolveRef(ref)).rejects.toThrow(DataRefAbiError);
      await expect(resolver.resolveRef(ref)).rejects.toThrow(/missing a returns clause/);
    });

    it('should include the function signature in the error', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'getBalance()',
        args: [],
        chainId: 1,
      };

      try {
        await resolver.resolveRef(ref);
        fail('Expected DataRefAbiError');
      } catch (error) {
        expect(error).toBeInstanceOf(DataRefAbiError);
        expect((error as DataRefAbiError).functionSignature).toBe('getBalance()');
      }
    });

    it('should throw for bare function name without returns', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'totalSupply()',
        args: [],
        chainId: 1,
      };

      await expect(resolver.resolveRef(ref)).rejects.toThrow(DataRefAbiError);
    });
  });

  describe('Malformed ABI throws with clear message', () => {
    it('should throw DataRefAbiError for completely invalid ABI string', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: '!!!invalid returns (uint256)',
        args: [],
        chainId: 1,
      };

      await expect(resolver.resolveRef(ref)).rejects.toThrow(DataRefAbiError);
      await expect(resolver.resolveRef(ref)).rejects.toThrow(/Malformed ABI/);
    });

    it('should throw DataRefAbiError for ABI with returns but unparseable', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'returns (((broken',
        args: [],
        chainId: 1,
      };

      await expect(resolver.resolveRef(ref)).rejects.toThrow(DataRefAbiError);
    });
  });

  describe('Error never returns undefined', () => {
    it('should never silently return undefined for missing returns', async () => {
      const ref: DataRef = {
        target: TEST_ADDRESS,
        abi: 'doSomething(uint256)',
        args: [BigInt(1)],
        chainId: 1,
      };

      // Must throw, never return undefined
      let result: any = 'not_called';
      try {
        result = await resolver.resolveRef(ref);
      } catch (error) {
        expect(error).toBeInstanceOf(DataRefAbiError);
      }
      expect(result).toBe('not_called');
    });
  });
});
