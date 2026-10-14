# Membership modernization implementation plan

- TDD: update existing viem regressions first; add permit, rollback, governance and reentrancy coverage in viem and Foundry before changing MembershipToken.
- Preserve the nine-argument deployment ABI. Constructor limits may be stricter than the protocol ceilings but cannot exceed 50,000 lifetime mints or 2 public mints per wallet. Administrative allocations consume supply but not the public-sale wallet count and receive no welcome grant.
- Seed Genesis prices (0.225/0.100 ETH and 580/260 USDC with six decimals). All subsequent ETH and USDC price changes are queued for 48 hours, then permissionlessly executed. Zero prices and tiers other than 1/2 are rejected.
- One-time owner configuration binds ATTR and USDC; Base mainnet requires canonical native USDC. ATTR MINTER_ROLE is explicitly granted by its administrator, never acquired by MembershipToken itself. Unconfigured or revoked roles fail atomically.
- Public mint data flow: validate tier/payment/caps/configuration; reserve token ID, count and tier; permit/transfer or ETH forwarding; safe NFT mint; liquid ATTR mint; events. All external-call mint paths and emergency withdrawal share nonReentrant. Failure rolls back payment, NFT, grant, counters and permit nonce.
- Permit owner and recipient are always msg.sender. Permit is exact-price, mandatory and single-use; invalid/expired/replayed/front-run permits revert. No approval fallback that could consume unrelated standing allowance.
- Explicit task exact-payment rule supersedes stale brief examples accepting overpayment. No free-tier NFT, including administrative mint/relabel paths. Existing NFT IDs, URI, royalties and votes are preserved.
- Verify full Hardhat, Foundry, lint and deterministic gas snapshots; disclose coverage/gas results without asserting mainnet readiness.
