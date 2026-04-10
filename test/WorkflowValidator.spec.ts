import { Workflow } from '../src/core/Workflow';
import { Job } from '../src/core/Job';
import { Step } from '../src/core/Step';
import { ValidatorStatus, WorkflowValidator } from '../src/core/validation/WorkflowValidator';
import { WorkflowValidationError } from '../src/core/WorkflowError';
import { Account, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Use a real viem account as a mock signer — WorkflowValidator only reads .address
const MOCK_OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as any as Account;
const VALID_TARGET = '0x1234567890abcdef1234567890abcdef12345678' as Address;
const IPFS_URL = 'https://ipfs-service.dittonetwork.io';

function makeValidWorkflow(overrides?: Partial<{
  owner: Account;
  count: number;
  interval: number;
  validAfter: Date;
  validUntil: Date;
  jobs: any[];
  triggers: any[];
}>): Workflow {
  const defaults = {
    owner: MOCK_OWNER,
    count: 1,
    interval: 60,
    validAfter: new Date(Date.now() - 1000),
    validUntil: new Date(Date.now() + 3600_000),
    triggers: [{
      type: 'cron' as const,
      params: { schedule: '*/5 * * * *' },
    }],
    jobs: [new Job('job-1', [
      new Step({
        target: VALID_TARGET,
        abi: 'transfer(address,uint256)',
        args: [VALID_TARGET, BigInt(100)],
        value: BigInt(0),
      }),
    ], 8453)], // BASE chain
  };
  return new Workflow({ ...defaults, ...overrides });
}

describe('WorkflowValidator', () => {
  describe('valid workflows', () => {
    it('should pass validation for a well-formed workflow', async () => {
      const workflow = makeValidWorkflow();
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.Success);
      expect(result.errors).toEqual([]);
    });
  });

  describe('missing required fields', () => {
    it('should reject workflow with zero-address owner', async () => {
      const zeroOwner = { address: '0x0000000000000000000000000000000000000000' } as any as Account;
      const workflow = makeValidWorkflow({ owner: zeroOwner });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidOwner);
      expect(result.errors).toContain('owner is zero address');
    });

    it('should reject workflow with negative count', async () => {
      const workflow = makeValidWorkflow({ count: -1 });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidCount);
      expect(result.errors).toContain('count must be positive');
    });

    it('should reject workflow with zero count', async () => {
      const workflow = makeValidWorkflow({ count: 0 });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidCount);
      expect(result.errors).toContain('count must be positive');
    });

    it('should reject workflow with negative interval', async () => {
      const workflow = makeValidWorkflow({ interval: -10 });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidInterval);
      expect(result.errors).toContain('interval must be positive');
    });
  });

  describe('invalid dates', () => {
    it('should reject workflow where validAfter >= validUntil', async () => {
      const now = new Date();
      const workflow = makeValidWorkflow({
        validAfter: new Date(now.getTime() + 7200_000),
        validUntil: new Date(now.getTime() + 3600_000),
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidDates);
      expect(result.errors).toContain('validAfter must be before validUntil');
    });

    it('should reject workflow where validUntil is in the past', async () => {
      const workflow = makeValidWorkflow({
        validAfter: undefined,
        validUntil: new Date(Date.now() - 1000),
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidDates);
      expect(result.errors).toContain('validUntil must be in the future');
    });
  });

  describe('malformed steps', () => {
    it('should reject step with invalid target address', async () => {
      // Bypass Step constructor validation by directly setting the field
      const step = new Step({
        target: VALID_TARGET,
        abi: '',
        args: [],
        value: BigInt(0),
      });
      // Force invalid target after construction
      (step as any).target = 'not-an-address';
      const job = new Job('job-1', [], 8453);
      job.steps.push(step);
      const workflow = makeValidWorkflow({ jobs: [job] });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidStep);
      expect(result.errors.some(e => e.includes('invalid target address'))).toBe(true);
    });

    it('should reject step with negative value', async () => {
      const workflow = makeValidWorkflow({
        jobs: [new Job('job-1', [
          new Step({
            target: VALID_TARGET,
            abi: 'transfer(address,uint256)',
            args: [VALID_TARGET, BigInt(100)],
            value: BigInt(-1),
          }),
        ], 8453)],
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidStep);
      expect(result.errors.some(e => e.includes('negative value'))).toBe(true);
    });

    it('should reject step with mismatched ABI args count', async () => {
      // Bypass Step constructor validation by mutating args after construction
      const step = new Step({
        target: VALID_TARGET,
        abi: 'transfer(address,uint256)',
        args: [VALID_TARGET, BigInt(100)],
        value: BigInt(0),
      });
      // Force mismatched args after construction
      (step as any).args = [VALID_TARGET]; // missing second arg
      const job = new Job('job-1', [], 8453);
      job.steps.push(step);
      const workflow = makeValidWorkflow({ jobs: [job] });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidStep);
      expect(result.errors.some(e => e.includes('invalid abi or args'))).toBe(true);
    });
  });

  describe('malformed triggers', () => {
    it('should reject event trigger with invalid contract address', async () => {
      const workflow = makeValidWorkflow({
        triggers: [{
          type: 'event' as const,
          params: {
            signature: 'Transfer(address,address,uint256)',
            contractAddress: 'not-valid' as Address,
            chainId: 8453,
          },
        }],
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidTrigger);
      expect(result.errors.some(e => e.includes('invalid contract address'))).toBe(true);
    });

    it('should reject event trigger with invalid signature', async () => {
      const workflow = makeValidWorkflow({
        triggers: [{
          type: 'event' as const,
          params: {
            signature: '!!!not-a-valid-sig',
            contractAddress: VALID_TARGET,
            chainId: 8453,
          },
        }],
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.InvalidTrigger);
      expect(result.errors.some(e => e.includes('invalid event trigger signature'))).toBe(true);
    });
  });

  describe('duplicate chain IDs', () => {
    it('should reject jobs with duplicate chain IDs', async () => {
      const workflow = makeValidWorkflow({
        jobs: [
          new Job('job-1', [new Step({
            target: VALID_TARGET,
            abi: '',
            args: [],
            value: BigInt(0),
          })], 8453),
          new Job('job-2', [new Step({
            target: VALID_TARGET,
            abi: '',
            args: [],
            value: BigInt(0),
          })], 8453),
        ],
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.DuplicateChainId);
      expect(result.errors.some(e => e.includes('duplicate chainId'))).toBe(true);
    });
  });

  describe('unsupported chain ID', () => {
    it('should reject job with unsupported chain ID', async () => {
      const workflow = makeValidWorkflow({
        jobs: [new Job('job-1', [new Step({
          target: VALID_TARGET,
          abi: '',
          args: [],
          value: BigInt(0),
        })], 999999)],
      });
      const result = await WorkflowValidator.validate(workflow, MOCK_OWNER as any, IPFS_URL);
      expect(result.status).toBe(ValidatorStatus.UnsupportedChainId);
      expect(result.errors.some(e => e.includes('unsupported chain'))).toBe(true);
    });
  });
});

describe('WorkflowValidationError', () => {
  it('should carry validation errors and correct error code', () => {
    const errors = ['count must be positive', 'invalid owner address'];
    const err = new WorkflowValidationError('Workflow validation failed', errors);
    expect(err.name).toBe('WorkflowValidationError');
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.validationErrors).toEqual(errors);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('submitWorkflow validation integration', () => {
  // We test that submitWorkflow throws WorkflowValidationError for invalid workflows
  // by importing the function and giving it an invalid workflow.
  // We mock the parts that require network (serialize, storage, contract).
  it('should throw WorkflowValidationError when workflow is invalid', async () => {
    // Dynamically import to allow jest mocking
    jest.resetModules();

    // Mock the heavy dependencies that require network
    jest.mock('../src/core/builders/WorkflowSerializer', () => ({
      serialize: jest.fn().mockResolvedValue('{}'),
    }));
    jest.mock('../src/storage/IpfsStorage', () => ({}));
    jest.mock('../src/contracts/WorkflowContract', () => ({
      WorkflowContract: jest.fn().mockImplementation(() => ({
        createWorkflow: jest.fn().mockResolvedValue({}),
      })),
    }));

    const { submitWorkflow } = await import('../src/core/execution/WorkflowSubmitter');
    const { WorkflowValidationError: WVE } = await import('../src/core/WorkflowError');

    const zeroOwner = { address: '0x0000000000000000000000000000000000000000' } as any;
    const invalidWorkflow = makeValidWorkflow({ owner: zeroOwner });
    const mockStorage = { upload: jest.fn(), download: jest.fn() } as any;

    await expect(
      submitWorkflow(invalidWorkflow, VALID_TARGET, mockStorage, MOCK_OWNER as any, false, IPFS_URL)
    ).rejects.toThrow(WVE);
  });
});
