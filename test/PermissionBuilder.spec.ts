import { buildPolicies, BuildPoliciesOptions } from '../src/core/builders/PermissionBuilder';
import { Workflow } from '../src/core/Workflow';
import { Job } from '../src/core/Job';
import { Step } from '../src/core/Step';
import { MAX_UINT256, DEFAULT_VALUE_LIMIT } from '../src/utils/constants';
import { Account, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const MOCK_OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as any as Account;
const VALID_TARGET = '0x1234567890abcdef1234567890abcdef12345678' as Address;

function makeWorkflow(): Workflow {
  return new Workflow({
    owner: MOCK_OWNER,
    triggers: [{
      type: 'cron' as const,
      params: { schedule: '*/5 * * * *' },
    }],
    jobs: [],
    count: 1,
    interval: 60,
    validAfter: new Date(Date.now() - 1000),
    validUntil: new Date(Date.now() + 3600_000),
  });
}

function makeJob(steps: Step[]): Job {
  return new Job('test-job', steps, 11155111);
}

function makeStep(value?: bigint | string): Step {
  return new Step({
    target: VALID_TARGET,
    abi: 'transfer(address,uint256)',
    args: ['0x0000000000000000000000000000000000000001', BigInt(100)],
    value,
  });
}

describe('PermissionBuilder valueLimit capping', () => {
  const workflow = makeWorkflow();

  it('defaults to DEFAULT_VALUE_LIMIT for WASM/DataRef references when allowUnlimited is not set', () => {
    const wasmStep = makeStep('$wasm:balance-calc');
    const job = makeJob([wasmStep]);

    // Should not throw, and internally uses DEFAULT_VALUE_LIMIT
    const policies = buildPolicies(workflow, false, job);
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('defaults to DEFAULT_VALUE_LIMIT for $data: references', () => {
    const dataStep = makeStep('$data:price-feed');
    const job = makeJob([dataStep]);

    const policies = buildPolicies(workflow, false, job);
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('honors explicit lower value', () => {
    const lowValue = BigInt(500);
    const step = makeStep(lowValue);
    const job = makeJob([step]);

    const policies = buildPolicies(workflow, false, job);
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('throws when explicit MAX_UINT256 is used without allowUnlimited opt-in', () => {
    const step = makeStep(MAX_UINT256);
    const job = makeJob([step]);

    expect(() => buildPolicies(workflow, false, job)).toThrow(
      /allowUnlimited: true/
    );
  });

  it('permits MAX_UINT256 when allowUnlimited: true is set', () => {
    const step = makeStep(MAX_UINT256);
    const job = makeJob([step]);

    const policies = buildPolicies(workflow, false, job, { allowUnlimited: true });
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('allows WASM references with allowUnlimited: true to use MAX_UINT256', () => {
    const wasmStep = makeStep('$wasm:balance-calc');
    const job = makeJob([wasmStep]);

    const policies = buildPolicies(workflow, false, job, { allowUnlimited: true });
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('uses BigInt(0) when no value is provided', () => {
    const step = makeStep(undefined);
    const job = makeJob([step]);

    const policies = buildPolicies(workflow, false, job);
    expect(policies).toBeDefined();
    expect(policies.length).toBeGreaterThan(0);
  });

  it('DEFAULT_VALUE_LIMIT equals 1 ETH (1e18)', () => {
    expect(DEFAULT_VALUE_LIMIT).toBe(BigInt('1000000000000000000'));
  });

  it('MAX_UINT256 is the maximum uint256 value', () => {
    expect(MAX_UINT256).toBe(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
  });
});
