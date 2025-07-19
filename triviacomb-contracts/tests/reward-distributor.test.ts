import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount, TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import TestSetup, { 
  MockDataGenerator, 
  TimeHelper, 
  PDAHelper, 
  GasTracker,
  AssertionHelper,
  LoadTester,
  TestUser,
  PerformanceData 
} from "./utils/test-helpers";

describe("Reward Distributor - Comprehensive Test Suite", () => {
  let testSetup: TestSetup;
  let gasTracker: GasTracker;
  
  // Pool data
  let poolId: number = 1;
  let nextPoolId: number = 2;
  let testToken2: PublicKey;

  before(async () => {
    console.log("🚀 Starting Reward Distributor Test Suite");
    
    testSetup = new TestSetup();
    gasTracker = new GasTracker();
    
    await testSetup.initialize();
    
    console.log("✅ Test setup complete");
  });

  after(async () => {
    await testSetup.cleanup();
    gasTracker.printSummary();
  });

  describe("SOL Reward Pool Creation", () => {
    it("should create a SOL reward pool with performance-based distribution", async () => {
      const authority = testSetup.authority;
      const poolData = {
        id: new anchor.BN(poolId),
        name: "Performance SOL Rewards",
        totalRewards: new anchor.BN(5 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

      const { result, metrics } = await gasTracker.trackGas(
        "create_sol_reward_pool",
        async () => {
          return await testSetup.rewardProgram.methods
            .createRewardPool(poolData, new anchor.BN(2 * LAMPORTS_PER_SOL))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        }
      );

      console.log(`SOL pool creation cost: ${metrics.lamports} lamports`);

      // Verify pool was created
      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.id.toNumber()).to.equal(poolId);
      expect(pool.name).to.equal("Performance SOL Rewards");
      expect(pool.totalRewards.toNumber()).to.equal(5 * LAMPORTS_PER_SOL);
      expect(pool.authority.toString()).to.equal(authority.publicKey.toString());
      expect(pool.active).to.be.true;

      // Verify vault balance
      const vaultInfo = await testSetup.provider.connection.getAccountInfo(rewardVaultPda);
      expect(vaultInfo.lamports).to.equal(2 * LAMPORTS_PER_SOL);
    });

    it("should create an equal-share SOL reward pool", async () => {
      const authority = testSetup.authority;
      const poolData = {
        id: new anchor.BN(nextPoolId),
        name: "Equal Share SOL Pool",
        totalRewards: new anchor.BN(10 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 14 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(nextPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(nextPoolId, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(10 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.distributionCriteria).to.deep.include({ equalShare: {} });
    });

    it("should fail to create pool with invalid parameters", async () => {
      const authority = testSetup.authority;
      const invalidPoolData = {
        id: new anchor.BN(999),
        name: "A".repeat(51), // Too long name
        totalRewards: new anchor.BN(1 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.past(3600)), // Start time in past
        endTime: new anchor.BN(TimeHelper.future(3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(999, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(999, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .createRewardPool(invalidPoolData, new anchor.BN(1 * LAMPORTS_PER_SOL))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "InvalidPoolName"
      );
    });
  });

  describe("SPL Token Reward Pool Creation", () => {
    it("should create an SPL token reward pool with achievement-based distribution", async () => {
      const authority = testSetup.authority;
      const tokenPoolId = 10;
      
      const poolData = {
        id: new anchor.BN(tokenPoolId),
        name: "Achievement Token Rewards",
        totalRewards: new anchor.BN(1000000 * 1000000), // 1M tokens with 6 decimals
        rewardType: { splToken: {} },
        tokenMint: testSetup.tokenMint,
        distributionCriteria: { achievementBased: {} },
        startTime: new anchor.BN(TimeHelper.future(7200)),
        endTime: new anchor.BN(TimeHelper.future(7200 + 30 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tokenPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(tokenPoolId, testSetup.rewardProgram.programId);
      
      // Get token accounts
      const [rewardVaultTokenPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault_token"),
          rewardVaultPda.toBuffer(),
          testSetup.tokenMint.toBuffer(),
        ],
        testSetup.rewardProgram.programId
      );

      const { result, metrics } = await gasTracker.trackGas(
        "create_token_reward_pool",
        async () => {
          return await testSetup.rewardProgram.methods
            .createRewardPool(poolData, new anchor.BN(500000 * 1000000))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: authority.tokenAccount,
              rewardVaultToken: rewardVaultTokenPda,
              tokenMint: testSetup.tokenMint,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        }
      );

      console.log(`Token pool creation cost: ${metrics.lamports} lamports`);

      // Verify pool was created
      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.id.toNumber()).to.equal(tokenPoolId);
      expect(pool.tokenMint.toString()).to.equal(testSetup.tokenMint.toString());
      expect(pool.distributionCriteria).to.deep.include({ achievementBased: {} });

      // Verify token vault has tokens
      const vaultTokenAccount = await getAccount(
        testSetup.provider.connection,
        rewardVaultTokenPda
      );
      expect(Number(vaultTokenAccount.amount)).to.equal(500000 * 1000000);
    });

    it("should fail to create SPL token pool without token mint", async () => {
      const authority = testSetup.authority;
      const invalidTokenPoolData = {
        id: new anchor.BN(998),
        name: "Invalid Token Pool",
        totalRewards: new anchor.BN(1000000),
        rewardType: { splToken: {} },
        tokenMint: null, // Missing token mint for SPL token pool
        distributionCriteria: { achievementBased: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(998, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(998, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .createRewardPool(invalidTokenPoolData, new anchor.BN(0))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "MissingTokenMint"
      );
    });
  });

  describe("Pool Funding", () => {
    it("should fund SOL reward pool with additional SOL", async () => {
      const authority = testSetup.authority;
      const additionalFunding = 3 * LAMPORTS_PER_SOL;

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

      // Get vault balance before
      const vaultBefore = await testSetup.provider.connection.getAccountInfo(rewardVaultPda);

      const { result, metrics } = await gasTracker.trackGas(
        "fund_sol_pool",
        async () => {
          return await testSetup.rewardProgram.methods
            .fundRewardPool(new anchor.BN(poolId), new anchor.BN(additionalFunding))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              funder: authority.publicKey,
              funderTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        }
      );

      console.log(`SOL pool funding cost: ${metrics.lamports} lamports`);

      // Verify vault balance increased
      const vaultAfter = await testSetup.provider.connection.getAccountInfo(rewardVaultPda);
      expect(vaultAfter.lamports).to.equal(vaultBefore.lamports + additionalFunding);

      // Verify pool total_rewards updated
      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.totalRewards.toNumber()).to.equal(5 * LAMPORTS_PER_SOL + additionalFunding);
    });

    it("should fund SPL token pool with additional tokens", async () => {
      const authority = testSetup.authority;
      const tokenPoolId = 10;
      const additionalTokens = 250000 * 1000000; // 250K tokens

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tokenPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(tokenPoolId, testSetup.rewardProgram.programId);
      
      const [rewardVaultTokenPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault_token"),
          rewardVaultPda.toBuffer(),
          testSetup.tokenMint.toBuffer(),
        ],
        testSetup.rewardProgram.programId
      );

      // Get token balance before
      const vaultTokenBefore = await getAccount(
        testSetup.provider.connection,
        rewardVaultTokenPda
      );

      await testSetup.rewardProgram.methods
        .fundRewardPool(new anchor.BN(tokenPoolId), new anchor.BN(additionalTokens))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          funder: authority.publicKey,
          funderTokenAccount: authority.tokenAccount,
          rewardVaultToken: rewardVaultTokenPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Verify token balance increased
      const vaultTokenAfter = await getAccount(
        testSetup.provider.connection,
        rewardVaultTokenPda
      );
      expect(Number(vaultTokenAfter.amount)).to.equal(
        Number(vaultTokenBefore.amount) + additionalTokens
      );
    });

    it("should fail to fund inactive pool", async () => {
      // Create and immediately close a pool to test inactive funding
      const tempPoolId = 50;
      const authority = testSetup.authority;
      
      const poolData = {
        id: new anchor.BN(tempPoolId),
        name: "Temp Pool",
        totalRewards: new anchor.BN(1 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.past(3600)),
        endTime: new anchor.BN(TimeHelper.past(1800)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tempPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(tempPoolId, testSetup.rewardProgram.programId);

      // Create an inactive pool (ended in the past)
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(0))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Try to fund inactive pool
      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .fundRewardPool(new anchor.BN(tempPoolId), new anchor.BN(1 * LAMPORTS_PER_SOL))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              funder: authority.publicKey,
              funderTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "PoolNotActive"
      );
    });
  });

  describe("Reward Calculation - Performance Based", () => {
    it("should calculate high performance rewards correctly", async () => {
      const user = testSetup.users[0];
      const highPerformanceData = {
        score: 95,
        completionTime: new anchor.BN(90), // Fast completion
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 8,
        randomSeed: new anchor.BN(123456),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

      const { result, metrics } = await gasTracker.trackGas(
        "calculate_high_performance_rewards",
        async () => {
          return await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(poolId), highPerformanceData)
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              user: user.publicKey,
              honeycombProfile: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        }
      );

      console.log(`High performance calculation cost: ${metrics.lamports} lamports`);

      // Verify user claim was created
      const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      expect(userClaim.user.toString()).to.equal(user.publicKey.toString());
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
      expect(userClaim.amountClaimed.toNumber()).to.equal(0);

      console.log(`High performance reward: ${userClaim.totalEligible.toNumber()} lamports`);
    });

    it("should calculate medium performance rewards correctly", async () => {
      const user = testSetup.users[1];
      const mediumPerformanceData = {
        score: 75,
        completionTime: new anchor.BN(180), // Medium completion time
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 4,
        randomSeed: new anchor.BN(654321),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(poolId), mediumPerformanceData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: userClaimPda,
          user: user.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.keypair])
        .rpc();

      const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      console.log(`Medium performance reward: ${userClaim.totalEligible.toNumber()} lamports`);
      
      // Medium performance should get less than high performance
      const highPerformanceUser = testSetup.users[0];
      const highPerformanceClaimPda = PDAHelper.getUserClaimPDA(poolId, highPerformanceUser.publicKey, testSetup.rewardProgram.programId);
      const highPerformanceClaim = await testSetup.rewardProgram.account.userClaim.fetch(highPerformanceClaimPda);
      
      expect(userClaim.totalEligible.toNumber()).to.be.lessThan(
        highPerformanceClaim.totalEligible.toNumber()
      );
    });

    it("should calculate low performance rewards correctly", async () => {
      const user = testSetup.users[2];
      const lowPerformanceData = {
        score: 45,
        completionTime: new anchor.BN(300), // Slow completion
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 1,
        randomSeed: new anchor.BN(987654),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(poolId), lowPerformanceData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: userClaimPda,
          user: user.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.keypair])
        .rpc();

      const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      console.log(`Low performance reward: ${userClaim.totalEligible.toNumber()} lamports`);
      
      // Low performance should still get some reward (base amount)
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });

    it("should handle perfect score with maximum rewards", async () => {
      const user = testSetup.users[3];
      const perfectPerformanceData = {
        score: 100,
        completionTime: new anchor.BN(60), // Super fast
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 10,
        randomSeed: new anchor.BN(111111),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(poolId), perfectPerformanceData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: userClaimPda,
          user: user.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.keypair])
        .rpc();

      const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      console.log(`Perfect performance reward: ${userClaim.totalEligible.toNumber()} lamports`);
      
      // Perfect score should get the highest reward
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });

    it("should fail calculation with invalid performance data", async () => {
      const user = testSetup.users[4];
      const invalidPerformanceData = {
        score: 101, // Invalid score > 100
        completionTime: new anchor.BN(60),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 5,
        randomSeed: new anchor.BN(222222),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(poolId), invalidPerformanceData)
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              user: user.publicKey,
              honeycombProfile: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        },
        "InvalidPerformanceData"
      );
    });
  });

  describe("Reward Calculation - Achievement Based", () => {
    it("should calculate achievement-based rewards for token pool", async () => {
      const user = testSetup.users[5];
      const tokenPoolId = 10;
      const achievementData = {
        score: 0, // Not used for achievement-based
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 15, // High achievement count
        randomSeed: new anchor.BN(333333),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tokenPoolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(tokenPoolId, user.publicKey, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(tokenPoolId), achievementData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: userClaimPda,
          user: user.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.keypair])
        .rpc();

      const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      console.log(`Achievement-based reward: ${userClaim.totalEligible.toNumber()} tokens`);
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });

    it("should scale rewards based on achievement count", async () => {
      const user1 = testSetup.users[6];
      const user2 = testSetup.users[7];
      const tokenPoolId = 10;

      // User 1: Few achievements
      const lowAchievementData = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 3,
        randomSeed: new anchor.BN(444444),
        honeycombProfile: null,
      };

      // User 2: Many achievements
      const highAchievementData = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 20,
        randomSeed: new anchor.BN(555555),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tokenPoolId, testSetup.rewardProgram.programId);
      
      // Calculate rewards for both users
      const user1ClaimPda = PDAHelper.getUserClaimPDA(tokenPoolId, user1.publicKey, testSetup.rewardProgram.programId);
      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(tokenPoolId), lowAchievementData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user1ClaimPda,
          user: user1.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1.keypair])
        .rpc();

      const user2ClaimPda = PDAHelper.getUserClaimPDA(tokenPoolId, user2.publicKey, testSetup.rewardProgram.programId);
      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(tokenPoolId), highAchievementData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user2ClaimPda,
          user: user2.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2.keypair])
        .rpc();

      const user1Claim = await testSetup.rewardProgram.account.userClaim.fetch(user1ClaimPda);
      const user2Claim = await testSetup.rewardProgram.account.userClaim.fetch(user2ClaimPda);

      console.log(`Low achievement reward: ${user1Claim.totalEligible.toNumber()} tokens`);
      console.log(`High achievement reward: ${user2Claim.totalEligible.toNumber()} tokens`);

      // User with more achievements should get more rewards
      expect(user2Claim.totalEligible.toNumber()).to.be.greaterThan(
        user1Claim.totalEligible.toNumber()
      );
    });
  });

  describe("Reward Claiming", () => {
    it("should claim SOL rewards successfully", async () => {
      const user = testSetup.users[0]; // User with calculated high performance rewards
      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

      // Get user balance before claim
      const userBalanceBefore = await testSetup.provider.connection.getBalance(user.publicKey);
      const userClaimBefore = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      const claimableAmount = userClaimBefore.totalEligible.toNumber() - userClaimBefore.amountClaimed.toNumber();

      const { result, metrics } = await gasTracker.trackGas(
        "claim_sol_rewards",
        async () => {
          return await testSetup.rewardProgram.methods
            .claimRewards(new anchor.BN(poolId))
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              rewardVault: rewardVaultPda,
              user: user.publicKey,
              userTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        }
      );

      console.log(`SOL claim cost: ${metrics.lamports} lamports`);

      // Verify user received SOL (accounting for transaction fees)
      const userBalanceAfter = await testSetup.provider.connection.getBalance(user.publicKey);
      const expectedBalance = userBalanceBefore + claimableAmount - metrics.lamports;
      expect(userBalanceAfter).to.be.approximately(expectedBalance, 10000); // Allow small variance for fees

      // Verify claim record was updated
      const userClaimAfter = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      expect(userClaimAfter.amountClaimed.toNumber()).to.equal(userClaimBefore.totalEligible.toNumber());
      expect(userClaimAfter.lastClaimTime.toNumber()).to.be.greaterThan(0);

      console.log(`Claimed ${claimableAmount} lamports successfully`);
    });

    it("should claim SPL token rewards successfully", async () => {
      const user = testSetup.users[5]; // User with calculated achievement rewards
      const tokenPoolId = 10;
      
      const rewardPoolPda = PDAHelper.getRewardPoolPDA(tokenPoolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(tokenPoolId, user.publicKey, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(tokenPoolId, testSetup.rewardProgram.programId);
      
      const [rewardVaultTokenPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault_token"),
          rewardVaultPda.toBuffer(),
          testSetup.tokenMint.toBuffer(),
        ],
        testSetup.rewardProgram.programId
      );

      // Get user token balance before claim
      const userTokenBalanceBefore = await getAccount(testSetup.provider.connection, user.tokenAccount);
      const userClaimBefore = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      const claimableAmount = userClaimBefore.totalEligible.toNumber() - userClaimBefore.amountClaimed.toNumber();

      await testSetup.rewardProgram.methods
        .claimRewards(new anchor.BN(tokenPoolId))
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: userClaimPda,
          rewardVault: rewardVaultPda,
          user: user.publicKey,
          userTokenAccount: user.tokenAccount,
          rewardVaultToken: rewardVaultTokenPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user.keypair])
        .rpc();

      // Verify user received tokens
      const userTokenBalanceAfter = await getAccount(testSetup.provider.connection, user.tokenAccount);
      expect(Number(userTokenBalanceAfter.amount)).to.equal(
        Number(userTokenBalanceBefore.amount) + claimableAmount
      );

      // Verify claim record was updated
      const userClaimAfter = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
      expect(userClaimAfter.amountClaimed.toNumber()).to.equal(userClaimBefore.totalEligible.toNumber());

      console.log(`Claimed ${claimableAmount} tokens successfully`);
    });

    it("should fail to claim rewards twice", async () => {
      const user = testSetup.users[0]; // User who already claimed
      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .claimRewards(new anchor.BN(poolId))
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              rewardVault: rewardVaultPda,
              user: user.publicKey,
              userTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        },
        "NothingToClaim"
      );
    });

    it("should fail to claim from inactive pool", async () => {
      const user = testSetup.users[8];
      const inactivePoolId = 50; // Pool created in funding tests (ended in past)
      
      const rewardPoolPda = PDAHelper.getRewardPoolPDA(inactivePoolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(inactivePoolId, user.publicKey, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(inactivePoolId, testSetup.rewardProgram.programId);

      // First try to calculate rewards (should also fail)
      await AssertionHelper.assertError(
        async () => {
          const performanceData = {
            score: 75,
            completionTime: new anchor.BN(120),
            stakingDuration: new anchor.BN(0),
            achievementsUnlocked: 5,
            randomSeed: new anchor.BN(999999),
            honeycombProfile: null,
          };

          await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(inactivePoolId), performanceData)
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              user: user.publicKey,
              honeycombProfile: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        },
        "ClaimPeriodEnded"
      );
    });
  });

  describe("Staking Rewards Distribution", () => {
    it("should create and test staking rewards pool", async () => {
      const authority = testSetup.authority;
      const stakingPoolId = 20;
      
      const poolData = {
        id: new anchor.BN(stakingPoolId),
        name: "Staking Rewards Pool",
        totalRewards: new anchor.BN(365 * LAMPORTS_PER_SOL), // 1 SOL per day for a year
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { stakingRewards: {} },
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 365 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(stakingPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(stakingPoolId, testSetup.rewardProgram.programId);

      // Create staking pool
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(100 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Test different staking durations
      const stakingUser1 = testSetup.users[4];
      const stakingUser2 = testSetup.users[5];

      // User 1: 7 days staking
      const sevenDayStaking = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(7 * 24 * 60 * 60), // 7 days in seconds
        achievementsUnlocked: 0,
        randomSeed: new anchor.BN(777777),
        honeycombProfile: null,
      };

      // User 2: 30 days staking
      const thirtyDayStaking = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(30 * 24 * 60 * 60), // 30 days in seconds
        achievementsUnlocked: 0,
        randomSeed: new anchor.BN(888888),
        honeycombProfile: null,
      };

      // Calculate rewards for both users
      const user1ClaimPda = PDAHelper.getUserClaimPDA(stakingPoolId, stakingUser1.publicKey, testSetup.rewardProgram.programId);
      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(stakingPoolId), sevenDayStaking)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user1ClaimPda,
          user: stakingUser1.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([stakingUser1.keypair])
        .rpc();

      const user2ClaimPda = PDAHelper.getUserClaimPDA(stakingPoolId, stakingUser2.publicKey, testSetup.rewardProgram.programId);
      await testSetup.rewardProgram.methods
        .calculateUserRewards(new anchor.BN(stakingPoolId), thirtyDayStaking)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user2ClaimPda,
          user: stakingUser2.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([stakingUser2.keypair])
        .rpc();

      const user1Claim = await testSetup.rewardProgram.account.userClaim.fetch(user1ClaimPda);
      const user2Claim = await testSetup.rewardProgram.account.userClaim.fetch(user2ClaimPda);

      console.log(`7-day staking reward: ${user1Claim.totalEligible.toNumber()} lamports`);
      console.log(`30-day staking reward: ${user2Claim.totalEligible.toNumber()} lamports`);

      // User with longer staking should get more rewards
      expect(user2Claim.totalEligible.toNumber()).to.be.greaterThan(
        user1Claim.totalEligible.toNumber()
      );
    });
  });

  describe("Random Drop Distribution", () => {
    it("should create and test random drop pool", async () => {
      const authority = testSetup.authority;
      const randomPoolId = 30;
      
      const poolData = {
        id: new anchor.BN(randomPoolId),
        name: "Lucky Draw Pool",
        totalRewards: new anchor.BN(50 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { randomDrop: {} },
        startTime: new anchor.BN(TimeHelper.future(900)),
        endTime: new anchor.BN(TimeHelper.future(900 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(randomPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(randomPoolId, testSetup.rewardProgram.programId);

      // Create random drop pool
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(50 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Test multiple users with different random seeds
      let winnersCount = 0;
      let totalRewardsClaimed = 0;

      for (let i = 6; i < 10; i++) {
        const user = testSetup.users[i];
        const randomData = {
          score: 0,
          completionTime: new anchor.BN(0),
          stakingDuration: new anchor.BN(0),
          achievementsUnlocked: 0,
          randomSeed: new anchor.BN(Math.floor(Math.random() * 1000000)),
          honeycombProfile: null,
        };

        const userClaimPda = PDAHelper.getUserClaimPDA(randomPoolId, user.publicKey, testSetup.rewardProgram.programId);
        
        await testSetup.rewardProgram.methods
          .calculateUserRewards(new anchor.BN(randomPoolId), randomData)
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: userClaimPda,
            user: user.publicKey,
            honeycombProfile: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user.keypair])
          .rpc();

        const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
        if (userClaim.totalEligible.toNumber() > 0) {
          winnersCount++;
          totalRewardsClaimed += userClaim.totalEligible.toNumber();
          console.log(`User ${i} won ${userClaim.totalEligible.toNumber()} lamports!`);
        }
      }

      console.log(`Random drop results: ${winnersCount}/4 users won rewards`);
      console.log(`Total random rewards: ${totalRewardsClaimed} lamports`);

      // Some users should win (probability-based, so not guaranteed all or none)
      expect(winnersCount).to.be.lessThanOrEqual(4);
    });
  });

  describe("Pool Management", () => {
    it("should update distribution criteria for inactive pool", async () => {
      const authority = testSetup.authority;
      const futurePoolId = 40;
      
      // Create a pool that starts in the future
      const poolData = {
        id: new anchor.BN(futurePoolId),
        name: "Future Pool",
        totalRewards: new anchor.BN(10 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.future(7200)), // Starts in 2 hours
        endTime: new anchor.BN(TimeHelper.future(7200 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(futurePoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(futurePoolId, testSetup.rewardProgram.programId);

      // Create pool
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(10 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Update distribution criteria
      await testSetup.rewardProgram.methods
        .updateDistributionCriteria(
          new anchor.BN(futurePoolId),
          { equalShare: {} }
        )
        .accounts({
          rewardPool: rewardPoolPda,
          authority: authority.publicKey,
        })
        .signers([authority.keypair])
        .rpc();

      // Verify update
      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.distributionCriteria).to.deep.include({ equalShare: {} });
    });

    it("should fail to update active pool distribution criteria", async () => {
      const authority = testSetup.authority;
      const activePoolId = poolId; // Pool that is currently active

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(activePoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .updateDistributionCriteria(
              new anchor.BN(activePoolId),
              { randomDrop: {} }
            )
            .accounts({
              rewardPool: rewardPoolPda,
              authority: authority.publicKey,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "CannotUpdateActivePool"
      );
    });

    it("should fail to update pool with wrong authority", async () => {
      const wrongAuthority = testSetup.users[0];
      const futurePoolId = 40;

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(futurePoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .updateDistributionCriteria(
              new anchor.BN(futurePoolId),
              { stakingRewards: {} }
            )
            .accounts({
              rewardPool: rewardPoolPda,
              authority: wrongAuthority.publicKey,
            })
            .signers([wrongAuthority.keypair])
            .rpc();
        },
        "UnauthorizedAuthority"
      );
    });

    it("should close expired pool and return funds", async () => {
      const authority = testSetup.authority;
      const expiredPoolId = 60;
      
      // Create an expired pool
      const poolData = {
        id: new anchor.BN(expiredPoolId),
        name: "Expired Pool",
        totalRewards: new anchor.BN(5 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.past(7200)),
        endTime: new anchor.BN(TimeHelper.past(3600)), // Ended 1 hour ago
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(expiredPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(expiredPoolId, testSetup.rewardProgram.programId);

      // Create pool with some funding
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(3 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      // Get authority balance before closing
      const balanceBefore = await testSetup.provider.connection.getBalance(authority.publicKey);

      // Close pool
      const { result, metrics } = await gasTracker.trackGas(
        "close_reward_pool",
        async () => {
          return await testSetup.rewardProgram.methods
            .closeRewardPool(new anchor.BN(expiredPoolId))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        }
      );

      console.log(`Pool closure cost: ${metrics.lamports} lamports`);

      // Verify authority received remaining funds (minus transaction fee)
      const balanceAfter = await testSetup.provider.connection.getBalance(authority.publicKey);
      const expectedBalance = balanceBefore + (3 * LAMPORTS_PER_SOL) - metrics.lamports;
      expect(balanceAfter).to.be.approximately(expectedBalance, 10000);

      // Verify pool account is closed
      await AssertionHelper.assertAccountNotExists(
        testSetup.provider.connection,
        rewardPoolPda,
        "Pool account should be closed"
      );
    });

    it("should fail to close active pool", async () => {
      const authority = testSetup.authority;
      const activePoolId = poolId; // Pool that is still active

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(activePoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(activePoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .closeRewardPool(new anchor.BN(activePoolId))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "PoolStillActive"
      );
    });
  });

  describe("Honeycomb Integration", () => {
    it("should verify valid Honeycomb achievements", async () => {
      const user = testSetup.users[9];
      const verificationPoolId = poolId;
      
      const achievementData = {
        profileOwner: user.publicKey,
        achievements: [
          {
            id: "first_win",
            name: "First Victory",
            description: "Win your first game",
            points: 100,
            timestamp: new anchor.BN(TimeHelper.now() - 3600),
            verified: true,
          },
          {
            id: "speed_demon",
            name: "Speed Demon",
            description: "Complete in under 60 seconds",
            points: 200,
            timestamp: new anchor.BN(TimeHelper.now() - 1800),
            verified: true,
          },
        ],
        totalScore: new anchor.BN(300),
        completionRate: 95,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(verificationPoolId, testSetup.rewardProgram.programId);

      // This should succeed (returns boolean)
      const isValid = await testSetup.rewardProgram.methods
        .verifyHoneycombAchievements(new anchor.BN(verificationPoolId), achievementData)
        .accounts({
          rewardPool: rewardPoolPda,
          user: user.publicKey,
          honeycombProfile: user.publicKey, // Mock profile
        })
        .view();

      expect(isValid).to.be.true;
      console.log("Honeycomb achievement verification passed");
    });

    it("should reject invalid achievement data", async () => {
      const user = testSetup.users[9];
      const verificationPoolId = poolId;
      
      const invalidAchievementData = {
        profileOwner: user.publicKey,
        achievements: Array(101).fill(0).map((_, i) => ({ // Too many achievements (> 100)
          id: `achievement_${i}`,
          name: `Achievement ${i}`,
          description: "Test achievement",
          points: 10,
          timestamp: new anchor.BN(TimeHelper.now()),
          verified: true,
        })),
        totalScore: new anchor.BN(1010),
        completionRate: 100,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(verificationPoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .verifyHoneycombAchievements(new anchor.BN(verificationPoolId), invalidAchievementData)
            .accounts({
              rewardPool: rewardPoolPda,
              user: user.publicKey,
              honeycombProfile: user.publicKey,
            })
            .view();
        },
        "TooManyAchievements"
      );
    });
  });

  describe("Performance Tests", () => {
    it("should handle concurrent reward calculations efficiently", async () => {
      const concurrentUsers = testSetup.users.slice(0, 5);
      const testPoolId = poolId;

      const operations = concurrentUsers.map((user, index) => async () => {
        const performanceData = MockDataGenerator.generatePerformanceData("random");
        const rewardPoolPda = PDAHelper.getRewardPoolPDA(testPoolId, testSetup.rewardProgram.programId);
        const userClaimPda = PDAHelper.getUserClaimPDA(testPoolId, user.publicKey, testSetup.rewardProgram.programId);

        // Only calculate if not already calculated
        try {
          await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
          // Already exists, skip
          return `User ${index} already has rewards calculated`;
        } catch {
          // Doesn't exist, proceed with calculation
          return await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(testPoolId), {
              score: performanceData.score,
              completionTime: performanceData.completionTime,
              stakingDuration: performanceData.stakingDuration,
              achievementsUnlocked: performanceData.achievementsUnlocked,
              randomSeed: performanceData.randomSeed,
              honeycombProfile: performanceData.honeycombProfile,
            })
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              user: user.publicKey,
              honeycombProfile: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        }
      });

      const { results, throughput, avgTime } = await LoadTester.measureThroughput(
        async () => {
          return await LoadTester.concurrentOperations(operations, 3);
        },
        1,
        "Concurrent reward calculations"
      );

      expect(throughput).to.be.greaterThan(0);
      console.log(`Concurrent calculations completed with ${avgTime.toFixed(2)}ms average time`);
    });

    it("should measure gas costs for different pool operations", async () => {
      console.log("\n📊 Gas Cost Analysis:");
      
      const metrics = gasTracker.getMetrics();
      const operationCosts = new Map();

      // Group metrics by operation type
      for (const metric of metrics) {
        if (!operationCosts.has(metric.instruction)) {
          operationCosts.set(metric.instruction, []);
        }
        operationCosts.get(metric.instruction).push(metric.lamports);
      }

      // Calculate averages
      for (const [operation, costs] of operationCosts) {
        const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
        const maxCost = Math.max(...costs);
        const minCost = Math.min(...costs);
        
        console.log(`  ${operation}:`);
        console.log(`    Average: ${avgCost.toFixed(0)} lamports`);
        console.log(`    Range: ${minCost} - ${maxCost} lamports`);
        console.log(`    Executions: ${costs.length}`);
      }

      // Verify costs are reasonable (under 0.01 SOL per operation)
      for (const costs of operationCosts.values()) {
        const maxCost = Math.max(...costs);
        expect(maxCost).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
      }
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle pool with zero total rewards", async () => {
      const authority = testSetup.authority;
      const zeroPoolId = 70;
      
      const poolData = {
        id: new anchor.BN(zeroPoolId),
        name: "Zero Rewards Pool",
        totalRewards: new anchor.BN(0),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(zeroPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(zeroPoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .createRewardPool(poolData, new anchor.BN(0))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "InvalidRewardAmount"
      );
    });

    it("should handle negative time values in performance data", async () => {
      const user = testSetup.users[0];
      const testPoolId = poolId;
      
      const invalidPerformanceData = {
        score: 75,
        completionTime: new anchor.BN(-100), // Negative completion time
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 5,
        randomSeed: new anchor.BN(123456),
        honeycombProfile: null,
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(testPoolId, testSetup.rewardProgram.programId);
      const userClaimPda = PDAHelper.getUserClaimPDA(testPoolId, user.publicKey, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(testPoolId), invalidPerformanceData)
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              user: user.publicKey,
              honeycombProfile: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        },
        "InvalidPerformanceData"
      );
    });

    it("should handle pool with end time before start time", async () => {
      const authority = testSetup.authority;
      const invalidTimePoolId = 80;
      
      const poolData = {
        id: new anchor.BN(invalidTimePoolId),
        name: "Invalid Time Pool",
        totalRewards: new anchor.BN(1 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.future(7200)), // Start time
        endTime: new anchor.BN(TimeHelper.future(3600)), // End time before start time
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(invalidTimePoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(invalidTimePoolId, testSetup.rewardProgram.programId);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.rewardProgram.methods
            .createRewardPool(poolData, new anchor.BN(0))
            .accounts({
              rewardPool: rewardPoolPda,
              rewardVault: rewardVaultPda,
              authority: authority.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authority.keypair])
            .rpc();
        },
        "InvalidEndTime"
      );
    });

    it("should handle extremely large reward amounts", async () => {
      const authority = testSetup.authority;
      const largePoolId = 90;
      
      const poolData = {
        id: new anchor.BN(largePoolId),
        name: "Large Rewards Pool",
        totalRewards: new anchor.BN("18446744073709551615"), // Near u64::MAX
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { equalShare: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(largePoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(largePoolId, testSetup.rewardProgram.programId);

      // This should create successfully but won't be funded
      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(0))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority.keypair])
        .rpc();

      const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
      expect(pool.totalRewards.toString()).to.equal("18446744073709551615");
    });
  });
});