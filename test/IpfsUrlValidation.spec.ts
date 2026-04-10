import { validateIpfsUrl, IpfsStorage } from '../src/storage/IpfsStorage';
import { IpfsUrlValidationError } from '../src/core/WorkflowError';
import { ALLOWED_IPFS_GATEWAYS } from '../src/utils/constants';

describe('IPFS URL validation', () => {
  describe('validateIpfsUrl', () => {
    it('accepts allowed gateway with valid CID path', () => {
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/ipfs/QmTest1234567890abcdef',
          ALLOWED_IPFS_GATEWAYS
        )
      ).not.toThrow();
    });

    it('accepts Ditto IPFS service URL with /ipfs/read/<cid> path', () => {
      expect(() =>
        validateIpfsUrl(
          'https://ipfs-service.dittonetwork.io/ipfs/read/QmTest1234567890',
          ALLOWED_IPFS_GATEWAYS
        )
      ).not.toThrow();
    });

    it('accepts cloudflare-ipfs.com gateway', () => {
      expect(() =>
        validateIpfsUrl(
          'https://cloudflare-ipfs.com/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          ALLOWED_IPFS_GATEWAYS
        )
      ).not.toThrow();
    });

    it('accepts /ipns/ paths', () => {
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/ipns/example.com',
          ALLOWED_IPFS_GATEWAYS
        )
      ).not.toThrow();
    });

    it('rejects http:// URLs', () => {
      expect(() =>
        validateIpfsUrl(
          'http://ipfs.io/ipfs/QmTest1234567890',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(IpfsUrlValidationError);
      expect(() =>
        validateIpfsUrl(
          'http://ipfs.io/ipfs/QmTest1234567890',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(/must use https/);
    });

    it('rejects non-allow-list hosts', () => {
      expect(() =>
        validateIpfsUrl(
          'https://evil-gateway.com/ipfs/QmTest1234567890',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(IpfsUrlValidationError);
      expect(() =>
        validateIpfsUrl(
          'https://evil-gateway.com/ipfs/QmTest1234567890',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(/not in the allow-list/);
    });

    it('rejects path traversal (../)', () => {
      // URL parser normalizes /ipfs/../etc/passwd to /etc/passwd,
      // which then fails the /ipfs/ or /ipns/ path pattern check
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/ipfs/../etc/passwd',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(IpfsUrlValidationError);

      // Also test literal .. that doesn't get normalized (encoded)
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/ipfs/QmCid/..%2f..%2fetc/passwd',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(IpfsUrlValidationError);
    });

    it('rejects invalid paths not matching /ipfs or /ipns', () => {
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/api/v0/cat?arg=QmTest',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(IpfsUrlValidationError);
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/api/v0/cat?arg=QmTest',
          ALLOWED_IPFS_GATEWAYS
        )
      ).toThrow(/does not match expected pattern/);
    });

    it('rejects completely invalid URLs', () => {
      expect(() =>
        validateIpfsUrl('not-a-url', ALLOWED_IPFS_GATEWAYS)
      ).toThrow(IpfsUrlValidationError);
      expect(() =>
        validateIpfsUrl('not-a-url', ALLOWED_IPFS_GATEWAYS)
      ).toThrow(/Invalid IPFS URL/);
    });

    it('preserves query strings on valid URLs (no rejection)', () => {
      expect(() =>
        validateIpfsUrl(
          'https://ipfs.io/ipfs/QmTest1234567890?filename=data.json',
          ALLOWED_IPFS_GATEWAYS
        )
      ).not.toThrow();
    });

    it('accepts custom gateways passed in the allow-list', () => {
      const custom = [...ALLOWED_IPFS_GATEWAYS, 'https://my-company-gateway.internal'];
      expect(() =>
        validateIpfsUrl(
          'https://my-company-gateway.internal/ipfs/QmCustomCid',
          custom
        )
      ).not.toThrow();
    });
  });

  describe('IpfsStorage constructor allowedGateways option', () => {
    it('allows custom gateways via constructor option', () => {
      const storage = new IpfsStorage('https://my-private-gw.example.com', {
        allowedGateways: ['https://my-private-gw.example.com'],
      });
      // The storage should be constructible without error
      expect(storage).toBeInstanceOf(IpfsStorage);
    });

    it('rejects URLs from non-allowed gateways even with custom gateways set', () => {
      const storage = new IpfsStorage('https://evil.com', {
        allowedGateways: ['https://my-private-gw.example.com'],
      });
      // downloadAndVerify will call validateUrl internally; the URL will fail
      expect(
        storage.downloadAndVerify('QmTest', 'abc123')
      ).rejects.toThrow(IpfsUrlValidationError);
    });

    it('default gateways are still allowed when custom gateways are added', () => {
      const storage = new IpfsStorage('https://ipfs.io', {
        allowedGateways: ['https://extra-gw.example.com'],
      });
      // ipfs.io is in the default list, so this should pass URL validation
      // (will fail on network, but we only test URL validation throws)
      expect(storage).toBeInstanceOf(IpfsStorage);
    });
  });

  describe('IpfsStorage URL validation integration', () => {
    it('download rejects malicious gateway URL', async () => {
      const storage = new IpfsStorage('https://evil-attacker.com');
      await expect(storage.download('QmTest')).rejects.toThrow(IpfsUrlValidationError);
    });

    it('upload rejects malicious gateway URL', async () => {
      const storage = new IpfsStorage('https://evil-attacker.com');
      await expect(
        storage.upload({ workflow: {} as any, metadata: {} as any })
      ).rejects.toThrow(IpfsUrlValidationError);
    });

    it('downloadAndVerify rejects malicious gateway URL', async () => {
      const storage = new IpfsStorage('https://evil-attacker.com');
      await expect(
        storage.downloadAndVerify('QmTest', 'abc123')
      ).rejects.toThrow(IpfsUrlValidationError);
    });

    it('download rejects http:// gateway URL', async () => {
      const storage = new IpfsStorage('http://ipfs.io');
      await expect(storage.download('QmTest')).rejects.toThrow(/must use https/);
    });
  });
});
