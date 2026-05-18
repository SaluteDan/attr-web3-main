// ─── ATTR Protocol — Public TypeScript API ────────────────────────────────────
//
// Hardhat v3 + viem version — exports contract ABIs for viem integration
//
// Usage:
//   import { NFTCollectionABI } from "attr-web3";
//   import type { NFTVoucher, PermitSignature } from "attr-web3";
//
//   const contract = getContract({
//     address: contractAddress,
//     abi: NFTCollectionABI,
//     client: publicClient
//   });
// ──────────────────────────────────────────────────────────────────────────────

import ATTRTokenJSON from "../artifacts/contracts/ATTRToken.sol/ATTRToken.json" with { type: "json" };
import ATTRDeployerJSON from "../artifacts/contracts/ATTRDeployer.sol/ATTRDeployer.json" with { type: "json" };
import ATTRSpenderJSON from "../artifacts/contracts/ATTRSpender.sol/ATTRSpender.json" with { type: "json" };
import NFTCollectionJSON from "../artifacts/contracts/NFTCollection.sol/NFTCollection.json" with { type: "json" };
import MembershipTokenJSON from "../artifacts/contracts/MembershipToken.sol/MembershipToken.json" with { type: "json" };
import MembershipSaleSplitterJSON from "../artifacts/contracts/MembershipSaleSplitter.sol/MembershipSaleSplitter.json" with { type: "json" };
import MembershipFeeDistributorJSON from "../artifacts/contracts/MembershipFeeDistributor.sol/MembershipFeeDistributor.json" with { type: "json" };
import PaymentSplitterJSON from "../artifacts/contracts/PaymentSplitter.sol/PaymentSplitter.json" with { type: "json" };

// ── Contract ABIs ────────────────────────────────────────────────────────────
export const ATTRTokenABI = ATTRTokenJSON.abi;
export const ATTRDeployerABI = ATTRDeployerJSON.abi;
export const ATTRSpenderABI = ATTRSpenderJSON.abi;
export const NFTCollectionABI = NFTCollectionJSON.abi;
export const MembershipTokenABI = MembershipTokenJSON.abi;
export const MembershipSaleSplitterABI = MembershipSaleSplitterJSON.abi;
export const MembershipFeeDistributorABI = MembershipFeeDistributorJSON.abi;
export const PaymentSplitterABI = PaymentSplitterJSON.abi;

// ── Bytecode (for deployment) ────────────────────────────────────────────────
export const ATTRTokenBytecode = ATTRTokenJSON.bytecode;
export const ATTRDeployerBytecode = ATTRDeployerJSON.bytecode;
export const ATTRSpenderBytecode = ATTRSpenderJSON.bytecode;
export const NFTCollectionBytecode = NFTCollectionJSON.bytecode;
export const MembershipTokenBytecode = MembershipTokenJSON.bytecode;
export const MembershipSaleSplitterBytecode = MembershipSaleSplitterJSON.bytecode;
export const MembershipFeeDistributorBytecode = MembershipFeeDistributorJSON.bytecode;
export const PaymentSplitterBytecode = PaymentSplitterJSON.bytecode;

// ── Viem-compatible types ───────────────────────────────────────────────────
// These mirror the contract structs for use with viem

/**
 * NFTVoucher struct for viem — used in redeem/redeemWithApproval functions
 */
export interface NFTVoucher {
  /** Recipient address (user who receives the NFT) */
  recipient: `0x${string}`;
  /** IPFS URI for token metadata */
  uri: string;
  /** Unique nonce for replay protection */
  nonce: string;
  /** Payment token address (0x0 for ETH, otherwise ERC20) */
  currency: `0x${string}`;
  /** Base mint price in wei (goes to paymentReceiver) */
  basePrice: bigint;
  /** Optional creator tip in wei (goes to tipReceiver) */
  creatorTip: bigint;
  /** Voucher expiration timestamp */
  deadline: bigint;
  /** EIP-712 signature from contract owner */
  signature: `0x${string}`;
}

/**
 * PermitSignature struct for viem — for ERC20Permit gasless approval
 */
export interface PermitSignature {
  /** Signature recovery id (27 or 28) */
  v: number;
  /** r component of ECDSA signature */
  r: `0x${string}`;
  /** s component of ECDSA signature */
  s: `0x${string}`;
  /** Permit deadline timestamp */
  deadline: bigint;
  /** Permit nonce */
  nonce: bigint;
}
