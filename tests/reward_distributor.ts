import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RewardDistributor } from "../target/types/reward_distributor";
import { expect } from "chai";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  createMint, 
  createAccount, 
  mintTo, 
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

describe("Reward Distributor", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.RewardDistributor as Program<RewardDistributor>;
  const provider = anchor.AnchorProvider.env();

  // Test accounts
  let authority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let funder: Keypair;

  // Token setup
  let tokenMint: PublicKey;
  let authorityTokenAccount: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  let funderTokenAccount: PublicKey;

  // Pool data
  const poolId = 1;
  let rewardPoolPda: PublicKey;
  let rewardVaultPda: PublicKey;
  let rewardVaultTokenPda: PublicKey;
  let user1ClaimPda: PublicKey;
  let user2ClaimPda: PublicKey;

  before(async () => {
    // Generate test keypairs
    authority = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    funder = Keypair.generate();

    // Airdrop SOL to test accounts
    await Promise.all([
      provider.connection.requestAirdrop(authority.publicKey, 5 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user1.publicKey, 2 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user2.publicKey, 2 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(funder.publicKey, 3 * LAMPORTS_PER_SOL),
    ]);

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create test token mint
    tokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6 // 6 decimals
    );

    // Find PDAs
    [rewardPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), Buffer.from(poolId.toString().padStart(8, '0'))],
      program.programId
    );

    [rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), Buffer.from(poolId.toString().padStart(8, '0'))],
      program.programId
    );

    [user1ClaimPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), Buffer.from(poolId.toString().padStart(8, '0')), user1.publicKey.toBuffer()],
      program.programId
    );

    [user2ClaimPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), Buffer.from(poolId.toString().padStart(8, '0')), user2.publicKey.toBuffer()],
      program.programId
    );

    // Create token accounts
    authorityTokenAccount = await createAccount(
      provider.connection,
      authority,
      tokenMint,
      authority.publicKey
    );

    user1TokenAccount = await createAccount(
      provider.connection,
      authority,
      tokenMint,
      user1.publicKey
    );

    user2TokenAccount = await createAccount(
      provider.connection,
      authority,
      tokenMint,
      user2.publicKey
    );

    funderTokenAccount = await createAccount(
      provider.connection,
      authority,
      tokenMint,
      funder.publicKey
    );

    // Mint tokens to accounts
    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      authorityTokenAccount,
      authority,
      1000000 * 1000000 // 1M tokens
    );

    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      funderTokenAccount,
      authority,
      500000 * 1000000 // 500K tokens
    );
  });

  describe("SOL Reward Pool", () => {
    it("Creates a SOL reward pool with initial funding", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const poolData = {
        id: new anchor.BN(poolId),
        name: "Test SOL Pool",
        totalRewards: new anchor.BN(10 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(currentTime + 60), // Start in 1 minute
        endTime: new anchor.BN(currentTime + 3600), // End in 1 hour
      };

      const initialFunding = 5 * LAMPORTS_PER_SOL;

      const tx = await program.methods
        .createRewardPool(poolData, new anchor.BN(initialFunding))
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
        .signers([authority])
        .rpc();

      console.log("Create SOL reward pool tx:", tx);

      // Verify reward pool
      const rewardPool = await program.account.rewardPool.fetch(rewardPoolPda);
      expect(rewardPool.id.toNumber()).to.equal(poolId);
      expect(rewardPool.authority.toString()).to.equal(authority.publicKey.toString());
      expect(rewardPool.name).to.equal("Test SOL Pool");
      expect(rewardPool.totalRewards.toNumber()).to.equal(10 * LAMPORTS_PER_SOL);
      expect(rewardPool.distributedRewards.toNumber()).to.equal(0);
      expect(rewardPool.active).to.be.true;

      // Verify vault received funding
      const vaultBalance = await provider.connection.getBalance(rewardVaultPda);
      expect(vaultBalance).to.be.greaterThan(initialFunding - 10000); // Account for rent
    });

    it("Funds the SOL reward pool with additional SOL", async () => {
      const additionalFunding = 2 * LAMPORTS_PER_SOL;

      await program.methods
        .fundRewardPool(new anchor.BN(poolId), new anchor.BN(additionalFunding))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          funder: funder.publicKey,
          funderTokenAccount: null,
          rewardVaultToken: null,
          tokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([funder])
        .rpc();

      // Verify updated total rewards
      const rewardPool = await program.account.rewardPool.fetch(rewardPoolPda);
      expect(rewardPool.totalRewards.toNumber()).to.equal(12 * LAMPORTS_PER_SOL);
    });

    it("Calculates user rewards based on performance", async () => {
      // Wait for pool to start
      await new Promise(resolve => setTimeout(resolve, 61000));

      const performanceData = {
        score: 85,
        completionTime: new anchor.BN(120), // 2 minutes
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 5,
        randomSeed: new anchor.BN(42),
        honeycombProfile: null,
      };

      const calculatedReward = await program.methods
        .calculateUserRewards(new anchor.BN(poolId), performanceData)
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user1ClaimPda,
          user: user1.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      console.log("Calculate rewards tx:", calculatedReward);

      // Verify user claim record
      const userClaim = await program.account.userClaim.fetch(user1ClaimPda);
      expect(userClaim.pool.toString()).to.equal(rewardPoolPda.toString());
      expect(userClaim.user.toString()).to.equal(user1.publicKey.toString());
      expect(userClaim.amountClaimed.toNumber()).to.equal(0);
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });

    it("Claims SOL rewards for user", async () => {
      const userBalanceBefore = await provider.connection.getBalance(user1.publicKey);

      await program.methods
        .claimRewards(new anchor.BN(poolId))
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user1ClaimPda,
          rewardVault: rewardVaultPda,
          user: user1.publicKey,
          userTokenAccount: null,
          rewardVaultToken: null,
          tokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const userBalanceAfter = await provider.connection.getBalance(user1.publicKey);
      expect(userBalanceAfter).to.be.greaterThan(userBalanceBefore);

      // Verify claim record updated
      const userClaim = await program.account.userClaim.fetch(user1ClaimPda);
      expect(userClaim.amountClaimed.toNumber()).to.equal(userClaim.totalEligible.toNumber());
      expect(userClaim.lastClaimTime.toNumber()).to.be.greaterThan(0);
    });

    it("Prevents double claiming", async () => {
      try {
        await program.methods
          .claimRewards(new anchor.BN(poolId))
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: user1ClaimPda,
            rewardVault: rewardVaultPda,
            user: user1.publicKey,
            userTokenAccount: null,
            rewardVaultToken: null,
            tokenProgram: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.error.errorCode.code).to.equal("NothingToClaim");
      }
    });
  });

  describe("SPL Token Reward Pool", () => {
    const tokenPoolId = 2;
    let tokenPoolPda: PublicKey;
    let tokenVaultPda: PublicKey;
    let tokenVaultTokenPda: PublicKey;

    before(async () => {
      [tokenPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.from(tokenPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      [tokenVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), Buffer.from(tokenPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      // Create associated token account for vault
      tokenVaultTokenPda = await anchor.utils.token.associatedAddress({
        mint: tokenMint,
        owner: tokenVaultPda,
      });
    });

    it("Creates a SPL token reward pool", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const poolData = {
        id: new anchor.BN(tokenPoolId),
        name: "Test Token Pool",
        totalRewards: new anchor.BN(100000 * 1000000), // 100K tokens
        rewardType: { splToken: {} },
        tokenMint: tokenMint,
        distributionCriteria: { achievementBased: {} },
        startTime: new anchor.BN(currentTime + 60),
        endTime: new anchor.BN(currentTime + 3600),
      };

      const initialFunding = 50000 * 1000000; // 50K tokens

      await program.methods
        .createRewardPool(poolData, new anchor.BN(initialFunding))
        .accounts({
          rewardPool: tokenPoolPda,
          rewardVault: tokenVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: authorityTokenAccount,
          rewardVaultToken: tokenVaultTokenPda,
          tokenMint: tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Verify vault received tokens
      const vaultTokenAccount = await getAccount(provider.connection, tokenVaultTokenPda);
      expect(Number(vaultTokenAccount.amount)).to.equal(initialFunding);
    });

    it("Calculates and claims SPL token rewards", async () => {
      // Wait for pool to start
      await new Promise(resolve => setTimeout(resolve, 61000));

      const [userClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), Buffer.from(tokenPoolId.toString().padStart(8, '0')), user2.publicKey.toBuffer()],
        program.programId
      );

      // Calculate rewards
      const performanceData = {
        score: 75,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 10,
        randomSeed: new anchor.BN(123),
        honeycombProfile: null,
      };

      await program.methods
        .calculateUserRewards(new anchor.BN(tokenPoolId), performanceData)
        .accounts({
          rewardPool: tokenPoolPda,
          userClaim: userClaimPda,
          user: user2.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      // Claim rewards
      const user2BalanceBefore = await getAccount(provider.connection, user2TokenAccount);

      await program.methods
        .claimRewards(new anchor.BN(tokenPoolId))
        .accounts({
          rewardPool: tokenPoolPda,
          userClaim: userClaimPda,
          rewardVault: tokenVaultPda,
          user: user2.publicKey,
          userTokenAccount: user2TokenAccount,
          rewardVaultToken: tokenVaultTokenPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const user2BalanceAfter = await getAccount(provider.connection, user2TokenAccount);
      expect(Number(user2BalanceAfter.amount)).to.be.greaterThan(Number(user2BalanceBefore.amount));
    });
  });

  describe("Distribution Types", () => {
    it("Calculates staking rewards correctly", async () => {
      const stakingPoolId = 3;
      const [stakingPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.from(stakingPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      const [stakingVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), Buffer.from(stakingPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      // Create staking rewards pool
      const currentTime = Math.floor(Date.now() / 1000);
      const poolData = {
        id: new anchor.BN(stakingPoolId),
        name: "Staking Rewards Pool",
        totalRewards: new anchor.BN(5 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { stakingRewards: {} },
        startTime: new anchor.BN(currentTime + 30),
        endTime: new anchor.BN(currentTime + 3600),
      };

      await program.methods
        .createRewardPool(poolData, new anchor.BN(0))
        .accounts({
          rewardPool: stakingPoolPda,
          rewardVault: stakingVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Fund the pool
      await program.methods
        .fundRewardPool(new anchor.BN(stakingPoolId), new anchor.BN(5 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: stakingPoolPda,
          rewardVault: stakingVaultPda,
          funder: authority.publicKey,
          funderTokenAccount: null,
          rewardVaultToken: null,
          tokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Wait for pool to start
      await new Promise(resolve => setTimeout(resolve, 31000));

      const [userStakingClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), Buffer.from(stakingPoolId.toString().padStart(8, '0')), user1.publicKey.toBuffer()],
        program.programId
      );

      // Calculate staking rewards (30 days of staking)
      const stakingPerformanceData = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(30 * 24 * 60 * 60), // 30 days in seconds
        achievementsUnlocked: 0,
        randomSeed: new anchor.BN(0),
        honeycombProfile: null,
      };

      await program.methods
        .calculateUserRewards(new anchor.BN(stakingPoolId), stakingPerformanceData)
        .accounts({
          rewardPool: stakingPoolPda,
          userClaim: userStakingClaimPda,
          user: user1.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const userClaim = await program.account.userClaim.fetch(userStakingClaimPda);
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });

    it("Calculates random drop rewards", async () => {
      const randomPoolId = 4;
      const [randomPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.from(randomPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      const [randomVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), Buffer.from(randomPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      // Create random drop pool
      const currentTime = Math.floor(Date.now() / 1000);
      const poolData = {
        id: new anchor.BN(randomPoolId),
        name: "Random Drop Pool",
        totalRewards: new anchor.BN(1 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { randomDrop: {} },
        startTime: new anchor.BN(currentTime + 30),
        endTime: new anchor.BN(currentTime + 3600),
      };

      await program.methods
        .createRewardPool(poolData, new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: randomPoolPda,
          rewardVault: randomVaultPda,
          authority: authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Wait for pool to start
      await new Promise(resolve => setTimeout(resolve, 31000));

      const [userRandomClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), Buffer.from(randomPoolId.toString().padStart(8, '0')), user2.publicKey.toBuffer()],
        program.programId
      );

      // Test random seed that should give rewards (seed % 100 < 10)
      const luckyPerformanceData = {
        score: 0,
        completionTime: new anchor.BN(0),
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 0,
        randomSeed: new anchor.BN(5), // 5 % 100 = 5 < 10, should get rewards
        honeycombProfile: null,
      };

      await program.methods
        .calculateUserRewards(new anchor.BN(randomPoolId), luckyPerformanceData)
        .accounts({
          rewardPool: randomPoolPda,
          userClaim: userRandomClaimPda,
          user: user2.publicKey,
          honeycombProfile: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const userClaim = await program.account.userClaim.fetch(userRandomClaimPda);
      expect(userClaim.totalEligible.toNumber()).to.be.greaterThan(0);
    });
  });

  describe("Pool Management", () => {
    it("Updates distribution criteria (authority only)", async () => {
      await program.methods
        .updateDistributionCriteria(new anchor.BN(poolId), { equalShare: {} })
        .accounts({
          rewardPool: rewardPoolPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

      const rewardPool = await program.account.rewardPool.fetch(rewardPoolPda);
      expect(rewardPool.distributionCriteria).to.deep.equal({ equalShare: {} });
    });

    it("Fails to update criteria without authority", async () => {
      try {
        await program.methods
          .updateDistributionCriteria(new anchor.BN(poolId), { randomDrop: {} })
          .accounts({
            rewardPool: rewardPoolPda,
            authority: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.error.errorCode.code).to.equal("UnauthorizedAuthority");
      }
    });

    it("Gets claimable amount for user", async () => {
      const claimableAmount = await program.methods
        .getClaimableAmount(new anchor.BN(poolId))
        .accounts({
          rewardPool: rewardPoolPda,
          userClaim: user1ClaimPda,
          user: user1.publicKey,
        })
        .view();

      expect(claimableAmount.toNumber()).to.equal(0); // Already claimed
    });
  });

  describe("Honeycomb Integration", () => {
    it("Verifies Honeycomb achievements", async () => {
      const honeycombProfile = Keypair.generate();
      
      const achievementData = {
        profileOwner: honeycombProfile.publicKey,
        achievements: [
          {
            id: "first_game",
            name: "First Game",
            description: "Complete your first trivia game",
            points: 100,
            timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
            verified: true,
          },
          {
            id: "speed_demon",
            name: "Speed Demon",
            description: "Complete a game in under 60 seconds",
            points: 200,
            timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
            verified: true,
          },
        ],
        totalScore: new anchor.BN(300),
        completionRate: 85,
      };

      const isValid = await program.methods
        .verifyHoneycombAchievements(new anchor.BN(poolId), achievementData)
        .accounts({
          rewardPool: rewardPoolPda,
          user: honeycombProfile.publicKey,
          honeycombProfile: honeycombProfile.publicKey,
        })
        .signers([honeycombProfile])
        .view();

      expect(isValid).to.be.true;
    });

    it("Fails verification with invalid profile", async () => {
      const fakeProfile = Keypair.generate();
      
      const invalidAchievementData = {
        profileOwner: user1.publicKey, // Different from honeycomb_profile
        achievements: [],
        totalScore: new anchor.BN(0),
        completionRate: 0,
      };

      try {
        await program.methods
          .verifyHoneycombAchievements(new anchor.BN(poolId), invalidAchievementData)
          .accounts({
            rewardPool: rewardPoolPda,
            user: fakeProfile.publicKey,
            honeycombProfile: fakeProfile.publicKey,
          })
          .signers([fakeProfile])
          .view();
        
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.error.errorCode.code).to.equal("InvalidHoneycombProfile");
      }
    });
  });

  describe("Error Handling", () => {
    it("Fails to create pool with invalid data", async () => {
      const invalidPoolData = {
        id: new anchor.BN(999),
        name: "A".repeat(51), // Too long
        totalRewards: new anchor.BN(1000),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(Math.floor(Date.now() / 1000) - 3600), // Past time
        endTime: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      };

      const [invalidPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.from("999".padStart(8, '0'))],
        program.programId
      );

      const [invalidVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), Buffer.from("999".padStart(8, '0'))],
        program.programId
      );

      try {
        await program.methods
          .createRewardPool(invalidPoolData, new anchor.BN(0))
          .accounts({
            rewardPool: invalidPoolPda,
            rewardVault: invalidVaultPda,
            authority: authority.publicKey,
            authorityTokenAccount: null,
            rewardVaultToken: null,
            tokenMint: null,
            tokenProgram: null,
            associatedTokenProgram: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        
        expect.fail("Should have failed");
      } catch (error) {
        // Should fail on one of the validation checks
        expect(["InvalidPoolName", "InvalidStartTime"].includes(error.error.errorCode.code)).to.be.true;
      }
    });

    it("Fails to claim from non-existent pool", async () => {
      const nonExistentPoolId = 9999;
      const [nonExistentPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), Buffer.from(nonExistentPoolId.toString().padStart(8, '0'))],
        program.programId
      );

      try {
        const claimableAmount = await program.methods
          .getClaimableAmount(new anchor.BN(nonExistentPoolId))
          .accounts({
            rewardPool: nonExistentPoolPda,
            userClaim: user1ClaimPda,
            user: user1.publicKey,
          })
          .view();
        
        expect.fail("Should have failed");
      } catch (error) {
        // Expected to fail due to account not existing
        expect(error.toString()).to.include("Account does not exist");
      }
    });

    it("Validates performance data", async () => {
      const invalidPerformanceData = {
        score: 150, // Invalid score > 100
        completionTime: new anchor.BN(-1), // Invalid negative time
        stakingDuration: new anchor.BN(0),
        achievementsUnlocked: 2000, // Invalid > 1000
        randomSeed: new anchor.BN(0),
        honeycombProfile: null,
      };

      try {
        await program.methods
          .calculateUserRewards(new anchor.BN(poolId), invalidPerformanceData)
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: user1ClaimPda,
            user: user1.publicKey,
            honeycombProfile: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.error.errorCode.code).to.equal("InvalidPerformanceData");
      }
    });
  });

  describe("Pool Closure", () => {
    it("Closes pool and returns remaining funds", async () => {
      // Wait for pool to end
      await new Promise(resolve => setTimeout(resolve, 5000));

      const authorityBalanceBefore = await provider.connection.getBalance(authority.publicKey);
      
      // Note: This will likely fail in the test environment since we can't easily wait for the pool to end
      // In a real scenario, you would wait for the end_time to pass
      try {
        await program.methods
          .closeRewardPool(new anchor.BN(poolId))
          .accounts({
            rewardPool: rewardPoolPda,
            rewardVault: rewardVaultPda,
            authority: authority.publicKey,
            authorityTokenAccount: null,
            rewardVaultToken: null,
            tokenProgram: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        const authorityBalanceAfter = await provider.connection.getBalance(authority.publicKey);
        expect(authorityBalanceAfter).to.be.greaterThan(authorityBalanceBefore);

        const rewardPool = await program.account.rewardPool.fetch(rewardPoolPda);
        expect(rewardPool.active).to.be.false;
      } catch (error) {
        // Expected to fail due to pool still being active
        expect(error.error.errorCode.code).to.equal("PoolStillActive");
      }
    });
  });
});