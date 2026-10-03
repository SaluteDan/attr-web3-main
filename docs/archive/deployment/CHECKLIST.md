# Smart Contract Deployment Checklist

## Pre-Deployment Phase

### Code Review & Testing
- [ ] All 106 unit tests passing
- [ ] Code review completed by team
- [ ] No critical security issues identified
- [ ] Gas optimization verified
- [ ] All contracts compile without warnings

### Environment Setup
- [ ] `.env` file created with all required variables
- [ ] Private key securely stored (not in version control)
- [ ] RPC URLs verified and accessible
- [ ] API keys for verification obtained
- [ ] Network configuration correct in `hardhat.config.ts`

### Security Audit
- [ ] External security audit completed
- [ ] All audit findings addressed
- [ ] Audit report reviewed and approved
- [ ] Bug bounty program planned (optional)

### Documentation
- [ ] README updated with deployment instructions
- [ ] Contract ABIs exported
- [ ] Deployment guide reviewed
- [ ] Emergency procedures documented

---

## Testnet Deployment Phase (Base Sepolia)

### Pre-Deployment
- [ ] Check account balance: `npx hardhat run scripts/check-balance.ts --network baseSepolia`
- [ ] Ensure sufficient ETH for gas (~0.01 ETH minimum)
- [ ] Verify all deployment parameters in `.env`
- [ ] Create backup of `.env` file

### Deployment Execution
- [ ] Deploy ATTRToken
  ```bash
  npx hardhat run scripts/deploy-token.ts --network baseSepolia
  ```
  - [ ] Record token address
  - [ ] Verify deployment successful
  - [ ] Check initial supply minted

- [ ] Deploy ATTRDeployer
  ```bash
  npx hardhat run scripts/deploy-factory.ts --network baseSepolia
  ```
  - [ ] Record factory address
  - [ ] Verify ownership set correctly

- [ ] Deploy GovernanceNFT
  ```bash
  npx hardhat run scripts/deploy-governance.ts --network baseSepolia
  ```
  - [ ] Record NFT address
  - [ ] Verify max supply set correctly

- [ ] Deploy MembershipToken
  ```bash
  npx hardhat run scripts/deployMembershipToken.ts --network baseSepolia
  ```
  - [ ] Record membership address
  - [ ] Verify max supply set correctly
  - [ ] Verify payment receiver configured

### Post-Deployment Verification
- [ ] All contracts deployed successfully
- [ ] Contract addresses recorded in `.env`
- [ ] Verify on BaseScan (wait for indexing)
- [ ] Check contract code on BaseScan

### Testnet Testing
- [ ] Test ATTRToken transfers
- [ ] Test token minting (if applicable)
- [ ] Test GovernanceNFT minting
- [ ] Test MembershipToken minting with payment
- [ ] Test pause/unpause functionality
- [ ] Test access control (owner-only functions)
- [ ] Test payment forwarding
- [ ] Test royalty calculations

### Contract Verification
- [ ] Verify ATTRToken on BaseScan
- [ ] Verify ATTRDeployer on BaseScan
- [ ] Verify GovernanceNFT on BaseScan
- [ ] Verify MembershipToken on BaseScan
- [ ] All contracts show "Verified" status

### Integration Testing
- [ ] Test factory collection creation
- [ ] Test NFT minting with vouchers
- [ ] Test ERC20 permit functionality
- [ ] Test payment splitting (if applicable)
- [ ] Test governance voting (if applicable)

---

## Mainnet Deployment Phase (Base Mainnet)

### Pre-Deployment
- [ ] Testnet deployment fully verified
- [ ] All integration tests passed
- [ ] Team approval obtained
- [ ] Multi-sig wallet configured (if applicable)
- [ ] Check account balance: `npx hardhat run scripts/check-balance.ts --network baseMainnet`
- [ ] Ensure sufficient ETH for gas (~0.02 ETH recommended)

### Deployment Execution
- [ ] Deploy ATTRToken
  ```bash
  npx hardhat run scripts/deploy-token.ts --network baseMainnet
  ```
  - [ ] Record mainnet token address
  - [ ] Verify deployment successful

- [ ] Deploy ATTRDeployer
  ```bash
  npx hardhat run scripts/deploy-factory.ts --network baseMainnet
  ```
  - [ ] Record mainnet factory address

- [ ] Deploy GovernanceNFT
  ```bash
  npx hardhat run scripts/deploy-governance.ts --network baseMainnet
  ```
  - [ ] Record mainnet NFT address

- [ ] Deploy MembershipToken
  ```bash
  npx hardhat run scripts/deployMembershipToken.ts --network baseMainnet
  ```
  - [ ] Record mainnet membership address

### Post-Deployment Verification
- [ ] All contracts deployed successfully
- [ ] Contract addresses recorded securely
- [ ] Wait for BaseScan indexing (5-10 minutes)
- [ ] Verify all contracts on BaseScan
- [ ] All contracts show "Verified" status

### Mainnet Testing
- [ ] Test token transfers (small amount)
- [ ] Test NFT minting (small amount)
- [ ] Test pause functionality
- [ ] Verify payment forwarding works
- [ ] Monitor gas usage

### Documentation & Communication
- [ ] Update README with mainnet addresses
- [ ] Announce deployment to team
- [ ] Update API documentation
- [ ] Notify users of new contract addresses
- [ ] Create blog post/announcement (if applicable)

---

## Post-Deployment Phase

### Monitoring & Operations
- [ ] Set up monitoring for contract events
- [ ] Configure alerts for critical functions
- [ ] Monitor transaction volumes
- [ ] Track gas usage patterns
- [ ] Monitor for suspicious activity

### Backup & Recovery
- [ ] Backup all contract addresses
- [ ] Backup deployment artifacts
- [ ] Backup verification proofs
- [ ] Store in secure location
- [ ] Document recovery procedures

### Governance & Access Control
- [ ] Transfer ownership to multi-sig (if planned)
- [ ] Grant necessary roles to team members
- [ ] Document role assignments
- [ ] Set up access control procedures
- [ ] Create incident response plan

### User Communication
- [ ] Update website with contract addresses
- [ ] Publish deployment announcement
- [ ] Create user guides for minting
- [ ] Document API endpoints
- [ ] Provide support channels

### Ongoing Maintenance
- [ ] Monitor contract health
- [ ] Track usage metrics
- [ ] Plan future upgrades
- [ ] Maintain documentation
- [ ] Regular security reviews

---

## Rollback Plan

If critical issues are discovered post-deployment:

1. **Pause Contracts**
   ```bash
   # Call pause() on affected contracts
   ```

2. **Notify Users**
   - Announce issue and mitigation
   - Provide alternative solutions
   - Set timeline for resolution

3. **Investigate**
   - Analyze root cause
   - Determine impact scope
   - Plan fix strategy

4. **Deploy Fix**
   - Deploy patched version to testnet
   - Verify fix thoroughly
   - Deploy to mainnet if approved

5. **Resume Operations**
   - Call unpause() on contracts
   - Monitor for issues
   - Communicate resolution to users

---

## Emergency Contacts

| Role | Contact | Backup |
|------|---------|--------|
| Lead Dev | [Name] | [Backup] |
| Security | [Name] | [Backup] |
| Operations | [Name] | [Backup] |

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Security Lead | | | |
| Project Manager | | | |
| CTO/Lead | | | |

---

## Deployment History

| Date | Network | Status | Notes |
|------|---------|--------|-------|
| TBD | Base Sepolia | Pending | Initial testnet deployment |
| TBD | Base Mainnet | Pending | Production deployment |

---

**Document Version:** 1.0  
**Last Updated:** April 9, 2026  
**Next Review:** After testnet deployment
