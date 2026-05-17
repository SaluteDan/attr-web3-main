// ─── ATTR Protocol — Public TypeScript API ────────────────────────────────────
//
// Re-exports all contract types, factory classes, and struct types generated
// by Hardhat TypeChain from the compiled Solidity sources.
//
// Usage:
//   import type { ATTRToken, NFTCollection } from "attr-web3";
//   import { ATTRToken__factory, NFTCollection__factory } from "attr-web3";
//   import type { NFTVoucherStruct } from "attr-web3";
// ──────────────────────────────────────────────────────────────────────────────

// ── Contract interfaces ────────────────────────────────────────────────────────
export type { ATTRToken } from "../typechain-types/contracts/ATTRToken";
export type { ATTRDeployer } from "../typechain-types/contracts/ATTRDeployer";
export type { ATTRSpender } from "../typechain-types/contracts/ATTRSpender";
export type { NFTCollection } from "../typechain-types/contracts/NFTCollection";
export type { MembershipToken } from "../typechain-types/contracts/MembershipToken";
export type { MembershipSaleSplitter } from "../typechain-types/contracts/MembershipSaleSplitter";
export type { MembershipFeeDistributor } from "../typechain-types/contracts/MembershipFeeDistributor";
export type { PaymentSplitter } from "../typechain-types/contracts/PaymentSplitter";

// ── Factory classes (carry ABI + bytecode; needed for deployment/attachment) ──
export { ATTRToken__factory } from "../typechain-types/factories/contracts/ATTRToken__factory";
export { ATTRDeployer__factory } from "../typechain-types/factories/contracts/ATTRDeployer__factory";
export { ATTRSpender__factory } from "../typechain-types/factories/contracts/ATTRSpender__factory";
export { NFTCollection__factory } from "../typechain-types/factories/contracts/NFTCollection__factory";
export { MembershipToken__factory } from "../typechain-types/factories/contracts/MembershipToken__factory";
export { MembershipSaleSplitter__factory } from "../typechain-types/factories/contracts/MembershipSaleSplitter__factory";
export { MembershipFeeDistributor__factory } from "../typechain-types/factories/contracts/MembershipFeeDistributor__factory";
export { PaymentSplitter__factory } from "../typechain-types/factories/contracts/PaymentSplitter__factory";

// ── Struct / parameter types (namespaced by TypeChain) ────────────────────────

// NFTCollection — voucher and permit structs
export type { NFTCollection as NFTCollectionTypes } from "../typechain-types/contracts/NFTCollection";
// Flat re-exports for convenience
import type { NFTCollection as _NFTCollection } from "../typechain-types/contracts/NFTCollection";
export type NFTVoucherStruct = _NFTCollection.NFTVoucherStruct;
export type NFTVoucherStructOutput = _NFTCollection.NFTVoucherStructOutput;
export type PermitSignatureStruct = _NFTCollection.PermitSignatureStruct;
export type PermitSignatureStructOutput =
  _NFTCollection.PermitSignatureStructOutput;
