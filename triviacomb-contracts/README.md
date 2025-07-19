# TriviaComb Smart Contracts

A comprehensive suite of Solana smart contracts built with Anchor framework for community-driven trivia competitions.

## 🏗️ Architecture

TriviaComb consists of three core programs:

### 1. Question Bank (`question_bank`)
- **Purpose**: Community question submission and curation
- **Key Features**:
  - Decentralized question submission by community members
  - Voting mechanism for question approval/rejection
  - Categorization and difficulty rating system
  - Moderation capabilities for administrators
  - Quality control through community consensus

### 2. Tournament Manager (`tournament_manager`)
- **Purpose**: Organizing and managing trivia competitions
- **Key Features**:
  - Tournament creation with customizable parameters
  - Registration system with entry fees
  - Automated tournament lifecycle management
  - Score tracking and leaderboard functionality
  - Prize pool management

### 3. Reward Distributor (`reward_distributor`)
- **Purpose**: Custom reward logic beyond Honeycomb protocol
- **Key Features**:
  - Flexible reward pool creation
  - Tiered prize distribution system
  - Platform fee collection mechanism
  - Custom distribution schemes
  - Automated claim processing

## 🚀 Quick Start

### Prerequisites

- **Solana CLI** v1.18.0+
- **Anchor CLI** v0.30.0+
- **Node.js** v16.0.0+
- **Rust** (latest stable)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd triviacomb-contracts
```

2. Install dependencies:
```bash
npm install
```

3. Generate keypairs:
```bash
npm run keys:generate
```

4. Build the programs:
```bash
npm run build
```

5. Deploy to devnet:
```bash
npm run setup:devnet
```

## 📁 Project Structure

```
triviacomb-contracts/
├── programs/
│   ├── question_bank/          # Question submission & curation
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── tournament_manager/     # Tournament organization
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   └── reward_distributor/     # Custom reward logic
│       ├── src/lib.rs
│       └── Cargo.toml
├── monitoring/                 # Production monitoring system
│   ├── health-check.ts         # Health monitoring & alerts
│   ├── alert-system.ts         # Rule-based alerting
│   └── rollback-system.ts      # Automated rollback procedures
├── scripts/                    # Deployment & setup scripts
│   ├── deploy-devnet.ts
│   ├── deploy-mainnet.ts
│   ├── configure-contracts.ts
│   └── verify-deployment.ts
├── tests/                      # Comprehensive test suite
├── keys/                       # Program keypairs (generated)
├── Anchor.toml                 # Anchor configuration
├── Cargo.toml                  # Workspace configuration
├── MISSION_COMPLETE.md         # Deployment completion status
└── package.json               # NPM scripts & dependencies
```

## 🔧 Configuration

### Program IDs

Update `Anchor.toml` with your deployed program IDs:

```toml
[programs.devnet]
question_bank = "YOUR_QUESTION_BANK_PROGRAM_ID"
tournament_manager = "YOUR_TOURNAMENT_MANAGER_PROGRAM_ID"
reward_distributor = "YOUR_REWARD_DISTRIBUTOR_PROGRAM_ID"
```

### Wallet Configuration

Set your deployment wallet in `Anchor.toml`:

```toml
[provider]
cluster = "devnet"
wallet = "./keys/authority.json"
```

## 🎯 Usage Examples

### Question Bank Operations

```typescript
// Submit a new question
await program.methods
  .submitQuestion(
    "What is the capital of France?",
    ["London", "Berlin", "Paris", "Madrid"],
    2, // Correct answer index
    "Geography",
    3  // Difficulty level
  )
  .accounts({
    question: questionPda,
    questionBank: questionBankPda,
    submitter: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// Vote on a question
await program.methods
  .voteOnQuestion(true) // approve = true
  .accounts({
    question: questionPda,
    vote: votePda,
    voter: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Tournament Management

```typescript
// Create a tournament
await program.methods
  .createTournament(
    "Weekly Trivia Challenge",
    "Test your knowledge across various topics",
    new BN(1_000_000), // Entry fee (1 SOL)
    new BN(10_000_000), // Prize pool (10 SOL)
    100, // Max participants
    startTime,
    duration,
    20, // Question count
    "General", // Category
    null // Any difficulty
  )
  .accounts({
    tournament: tournamentPda,
    tournamentManager: tournamentManagerPda,
    organizer: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// Register for tournament
await program.methods
  .registerForTournament()
  .accounts({
    tournament: tournamentPda,
    registration: registrationPda,
    participant: wallet.publicKey,
    participantTokenAccount: participantAta,
    tournamentVault: tournamentVault,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Reward Distribution

```typescript
// Create reward pool
await program.methods
  .createRewardPool(
    "tournament_001",
    new BN(5_000_000), // 5 SOL
    [
      { rankStart: 1, rankEnd: 1, percentage: 5000 }, // 50% for 1st place
      { rankStart: 2, rankEnd: 2, percentage: 3000 }, // 30% for 2nd place
      { rankStart: 3, rankEnd: 3, percentage: 2000 }, // 20% for 3rd place
    ]
  )
  .accounts({
    rewardPool: rewardPoolPda,
    poolVault: poolVaultPda,
    creator: wallet.publicKey,
    creatorTokenAccount: creatorAta,
    tokenMint: tokenMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// Distribute rewards
await program.methods
  .distributeRewards(winners)
  .accounts({
    rewardPool: rewardPoolPda,
    rewardDistributor: rewardDistributorPda,
    authority: wallet.publicKey,
  })
  .remainingAccounts(rewardClaimAccounts)
  .rpc();
```

## 📊 Monitoring & Operations

TriviaComb includes a comprehensive monitoring system for production deployments:

### Health Monitoring

```bash
# Run health check
node monitoring/health-check.ts

# Continuous monitoring
node monitoring/health-check.ts --watch
```

### Alert System

```bash
# Start alert monitoring (60s intervals)
node monitoring/alert-system.ts start 60

# Check current alerts
node monitoring/alert-system.ts alerts

# View alert rules
node monitoring/alert-system.ts rules
```

### Rollback System

```bash
# Create system snapshot
node monitoring/rollback-system.ts snapshot "Pre-update backup"

# Create rollback plan
node monitoring/rollback-system.ts plan <snapshot-id> <target-version>

# Execute rollback (with confirmation for high-risk)
node monitoring/rollback-system.ts execute <plan-id> [confirmation-code]
```

## 🧪 Testing

Run the test suite:

```bash
npm test
```

Run specific tests:

```bash
anchor test --skip-build -- --grep "Question Bank"
```

## 🔒 Security Considerations

### Access Control
- All programs implement proper authority checks
- PDA seeds ensure account uniqueness and security
- Signer verification for all state-changing operations

### Input Validation
- Comprehensive parameter validation
- Overflow protection for numeric operations
- String length limits to prevent excessive storage costs

### Economic Security
- Entry fee validation for tournaments
- Prize pool overflow protection
- Platform fee calculations with bounds checking

### Best Practices
- Use of `require!` macros for validation
- Proper error handling with custom error codes
- Bump seed validation for all PDAs

## 📊 Program Accounts

### Question Bank Program

| Account | Description | Size |
|---------|-------------|------|
| `QuestionBankState` | Global program state | 49 bytes |
| `Question` | Individual question data | ~900 bytes |
| `Vote` | User vote on question | 49 bytes |

### Tournament Manager Program

| Account | Description | Size |
|---------|-------------|------|
| `TournamentManagerState` | Global program state | 49 bytes |
| `Tournament` | Tournament configuration | ~700 bytes |
| `Registration` | User tournament registration | 63 bytes |

### Reward Distributor Program

| Account | Description | Size |
|---------|-------------|------|
| `RewardDistributorState` | Global program state | 59 bytes |
| `RewardPool` | Prize pool configuration | ~900 bytes |
| `RewardClaim` | Individual reward claim | 103 bytes |
| `CustomDistribution` | Custom distribution scheme | ~1100 bytes |

## 🚀 Deployment

### Devnet Deployment

```bash
npm run setup:devnet
```

### Mainnet Deployment

1. Generate production keypairs securely
2. Fund deployment account with sufficient SOL
3. Update `Anchor.toml` cluster configuration
4. Deploy programs:

```bash
npm run deploy:mainnet
```

### Verification

Verify deployed programs:

```bash
npm run verify
```

## 🛠️ Development

### Building

```bash
npm run build
```

### Linting

```bash
npm run lint:fix
```

### Local Testing

Start local validator:

```bash
solana-test-validator
```

Deploy locally:

```bash
anchor deploy
```

## 📚 API Documentation

Detailed API documentation is available in the individual program source files:

- [Question Bank API](./programs/question_bank/src/lib.rs)
- [Tournament Manager API](./programs/tournament_manager/src/lib.rs)
- [Reward Distributor API](./programs/reward_distributor/src/lib.rs)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:

- Create an issue on GitHub
- Join our Discord community
- Check the [Anchor documentation](https://www.anchor-lang.com/)
- Review [Solana documentation](https://docs.solana.com/)

## 🔗 Links

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Framework](https://www.anchor-lang.com/)
- [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet)
- [Solana Explorer (Mainnet)](https://explorer.solana.com/)

---

Built with ❤️ by the TriviaComb team