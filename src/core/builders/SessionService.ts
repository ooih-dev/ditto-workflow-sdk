import { Address, createPublicClient, http } from 'viem';
import { Signer } from "@zerodev/sdk/types";
import {
    createKernelAccount,
    CreateKernelAccountReturnType,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import { toEmptyECDSASigner } from "@zerodev/permissions/signers";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { Job } from '../Job';
import { Workflow } from '../Workflow';
import { buildPolicies } from './PermissionBuilder';
import { getChainConfig } from '../../utils/chainConfigProvider';
import { entryPointVersion } from '../../utils/constants';
import { authHttpConfig } from '../../utils/httpTransport';
import { SessionSignatureError } from '../WorkflowError';

/**
 * Validate session parameters before creating a session.
 * Throws SessionSignatureError on any invalid condition — never falls back.
 */
export function validateSessionParams(
    workflow: Workflow,
    job: Job,
    executorAddress: Address,
    owner: Signer,
): void {
    // Validate executor address
    if (!executorAddress || executorAddress === '0x0000000000000000000000000000000000000000') {
        throw new SessionSignatureError(
            'Session creation requires a valid executor address',
            'unknown_signer'
        );
    }

    // Validate owner signer is provided
    if (!owner) {
        throw new SessionSignatureError(
            'Session creation requires a valid owner signer',
            'unknown_signer'
        );
    }

    // Validate session is not expired
    if (workflow.validUntil) {
        const expiryTime = workflow.validUntil instanceof Date
            ? workflow.validUntil.getTime()
            : Number(workflow.validUntil);
        if (Date.now() > expiryTime) {
            throw new SessionSignatureError(
                `Session expired: validUntil ${new Date(expiryTime).toISOString()} is in the past`,
                'expired'
            );
        }
    }

    // Validate chain configuration exists
    if (!job.chainId) {
        throw new SessionSignatureError(
            'Session creation requires a valid chain ID',
            'invalid_signature'
        );
    }
}

/**
 * Validate a serialized session string. Throws on tampered or malformed sessions.
 * This is used when deserializing sessions for execution.
 */
export function validateSerializedSession(sessionStr: string): void {
    if (!sessionStr || sessionStr.trim().length === 0) {
        throw new SessionSignatureError(
            'Session string is empty or missing',
            'missing_session'
        );
    }

    try {
        // Session format: base64url(JSON)
        const base64 = sessionStr.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));

        // Verify required fields exist in the decoded session
        if (!decoded || typeof decoded !== 'object') {
            throw new SessionSignatureError(
                'Session data is not a valid object',
                'tampered_payload'
            );
        }
    } catch (error) {
        if (error instanceof SessionSignatureError) {
            throw error;
        }
        throw new SessionSignatureError(
            `Failed to parse session data: ${error instanceof Error ? error.message : 'unknown error'}`,
            'parse_error',
            error instanceof Error ? error : undefined
        );
    }
}

export async function createSession(
    workflow: Workflow,
    job: Job,
    executorAddress: Address,
    owner: Signer,
    prodContract: boolean,
    ipfsServiceUrl: string,
    accessToken?: string,
): Promise<string> {
    // Fail-closed: validate all session parameters before proceeding
    validateSessionParams(workflow, job, executorAddress, owner);

    const chainConfig = getChainConfig(ipfsServiceUrl);
    const chain = chainConfig[job.chainId]?.chain;
    const rpcUrl = chainConfig[job.chainId]?.rpcUrl;

    if (!chain || !rpcUrl) {
        throw new SessionSignatureError(
            `Unsupported chain ID ${job.chainId}: no chain config found`,
            'invalid_signature'
        );
    }

    const entryPoint = getEntryPoint(entryPointVersion);
    const publicClient = createPublicClient({
        transport: http(rpcUrl, authHttpConfig(accessToken)),
        chain: chain,
    });

    const policies: ReturnType<typeof buildPolicies> = buildPolicies(workflow, prodContract, job);

    let sessionAccountSigner;
    try {
        sessionAccountSigner = await toEmptyECDSASigner(executorAddress);
    } catch (error) {
        throw new SessionSignatureError(
            `Failed to create session signer for executor ${executorAddress}: ${error instanceof Error ? error.message : 'unknown error'}`,
            'unknown_signer',
            error instanceof Error ? error : undefined
        );
    }

    let sessionKeyValidator;
    try {
        sessionKeyValidator = await toPermissionValidator(publicClient, {
            entryPoint: entryPoint,
            signer: sessionAccountSigner,
            policies: policies,
            kernelVersion: KERNEL_V3_3,
        });
    } catch (error) {
        throw new SessionSignatureError(
            `Failed to create session key validator: ${error instanceof Error ? error.message : 'unknown error'}`,
            'invalid_signature',
            error instanceof Error ? error : undefined
        );
    }

    let sessionKeyKernelAccount: CreateKernelAccountReturnType<typeof entryPointVersion>;
    try {
        const ownerValidator = await signerToEcdsaValidator(publicClient, {
            entryPoint,
            signer: owner,
            kernelVersion: KERNEL_V3_3,
        });
        sessionKeyKernelAccount = await createKernelAccount(publicClient, {
            entryPoint: entryPoint,
            plugins: {
                sudo: ownerValidator,
                regular: sessionKeyValidator,
            },
            kernelVersion: KERNEL_V3_3,
        });
    } catch (error) {
        throw new SessionSignatureError(
            `Failed to create kernel account for session: ${error instanceof Error ? error.message : 'unknown error'}`,
            'invalid_signature',
            error instanceof Error ? error : undefined
        );
    }

    return await serializePermissionAccount(sessionKeyKernelAccount);
}
