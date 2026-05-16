# Foundry Installation Guide

## Quick Install

```bash
# Run the official installer
curl -L https://foundry.paradigm.xyz | bash

# Restart your terminal or run:
source ~/.bashrc

# Install the latest versions
foundryup
```

## Verify Installation

```bash
forge --version      # Should show version like 0.2.0
anvil --version      # Local EVM node
cast --version       # CLI for interacting with contracts
```

## Project Setup

```bash
# Install Foundry dependencies (forge-std)
forge install foundry-rs/forge-std

# Build the project
forge build

# Run tests
forge test

# Run with gas report
forge test --gas-report

# Run coverage
forge coverage
```

## Running Fuzz Tests

```bash
# Basic fuzz run (10,000 runs)
forge test --match-contract ATTRTokenFuzzTest

# Extensive fuzzing (100,000 runs) - CI mode
forge test --match-contract ATTRTokenFuzzTest --fuzz-runs 100000

# With verbose output
forge test --match-contract ATTRTokenFuzzTest -vv

# Run specific test
forge test --match-test testFuzz_MintNeverExceedsCap -vvv
```

## Running Invariant Tests

```bash
# Run all invariants
forge test --match-contract ATTRTokenFuzzTest --match-test invariant_

# With deep state exploration
forge test --match-test invariant_ --depth 64 --runs 512
```

## Useful Commands

```bash
# Snapshot gas usage
forge snapshot

# Format code
forge fmt

# Verify contract on Etherscan
forge verify-contract <address> <contract>

# Debug a failing test
forge test --match-test <test_name> --debug
```

## Configuration

Edit `foundry.toml` to customize:
- Fuzz runs
- Invariant depth
- Compiler settings
- Gas optimization

## Troubleshooting

**Issue: `forge-std` not found**
```bash
forge install foundry-rs/forge-std
```

**Issue: Solidity version mismatch**
```bash
# Check solc version
forge build --use 0.8.26
```

**Issue: Import errors**
Ensure `foundry.toml` has correct `libs` path:
```toml
libs = ["node_modules"]
```
