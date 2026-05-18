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
//# sourceMappingURL=index.js.map