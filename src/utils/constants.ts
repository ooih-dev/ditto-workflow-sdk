import { parseAbiItem, AbiFunction } from 'viem'
import { baseSepolia, sepolia, base, mainnet, arbitrum, polygon, optimism } from 'viem/chains'

export enum ChainId {
    SEPOLIA = 11155111,
    BASE_SEPOLIA = 84532,
    BASE = 8453,
    ARBITRUM = 42161,
    POLYGON = 137,
    OPTIMISM = 10,
    MAINNET = 1,
}

export const PROD_CHAINS = [base, mainnet, arbitrum, polygon, optimism]
export const TEST_CHAINS = [sepolia, baseSepolia]

export const DittoWFRegistryAbi = [
    parseAbiItem('function markRun(string)') as AbiFunction,
    parseAbiItem('function createWF(string) returns (bytes)') as AbiFunction,
    parseAbiItem('function cancelWF(string)') as AbiFunction,
]

export const entryPointVersion = "0.7";

/**
 * Maximum uint256 value — used only when `allowUnlimited: true` is explicitly set.
 */
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

/**
 * Conservative default value limit for session permissions (1 ETH equivalent).
 * Prevents unlimited spend authority when callers do not specify an explicit valueLimit.
 * To use MAX_UINT256, callers must explicitly opt in with `allowUnlimited: true`.
 */
export const DEFAULT_VALUE_LIMIT = BigInt('1000000000000000000'); // 1e18 (1 ETH)
