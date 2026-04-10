import { createHash } from 'crypto';
import { IWorkflowStorage, SerializedWorkflowData } from './IWorkflowStorage';
import { IpfsUrlValidationError } from '../core/WorkflowError';
import { ALLOWED_IPFS_GATEWAYS } from '../utils/constants';

const TIMEOUT_MS = 30000;
const RETRIES = 3;

/** Pattern for valid IPFS paths: /ipfs/<CID> or /ipns/<name>, with optional trailing path segments */
const VALID_IPFS_PATH_RE = /^\/ip[fn]s\/[A-Za-z0-9][\w.-]*(?:\/[\w.@%:~-]*)*$/;

/**
 * Validate an IPFS URL against the allow-list of gateways.
 * Checks: must be https, host must be in allow-list, path must match /ipfs/<cid> or /ipns/<name>,
 * no path traversal.
 */
export function validateIpfsUrl(url: string, allowedGateways: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IpfsUrlValidationError(`Invalid IPFS URL: ${url}`, url);
  }

  if (parsed.protocol !== 'https:') {
    throw new IpfsUrlValidationError(
      `IPFS URL must use https protocol, got ${parsed.protocol} in ${url}`,
      url
    );
  }

  const hostMatch = allowedGateways.some((gw) => {
    try {
      const gwUrl = new URL(gw);
      return gwUrl.hostname === parsed.hostname;
    } catch {
      return false;
    }
  });

  if (!hostMatch) {
    throw new IpfsUrlValidationError(
      `IPFS gateway host "${parsed.hostname}" is not in the allow-list`,
      url
    );
  }

  // Check for path traversal
  if (parsed.pathname.includes('..')) {
    throw new IpfsUrlValidationError(
      `IPFS URL contains path traversal: ${url}`,
      url
    );
  }

  // Path must match /ipfs/<cid> or /ipns/<name> pattern
  // Allow service-style paths like /ipfs/read/<cid> as used by the Ditto IPFS service
  const isValidIpfsPath = VALID_IPFS_PATH_RE.test(parsed.pathname);
  if (!isValidIpfsPath) {
    throw new IpfsUrlValidationError(
      `IPFS URL path does not match expected pattern (/ipfs/<cid> or /ipns/<name>): ${parsed.pathname}`,
      url
    );
  }
}

async function fetchWithRetry(url: string, options: RequestInit, retries = RETRIES): Promise<Response> {
  let attempt = 0;
  let delay = 500;
  while (attempt < retries) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
  throw new Error('Failed to fetch with retry');
}

export interface IpfsStorageOptions {
  /** Additional IPFS gateway origins to allow beyond the default list */
  allowedGateways?: string[];
}

export class IpfsStorage implements IWorkflowStorage {
  private readonly allowedGateways: readonly string[];

  constructor(
    private readonly ipfsServiceUrl: string,
    options?: IpfsStorageOptions
  ) {
    const extra = options?.allowedGateways ?? [];
    this.allowedGateways = [...ALLOWED_IPFS_GATEWAYS, ...extra];
  }

  /**
   * Validate a URL that will be fetched. Constructs the full URL from the
   * service base + path and validates it against the gateway allow-list.
   */
  private validateUrl(fullUrl: string): void {
    validateIpfsUrl(fullUrl, this.allowedGateways);
  }

  /**
   * Download raw bytes from IPFS and verify against an expected SHA-256 hash.
   * @param ipfsHash - The IPFS CID to download
   * @param expectedContentHash - Expected SHA-256 hex digest of the content
   * @returns The verified content as a Buffer
   * @throws Error if hash does not match or content is empty
   */
  async downloadAndVerify(ipfsHash: string, expectedContentHash: string): Promise<Buffer> {
    const url = `${this.ipfsServiceUrl}/ipfs/read/${ipfsHash}`;
    this.validateUrl(url);
    const response = await fetchWithRetry(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`IPFS download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    if (data.length === 0) {
      throw new Error(`IPFS download returned empty content for CID: ${ipfsHash}`);
    }

    const actualHash = createHash('sha256').update(data).digest('hex');
    if (actualHash !== expectedContentHash) {
      throw new Error(
        `IPFS content hash mismatch for CID ${ipfsHash}: expected ${expectedContentHash}, got ${actualHash}`
      );
    }

    return data;
  }

  async upload(data: SerializedWorkflowData): Promise<string> {
    const url = `${this.ipfsServiceUrl}/ipfs/upload`;
    this.validateUrl(url);
    const response = await fetchWithRetry(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json() as { cid: string };
    return responseData.cid;
  }

  async download(ipfsHash: string): Promise<SerializedWorkflowData> {
    const url = `${this.ipfsServiceUrl}/ipfs/read/${ipfsHash}`;
    this.validateUrl(url);
    const response = await fetchWithRetry(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`IPFS download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/octet-stream')) {
      const text = await response.text();
      try {
        return JSON.parse(text) as SerializedWorkflowData;
      } catch (error) {
        throw new Error('Invalid JSON response from IPFS');
      }
    } else if (contentType?.includes('application/json')) {
      return await response.json() as SerializedWorkflowData;
    } else {
      const text = await response.text();
      return JSON.parse(text) as SerializedWorkflowData;
    }
  }
} 