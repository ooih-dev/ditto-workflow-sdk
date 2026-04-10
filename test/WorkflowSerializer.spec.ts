import { sanitizeObject, MAX_SERIALIZE_DEPTH } from '../src/core/builders/WorkflowSerializer';
import { WorkflowSerializeDepthError, PrototypePollutionError } from '../src/core/WorkflowError';

describe('WorkflowSerializer security guards', () => {
  describe('sanitizeObject depth limit', () => {
    it('should serialize object at depth 31 (within limit)', () => {
      let obj: any = { value: 'leaf' };
      for (let i = 0; i < 30; i++) {
        obj = { nested: obj };
      }
      // depth 31 total nesting — should not throw
      expect(() => sanitizeObject(obj)).not.toThrow();
    });

    it('should throw WorkflowSerializeDepthError at depth 33', () => {
      let obj: any = { value: 'leaf' };
      for (let i = 0; i < 33; i++) {
        obj = { nested: obj };
      }
      expect(() => sanitizeObject(obj)).toThrow(WorkflowSerializeDepthError);
    });

    it('should throw with correct depth info', () => {
      let obj: any = { value: 'leaf' };
      for (let i = 0; i < 35; i++) {
        obj = { nested: obj };
      }
      try {
        sanitizeObject(obj);
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowSerializeDepthError);
        expect((e as WorkflowSerializeDepthError).maxDepth).toBe(MAX_SERIALIZE_DEPTH);
      }
    });

    it('should handle deeply nested arrays within limit', () => {
      let obj: any = { value: 'leaf' };
      for (let i = 0; i < 15; i++) {
        obj = { arr: [obj] };
      }
      expect(() => sanitizeObject(obj)).not.toThrow();
    });
  });

  describe('prototype pollution guard', () => {
    it('should throw PrototypePollutionError for __proto__ key', () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
      expect(() => sanitizeObject(malicious)).toThrow(PrototypePollutionError);
    });

    it('should throw PrototypePollutionError for constructor key', () => {
      const malicious = { constructor: { prototype: { polluted: true } } };
      expect(() => sanitizeObject(malicious)).toThrow(PrototypePollutionError);
    });

    it('should throw PrototypePollutionError for prototype key', () => {
      const obj: Record<string, unknown> = Object.create(null);
      obj['prototype'] = { polluted: true };
      expect(() => sanitizeObject(obj)).toThrow(PrototypePollutionError);
    });

    it('should not mutate Object.prototype', () => {
      const before = Object.keys(Object.prototype);
      const malicious = JSON.parse('{"__proto__": {"injected": true}}');
      try {
        sanitizeObject(malicious);
      } catch {
        // expected
      }
      const after = Object.keys(Object.prototype);
      expect(after).toEqual(before);
      expect((Object.prototype as any).injected).toBeUndefined();
    });

    it('should detect dangerous keys in nested objects', () => {
      const nested = { a: { b: JSON.parse('{"__proto__": {"bad": true}}') } };
      expect(() => sanitizeObject(nested)).toThrow(PrototypePollutionError);
    });
  });

  describe('normal workflow round-trip', () => {
    it('should preserve a normal object through sanitization', () => {
      const workflow = {
        owner: '0x1234',
        triggers: [{ type: 'onchain', params: { chainId: 1 } }],
        jobs: [
          {
            id: 'job-1',
            chainId: 1,
            steps: [
              {
                target: '0xabcd',
                abi: 'function transfer(address,uint256)',
                args: ['0xdead', '1000'],
                value: '0',
              },
            ],
          },
        ],
        count: 1,
      };

      const result = sanitizeObject(workflow);
      expect(result.owner).toBe('0x1234');
      expect(result.triggers).toHaveLength(1);
      expect(result.jobs[0].steps[0].target).toBe('0xabcd');
      expect(result.jobs[0].steps[0].args).toEqual(['0xdead', '1000']);
    });

    it('should handle null and undefined values', () => {
      expect(sanitizeObject(null)).toBeNull();
      expect(sanitizeObject(undefined)).toBeUndefined();
    });

    it('should handle primitive values', () => {
      expect(sanitizeObject(42)).toBe(42);
      expect(sanitizeObject('hello')).toBe('hello');
      expect(sanitizeObject(true)).toBe(true);
    });

    it('should handle arrays correctly', () => {
      const arr = [1, 'two', { three: 3 }];
      const result = sanitizeObject(arr);
      expect(result).toEqual([1, 'two', { three: 3 }]);
    });
  });
});
