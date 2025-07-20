# TriviaComb Deployment Scripts

This directory contains comprehensive deployment scripts for the TriviaComb smart contracts. The scripts support deployment to local validator, devnet, and mainnet-beta environments with full configuration and verification capabilities.

## Overview

The deployment infrastructure consists of five main scripts:

1. **deploy-local.ts** - Local validator deployment with automatic setup
2. **deploy-devnet.ts** - Devnet deployment with security validation
3. **deploy-mainnet.ts** - Mainnet deployment with production-grade security
4. **configure-contracts.ts** - Post-deployment configuration management
5. **verify-deployment.ts** - Comprehensive deployment verification

## Quick Start

```bash
# Install dependencies
npm install

# Build programs
anchor build

# Deploy to local validator
npx ts-node scripts/deploy-local.ts

# Deploy to devnet
npx ts-node scripts/deploy-devnet.ts

# Deploy to mainnet (requires approval)
npx ts-node scripts/deploy-mainnet.ts

# Configure contracts
npx ts-node scripts/configure-contracts.ts <cluster>

# Verify deployment
npx ts-node scripts/verify-deployment.ts <cluster>
```

## Script Details

### deploy-local.ts

**Purpose:** Local development deployment with automatic validator management

**Features:**
- Automatic local validator startup/shutdown
- Sample data generation
- Development-friendly configuration
- Fast iteration for testing

**Configuration:**
```typescript
LOCAL_DEPLOYMENT_CONFIG = {
  cluster: "localnet",
  validatorConfig: {
    resetLedger: true,
    rpcPort: 8899,
    accountsPath: "./accounts",
  },
  initialFunding: {
    adminSol: 100,
    curatorSol: 10,
    testUserSol: 5,
  },
  sampleData: {
    createSampleQuestions: true,
    createSampleTournaments: true,
    questionCount: 20,
    tournamentCount: 3,
  },
}
```

### deploy-devnet.ts

**Purpose:** Devnet deployment with security validation

**Features:**
- Pre-deployment security checks
- Program upgrade handling
- Configuration validation
- Performance monitoring
- Detailed reporting

**Security Checks:**
- Wallet balance validation
- Network connectivity verification
- Program keypair validation
- Admin authority configuration

**Configuration:**
```typescript
DEVNET_DEPLOYMENT_CONFIG = {
  cluster: "devnet",
  requiredSolBalance: 10,
  security: {
    requireUpgradeAuthority: true,
    validateProgramOwnership: true,
    enableEmergencyPause: true,
  },
  monitoring: {
    enableMetrics: true,
    alertThresholds: {
      highGasUsage: 1000000,
      slowConfirmation: 60000,
    },
  },
}
```

### deploy-mainnet.ts

**Purpose:** Production mainnet deployment with maximum security

**Features:**
- Production-grade security validation
- Multisig requirement enforcement
- 24-hour time delay validation
- Manual confirmation prompts
- Comprehensive audit trails

**Security Requirements:**
- Minimum 50 SOL balance
- Multisig configuration (2-of-3 minimum)
- 24-hour deployment approval
- Security audit validation
- Manual confirmation required

**Configuration:**
```typescript
MAINNET_DEPLOYMENT_CONFIG = {
  cluster: "mainnet-beta",
  requiredSolBalance: 50,
  security: {
    requireMultisig: true,
    multisigThreshold: 2,
    requireUpgradeAuthority: true,
    requireSecurityAudit: true,
    requireTimeDelay: true,
    timeDelayHours: 24,
  },
}
```

### configure-contracts.ts

**Purpose:** Post-deployment configuration management

**Features:**
- Curator setup and management
- Reward pool creation and funding
- Tournament configuration
- Honeycomb integration setup
- Governance parameter configuration

**Configuration Templates:**
- **Development:** Sample data and test configurations
- **Production:** Real-world configurations without test data

**Usage:**
```bash
# Configure development environment
npx ts-node scripts/configure-contracts.ts devnet

# Configure production environment
npx ts-node scripts/configure-contracts.ts mainnet-beta
```

### verify-deployment.ts

**Purpose:** Comprehensive deployment verification and validation

**Features:**
- Multi-tiered verification tests
- Security validation
- Performance benchmarks
- Integration testing
- Detailed reporting

**Test Categories:**
- **Critical:** Must pass for deployment to be considered successful
- **Important:** Should pass for optimal functionality
- **Optional:** Nice-to-have features and optimizations

**Verification Areas:**
- Program deployment validation
- Account initialization verification
- Configuration correctness
- Security parameter validation
- Performance benchmark testing

## Architecture

### Core Components

```
scripts/
├── deploy-local.ts          # Local validator deployment
├── deploy-devnet.ts         # Devnet deployment
├── deploy-mainnet.ts        # Mainnet deployment
├── configure-contracts.ts   # Post-deployment configuration
├── verify-deployment.ts     # Deployment verification
├── types/
│   └── deployment.ts        # TypeScript interfaces
└── utils/
    └── deployment-utils.ts  # Shared utilities
```

### Key Classes

1. **LocalValidatorManager** - Manages local validator lifecycle
2. **DevnetDeployment** - Handles devnet deployment process
3. **MainnetDeployment** - Manages mainnet deployment with security
4. **ContractConfigurator** - Handles post-deployment configuration
5. **DeploymentVerifier** - Comprehensive deployment verification
6. **SecurityValidator** - Security validation and enforcement
7. **DeploymentLoggerImpl** - Comprehensive logging implementation

### Utility Functions

- **Environment Configuration:** Load and validate environment settings
- **Program Management:** Handle program keypairs and deployment
- **Transaction Utilities:** Retry logic and gas optimization
- **PDA Utilities:** Program Derived Address management
- **Token Utilities:** SPL token creation and management
- **Security Utilities:** Validation and compliance checks

## Configuration Management

### Environment Variables

All scripts use a centralized configuration system based on environment variables:

```env
# Core Configuration
SOLANA_CLUSTER=devnet
ANCHOR_WALLET=/path/to/wallet.json
PROGRAM_KEYPAIRS_PATH=./keys
ADMIN_AUTHORITY=your_admin_pubkey

# Security Configuration
ENABLE_SECURITY_CHECKS=true
REQUIRE_UPGRADE_AUTHORITY_VALIDATION=true
MAINNET_REQUIRE_MULTISIG=true
MAINNET_MULTISIG_THRESHOLD=2

# Performance Configuration
PRIORITY_FEE_LAMPORTS=10000
COMPUTE_UNIT_LIMIT=400000
DEPLOYMENT_RETRY_COUNT=3
```

### Configuration Validation

Each script validates its configuration before execution:

1. **Environment Variables:** Required variables are checked
2. **Network Connectivity:** Connection to target network verified
3. **Wallet Balance:** Sufficient SOL balance confirmed
4. **Program Keypairs:** Required keypairs exist and are valid
5. **Security Parameters:** Security settings meet requirements

## Security Features

### Access Control

- **Admin Authority:** Centralized admin key management
- **Curator Management:** Controlled curator onboarding
- **Upgrade Authority:** Secure program upgrade controls
- **Emergency Pause:** Circuit breaker functionality

### Deployment Security

- **Time Delays:** Enforced waiting periods for mainnet
- **Multisig Requirements:** Multiple signature validation
- **Audit Trails:** Comprehensive logging and reporting
- **Manual Confirmation:** Human verification for critical operations

### Monitoring

- **Transaction Monitoring:** Real-time transaction tracking
- **Gas Usage Tracking:** Cost optimization and alerting
- **Error Rate Monitoring:** Failure detection and alerting
- **Performance Metrics:** System health monitoring

## Development Workflow

### Local Development

1. Start with local validator deployment
2. Test contract functionality
3. Iterate on configuration
4. Verify all features work correctly

### Devnet Testing

1. Deploy to devnet after local testing
2. Perform integration testing
3. Validate security configurations
4. Test with real network conditions

### Mainnet Deployment

1. Complete security audit
2. Obtain deployment approval
3. Wait for time delay period
4. Execute mainnet deployment
5. Verify and monitor deployment

## Best Practices

### Security

1. **Key Management:** Use hardware wallets for mainnet
2. **Access Control:** Implement principle of least privilege
3. **Audit Trails:** Maintain comprehensive logs
4. **Regular Reviews:** Periodic security assessments

### Deployment

1. **Testing:** Thorough testing on devnet first
2. **Gradual Rollout:** Staged deployment approach
3. **Monitoring:** Continuous monitoring post-deployment
4. **Rollback Plans:** Prepared rollback procedures

### Configuration

1. **Environment Separation:** Separate configs for each environment
2. **Validation:** Comprehensive configuration validation
3. **Documentation:** Well-documented configuration options
4. **Version Control:** Track configuration changes

## Troubleshooting

### Common Issues

1. **Insufficient Balance:** Fund wallet with required SOL
2. **Network Issues:** Check RPC endpoint connectivity
3. **Keypair Issues:** Verify keypair files exist and are valid
4. **Configuration Issues:** Validate environment variables

### Debugging

1. **Logs:** Check deployment logs for detailed errors
2. **Transactions:** Verify transaction signatures on explorer
3. **Accounts:** Check account states and balances
4. **Programs:** Verify program deployment and upgrades

### Support

1. **Documentation:** Refer to DEPLOYMENT.md guide
2. **Logs:** Review detailed logs in ./logs directory
3. **Community:** Solana Discord and developer forums
4. **Issues:** Create issues in the project repository

## Contributing

### Adding New Features

1. Follow existing code patterns
2. Add comprehensive tests
3. Update documentation
4. Include configuration options

### Modifying Scripts

1. Maintain backward compatibility
2. Add proper error handling
3. Include logging and monitoring
4. Update type definitions

### Security Considerations

1. Review security implications
2. Test with different configurations
3. Validate edge cases
4. Document security requirements

---

*This documentation is maintained by the TriviaComb development team. For updates and contributions, please refer to the project repository.*