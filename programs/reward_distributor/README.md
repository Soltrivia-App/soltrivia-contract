# Reward Distributor Smart Contract

A comprehensive Solana smart contract for custom reward distribution that complements Honeycomb Protocol, supporting multiple reward types, distribution criteria, and Honeycomb integration.

## 🎯 Overview

The Reward Distributor contract enables:
- **Multiple Reward Types**: SOL, SPL tokens, and NFTs (future)
- **Flexible Distribution**: Performance-based, staking, achievements, equal share, random drops
- **Honeycomb Integration**: Verify achievements and profile data from Honeycomb Protocol
- **Secure Fund Management**: Protected vaults with authority controls
- **Time-based Campaigns**: Start/end times for reward periods

## 📋 Contract Specifications

### Account Structures

#### RewardPool (PDA: ["pool", pool_id])
Central configuration for each reward distribution campaign.

```rust
pub struct RewardPool {
    pub id: u64,                           // Unique pool identifier
    pub authority: Pubkey,                 // Pool creator/admin
    pub name: String,                      // Pool name (max 50 chars)
    pub total_rewards: u64,                // Total reward amount
    pub distributed_rewards: u64,          // Amount already distributed
    pub reward_type: RewardType,           // SOL/SPL_TOKEN/NFT
    pub token_mint: Option<Pubkey>,        // Token mint for SPL rewards
    pub distribution_criteria: DistributionType, // How rewards are calculated
    pub start_time: i64,                   // Campaign start timestamp
    pub end_time: i64,                     // Campaign end timestamp
    pub active: bool,                      // Pool status
    pub bump: u8,                          // PDA bump seed
}
```

#### UserClaim (PDA: ["claim", pool_id, user])
Tracks individual user reward eligibility and claims.

```rust
pub struct UserClaim {
    pub pool: Pubkey,                      // Associated reward pool
    pub user: Pubkey,                      // User public key
    pub amount_claimed: u64,               // Total amount claimed
    pub last_claim_time: i64,              // Last claim timestamp
    pub total_eligible: u64,               // Total eligible rewards
    pub bump: u8,                          // PDA bump seed
}
```

#### RewardVault (PDA: ["reward_vault", pool_id])
Secure storage for reward funds.

```rust
pub struct RewardVault {
    pub pool: Pubkey,                      // Associated reward pool
    pub bump: u8,                          // PDA bump seed
}
```

### Enums and Data Types

#### RewardType
```rust
pub enum RewardType {
    SOL,        // Native SOL rewards
    SplToken,   // SPL token rewards
    NFT,        // NFT rewards (future implementation)
}
```

#### DistributionType
```rust
pub enum DistributionType {
    EqualShare,        // Equal distribution among eligible users
    PerformanceBased,  // Based on game performance metrics
    StakingRewards,    // Based on staking duration
    AchievementBased,  // Based on specific achievements
    RandomDrop,        // Random selection from eligible users
}
```

#### PerformanceData
```rust
pub struct PerformanceData {
    pub score: u32,                        // Game/performance score (0-100)
    pub completion_time: i64,              // Time to complete (seconds)
    pub staking_duration: i64,             // Staking duration (seconds)
    pub achievements_unlocked: u32,        // Number of achievements
    pub random_seed: u64,                  // Seed for random calculations
    pub honeycomb_profile: Option<Pubkey>, // Honeycomb profile reference
}
```

## 🔧 Instructions

### 1. create_reward_pool
Create a new reward distribution pool.

```rust
pub fn create_reward_pool(
    ctx: Context<CreateRewardPool>,
    pool_data: CreateRewardPoolData,
    initial_funding: u64,
) -> Result<()>
```

**Parameters:**
- `pool_data`: Pool configuration including type, criteria, timing
- `initial_funding`: Initial amount to fund the pool

**Effects:**
- Creates RewardPool and RewardVault accounts
- Transfers initial funding to vault (if provided)
- Sets up token accounts for SPL token pools

### 2. fund_reward_pool
Add additional funding to an existing pool.

```rust
pub fn fund_reward_pool(
    ctx: Context<FundRewardPool>,
    pool_id: u64,
    amount: u64,
) -> Result<()>
```

**Requirements:**
- Pool must be active
- Amount must be greater than 0
- Appropriate token accounts for SPL tokens

### 3. calculate_user_rewards
Calculate reward eligibility based on performance data.

```rust
pub fn calculate_user_rewards(
    ctx: Context<CalculateUserRewards>,
    pool_id: u64,
    performance_data: PerformanceData,
) -> Result<u64>
```

**Features:**
- Validates performance data
- Applies distribution algorithm based on pool criteria
- Creates or updates UserClaim record
- Returns calculated reward amount

### 4. claim_rewards
Claim calculated rewards for the user.

```rust
pub fn claim_rewards(
    ctx: Context<ClaimRewards>,
    pool_id: u64,
) -> Result<()>
```

**Requirements:**
- Pool must be active and within claim period
- User must have eligible rewards
- Pool must have sufficient funds

### 5. update_distribution_criteria
Update pool distribution method (authority only).

```rust
pub fn update_distribution_criteria(
    ctx: Context<UpdateDistributionCriteria>,
    pool_id: u64,
    new_criteria: DistributionType,
) -> Result<()>
```

**Requirements:**
- Only pool authority can call
- Pool must not have started yet

### 6. close_reward_pool
Close pool and return remaining funds (authority only).

```rust
pub fn close_reward_pool(
    ctx: Context<CloseRewardPool>,
    pool_id: u64,
) -> Result<()>
```

**Requirements:**
- Only pool authority can call
- Pool must have ended
- Returns remaining funds to authority

### 7. verify_honeycomb_achievements
Verify user achievements from Honeycomb Protocol.

```rust
pub fn verify_honeycomb_achievements(
    ctx: Context<VerifyHoneycombAchievements>,
    pool_id: u64,
    achievement_data: HoneycombAchievementData,
) -> Result<bool>
```

**Integration Points:**
- Validates achievement data against Honeycomb profiles
- Verifies achievement signatures and timestamps
- Returns verification status

## 🎮 Distribution Algorithms

### Performance-Based Distribution
Rewards based on game performance metrics:

```rust
// Base reward calculation
let base_reward = pool.total_rewards / 1000; // 0.1% base allocation

// Performance multiplier (score 0-100)
let multiplier = match score {
    0..=50 => 1,
    51..=75 => 2, 
    76..=90 => 3,
    91..=99 => 4,
    100 => 5,
};

// Time bonus for faster completion
let time_bonus = max(1, 120 - completion_time_minutes);

// Final calculation
let reward = (base_reward * multiplier * time_bonus) / 100;
let capped_reward = min(reward, pool.total_rewards / 10); // Max 10% per user
```

### Staking Rewards Distribution
Rewards based on staking duration:

```rust
let daily_reward = pool.total_rewards / 365;
let staking_days = staking_duration / (24 * 60 * 60);
let reward = daily_reward * staking_days;
let capped_reward = min(reward, pool.total_rewards / 10);
```

### Achievement-Based Distribution
Rewards based on achievements unlocked:

```rust
let base_reward = pool.total_rewards / 100; // 1% per achievement
let reward = base_reward * achievements_count;
let capped_reward = min(reward, pool.total_rewards / 5); // Max 20%
```

### Random Drop Distribution
Random reward distribution:

```rust
let random_value = random_seed % 100;
if random_value < 10 { // 10% chance
    let reward = pool.total_rewards / 50; // 2% of pool
    return reward;
}
return 0;
```

## 🔗 Honeycomb Protocol Integration

### Achievement Verification
```rust
pub struct HoneycombAchievementData {
    pub profile_owner: Pubkey,
    pub achievements: Vec<Achievement>,
    pub total_score: u64,
    pub completion_rate: u32,
}

pub struct Achievement {
    pub id: String,
    pub name: String,
    pub description: String,
    pub points: u32,
    pub timestamp: i64,
    pub verified: bool,
}
```

### Integration Points
- **Profile Verification**: Validate user profiles against Honeycomb
- **Achievement Validation**: Verify achievement authenticity
- **Mission Completion**: Use mission data for reward calculations
- **Trait-based Distribution**: Support trait-specific rewards

### Usage Example
```typescript
const achievementData = {
  profileOwner: honeycombProfile.publicKey,
  achievements: [
    {
      id: "first_win",
      name: "First Victory",
      description: "Win your first game",
      points: 100,
      timestamp: Date.now() / 1000,
      verified: true,
    }
  ],
  totalScore: 100,
  completionRate: 95,
};

const isValid = await client.verifyHoneycombAchievements(
  poolId, 
  achievementData, 
  user
);
```

## 🛡️ Security Features

### Access Control
- **Authority Validation**: Only pool creators can manage pools
- **Time-based Restrictions**: Claim periods enforced
- **Fund Protection**: Secure vault with PDA authority

### Anti-Fraud Measures
- **Double-Claiming Prevention**: Track claimed amounts
- **Performance Validation**: Validate input data ranges
- **Honeycomb Verification**: Authenticate achievement data

### Economic Security
- **Pool Fund Limits**: Maximum per-user allocations
- **Overflow Protection**: Safe arithmetic operations
- **Insufficient Fund Checks**: Validate pool balances

## 🔢 Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6200 | PoolNotFound | Pool not found with given ID |
| 6201 | InsufficientPoolFunds | Pool has insufficient funds |
| 6202 | ClaimPeriodEnded | Claim period has ended |
| 6203 | AlreadyClaimed | User already claimed maximum |
| 6204 | InvalidPerformanceData | Performance data validation failed |
| 6205 | InvalidPoolName | Pool name too long (max 50 chars) |
| 6206 | InvalidStartTime | Start time must be in future |
| 6207 | InvalidEndTime | End time must be after start |
| 6208 | InvalidRewardAmount | Reward amount must be positive |
| 6209 | MissingTokenMint | Token mint required for SPL rewards |
| 6210 | NFTFundingUnsupported | NFT funding not yet supported |
| 6211 | PoolNotActive | Pool is not active |
| 6212 | ClaimPeriodNotStarted | Claim period hasn't started |
| 6213 | InvalidClaimRecord | Invalid claim record for user |
| 6214 | NothingToClaim | No rewards available to claim |
| 6215 | NFTClaimUnsupported | NFT claiming not yet supported |
| 6216 | UnauthorizedAuthority | Not authorized to perform action |
| 6217 | CannotUpdateActivePool | Cannot update active pool |
| 6218 | PoolStillActive | Pool is still active |
| 6219 | InvalidHoneycombProfile | Invalid Honeycomb profile |
| 6220 | TooManyAchievements | Too many achievements (max 100) |
| 6221 | InvalidAchievementData | Achievement data validation failed |

## 💾 Storage Costs

### Account Sizes
- **RewardPool**: 193 bytes
- **UserClaim**: 89 bytes  
- **RewardVault**: 33 bytes

### Rent Costs (approximate)
- **RewardPool**: ~0.0014 SOL
- **UserClaim**: ~0.0006 SOL per user
- **RewardVault**: ~0.0002 SOL

## 🎮 Usage Examples

### TypeScript Client Usage

```typescript
import { RewardDistributorClient, RewardType, DistributionType } from './client';

// Initialize client
const client = createRewardDistributorClient("devnet", wallet);

// Create performance-based SOL pool
const poolData = {
  id: 1,
  name: "Weekly Performance Rewards",
  totalRewards: 10 * LAMPORTS_PER_SOL,
  rewardType: RewardType.SOL,
  distributionCriteria: DistributionType.PerformanceBased,
  startTime: Math.floor(Date.now() / 1000) + 3600,
  endTime: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
};

const tx = await client.createRewardPool(poolData, 5 * LAMPORTS_PER_SOL);

// Calculate and claim rewards
const performanceData = {
  score: 85,
  completionTime: 120,
  stakingDuration: 0,
  achievementsUnlocked: 5,
  randomSeed: Math.random() * 1000000,
};

const { calculatedReward } = await client.calculateUserRewards(
  1, 
  performanceData
);

const { claimedAmount } = await client.claimRewards(1);
```

### Rust Integration

```rust
use reward_distributor::{CreateRewardPoolData, PerformanceData, RewardType, DistributionType};

// Create pool data
let pool_data = CreateRewardPoolData {
    id: 1,
    name: "Achievement Rewards".to_string(),
    total_rewards: 1000000, // 1M tokens
    reward_type: RewardType::SplToken,
    token_mint: Some(token_mint),
    distribution_criteria: DistributionType::AchievementBased,
    start_time: start_timestamp,
    end_time: end_timestamp,
};

// Create pool
reward_distributor::cpi::create_reward_pool(
    CpiContext::new(program, accounts),
    pool_data,
    initial_funding,
)?;
```

## 🧪 Testing

Run comprehensive tests:

```bash
# All tests
anchor test

# Specific test file  
anchor test tests/reward_distributor.ts

# With local validator
anchor test --skip-deploy
```

### Test Coverage
- ✅ SOL reward pools creation and funding
- ✅ SPL token reward pools with associated accounts
- ✅ All distribution types (performance, staking, achievement, random)
- ✅ Reward calculation and claiming workflows
- ✅ Pool management (update criteria, close pools)
- ✅ Honeycomb achievement verification
- ✅ Security constraints and error handling
- ✅ Edge cases and validation

## 🚀 Integration Patterns

### Tournament Integration
```typescript
// Create tournament reward pool
const tournamentPool = await rewardClient.createRewardPool({
  id: tournamentId,
  name: `Tournament ${tournamentId} Rewards`,
  totalRewards: prizePool,
  rewardType: RewardType.SOL,
  distributionCriteria: DistributionType.PerformanceBased,
  startTime: tournamentStartTime,
  endTime: tournamentEndTime,
});

// After tournament completion
for (const participant of participants) {
  const performanceData = {
    score: participant.finalScore,
    completionTime: participant.totalTime,
    // ... other metrics
  };
  
  await rewardClient.calculateUserRewards(
    tournamentId,
    performanceData,
    participant.wallet
  );
}
```

### Honeycomb Integration
```typescript
// Verify user achievements before reward calculation
const achievementData = await honeycombClient.getUserAchievements(user);
const isValid = await rewardClient.verifyHoneycombAchievements(
  poolId,
  achievementData,
  user
);

if (isValid) {
  // Proceed with reward calculation
  await rewardClient.calculateUserRewards(poolId, performanceData, user);
}
```

### Staking Integration
```typescript
// Create staking reward pool
const stakingPool = await rewardClient.createRewardPool({
  id: poolId,
  name: "Monthly Staking Rewards",
  totalRewards: monthlyRewardBudget,
  rewardType: RewardType.SplToken,
  tokenMint: rewardTokenMint,
  distributionCriteria: DistributionType.StakingRewards,
  startTime: monthStart,
  endTime: monthEnd,
});

// Calculate staking rewards
const stakingData = {
  score: 0,
  completionTime: 0,
  stakingDuration: userStakingDuration,
  achievementsUnlocked: 0,
  randomSeed: 0,
};

await rewardClient.calculateUserRewards(poolId, stakingData, user);
```

## 🔮 Future Enhancements

### Planned Features
- **NFT Reward Support**: Complete NFT distribution implementation
- **Batch Operations**: Process multiple users in single transaction
- **Vesting Schedules**: Time-locked reward releases
- **Pool Templates**: Pre-configured pool types
- **Analytics Dashboard**: Pool performance metrics

### Advanced Distribution Types
- **Logarithmic Rewards**: Diminishing returns for high scores
- **Tier-based Distribution**: Multiple reward tiers
- **Combo Rewards**: Multiple criteria combinations
- **Social Rewards**: Referral and community bonuses

### Integration Roadmap
- **Advanced Honeycomb Features**: Mission chains, trait evolution
- **Cross-Program Rewards**: Integration with DeFi protocols
- **Oracle Integration**: External data sources for rewards
- **DAO Governance**: Community-controlled pool management

---

Built with ❤️ for the TriviaComb ecosystem and Honeycomb Protocol integration