# ATTR Web3 Lib

Smart contracts, contract tests, deployment scripts, and Basescan verification command for ATTR.

## Setup

```bash
npm install
cp .env.example .env
```

## Common Commands

```bash
npm run compile
npm test
npm run test:fuzz
npm run lint:sol
npm run verify:contract
```

The backend calls `npm run verify:contract` with a JSON payload on stdin. This repo owns the local Hardhat configuration and contract sources used for Basescan verification.

When installed as a package dependency, the backend calls the
`attr-web3-verify-contract` binary from `node_modules/.bin`.
