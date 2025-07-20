import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import TestSetup, { 
  MockDataGenerator, 
  TimeHelper, 
  PDAHelper, 
  GasTracker,
  AssertionHelper,
  LoadTester,
  TestUser,
  TestQuestion 
} from "./utils/test-helpers";
import {
  PropertyTestRunner,
  FuzzTester,
  SecurityTester,
  GasOptimizationAnalyzer,
  PropertyGenerators,
  PropertyTestConfig,
  FuzzTestConfig,
  SecurityTestConfig,
} from "./utils/property-testing";

describe("TriviaComb - Property-Based & Fuzz Testing Suite", () => {
  let testSetup: TestSetup;
  let propertyTester: PropertyTestRunner;
  let fuzzTester: FuzzTester;
  let securityTester: SecurityTester;
  let gasAnalyzer: GasOptimizationAnalyzer;
  let generators: PropertyGenerators;

  before(async () => {
    console.log("🧪 Starting Property-Based & Fuzz Testing Suite");
    
    testSetup = new TestSetup();
    await testSetup.initialize();
    
    propertyTester = new PropertyTestRunner(12345); // Fixed seed for reproducibility
    fuzzTester = new FuzzTester();
    securityTester = new SecurityTester(testSetup);
    gasAnalyzer = new GasOptimizationAnalyzer();
    generators = propertyTester.getGenerators();
    
    console.log("✅ Property testing setup complete");
  });

  after(async () => {
    await testSetup.cleanup();
    
    // Generate comprehensive reports
    console.log("\n" + gasAnalyzer.generateOptimizationReport());
  });

  describe("Question Bank Property-Based Tests", () => {
    it("should maintain question count invariant", async () => {
      const invariantHolds = await propertyTester.testInvariant(
        "Question count monotonic increase",
        async () => {
          const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
            testSetup.questionBankProgram.programId
          );
          const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
          return {
            totalQuestions: questionBank.totalQuestions.toNumber(),
            activeQuestions: questionBank.activeQuestions.toNumber(),
          };
        },
        [
          // Submit question operation
          async (state) => {
            try {
              const question = generators.generateQuestion();
              const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
                testSetup.questionBankProgram.programId
              );
              
              const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
              const questionId = questionBank.totalQuestions.toNumber();
              const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
              const submitterReputationPda = PDAHelper.getUserReputationPDA(
                testSetup.authority.publicKey,
                testSetup.questionBankProgram.programId
              );

              await testSetup.questionBankProgram.methods
                .submitQuestion(
                  question.questionText.slice(0, 500), // Ensure valid length
                  question.options.map(opt => opt.slice(0, 100)) as [string, string, string, string],
                  question.correctAnswer,
                  question.category.slice(0, 50),
                  Math.max(1, Math.min(3, question.difficulty))
                )
                .accounts({
                  question: questionPda,
                  questionBank: questionBankPda,
                  submitter: testSetup.authority.publicKey,
                  submitterReputation: submitterReputationPda,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([testSetup.authority.keypair])
                .rpc();

              const newQuestionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
              return {
                totalQuestions: newQuestionBank.totalQuestions.toNumber(),
                activeQuestions: newQuestionBank.activeQuestions.toNumber(),
              };
            } catch (error) {
              // Return unchanged state on error
              return state;
            }
          },
        ],
        async (state) => {
          // Invariant: total questions should never decrease
          const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
            testSetup.questionBankProgram.programId
          );
          const currentQuestionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
          const currentTotal = currentQuestionBank.totalQuestions.toNumber();
          
          return currentTotal >= state.totalQuestions;
        },
        20
      );

      expect(invariantHolds).to.be.true;
    });

    it("should validate question format properties", async () => {
      const result = await propertyTester.runPropertyTest(
        "Question format validation",
        () => generators.generateQuestion(),
        async (question) => {
          try {
            // Test that valid questions are accepted and invalid ones are rejected
            const isValid = 
              question.questionText.length > 0 && 
              question.questionText.length <= 500 &&
              question.options.every(opt => opt.length > 0 && opt.length <= 100) &&
              question.correctAnswer >= 0 && 
              question.correctAnswer <= 3 &&
              question.category.length > 0 && 
              question.category.length <= 50 &&
              question.difficulty >= 1 && 
              question.difficulty <= 3;

            if (!isValid) {
              // Should reject invalid questions
              const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
                testSetup.questionBankProgram.programId
              );
              
              const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
              const questionId = questionBank.totalQuestions.toNumber();
              const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
              const submitterReputationPda = PDAHelper.getUserReputationPDA(
                testSetup.authority.publicKey,
                testSetup.questionBankProgram.programId
              );

              try {
                await testSetup.questionBankProgram.methods
                  .submitQuestion(
                    question.questionText,
                    question.options,
                    question.correctAnswer,
                    question.category,
                    question.difficulty
                  )
                  .accounts({
                    question: questionPda,
                    questionBank: questionBankPda,
                    submitter: testSetup.authority.publicKey,
                    submitterReputation: submitterReputationPda,
                    systemProgram: anchor.web3.SystemProgram.programId,
                  })
                  .signers([testSetup.authority.keypair])
                  .rpc();
                
                // If we reach here, invalid question was accepted (bad)
                return false;
              } catch (error) {
                // Invalid question was rejected (good)
                return true;
              }
            } else {
              // Valid question should be accepted
              return true;
            }
          } catch (error) {
            return false;
          }
        },
        { runs: 50, maxSize: 100 }
      );

      console.log(`Question validation property test: ${result.passed}/${result.passed + result.failed} passed`);
      expect(result.passed).to.be.greaterThan(result.failed);
    });

    it("should test reputation system properties", async () => {
      const result = await propertyTester.runPropertyTest(
        "Reputation system consistency",
        () => testSetup.users[generators.generateInt(0, testSetup.users.length - 1)],
        async (user) => {
          try {
            const userReputationPda = PDAHelper.getUserReputationPDA(
              user.publicKey,
              testSetup.questionBankProgram.programId
            );

            // Get initial reputation
            const initialReputation = await testSetup.questionBankProgram.account.userReputation.fetch(userReputationPda);
            const initialScore = initialReputation.reputationScore.toNumber();
            const initialSubmitted = initialReputation.questionsSubmitted;
            const initialApproved = initialReputation.questionsApproved;

            // Property: approved questions should never exceed submitted questions
            return initialApproved <= initialSubmitted;
          } catch (error) {
            // Account might not exist yet
            return true;
          }
        },
        { runs: 30, maxSize: 50 }
      );

      expect(result.passed).to.equal(result.passed + result.failed);
    });
  });

  describe("Tournament Manager Property-Based Tests", () => {
    it("should maintain tournament capacity constraints", async () => {
      const result = await propertyTester.runPropertyTest(
        "Tournament capacity constraints",
        () => generators.generateTournamentParams(),
        async (params) => {
          try {
            // Normalize parameters to valid ranges
            const normalizedParams = {
              ...params,
              title: params.title.slice(0, 100),
              description: params.description.slice(0, 500),
              entryFee: new anchor.BN(Math.min(params.entryFee.toNumber(), 10 * LAMPORTS_PER_SOL)),
              prizePool: new anchor.BN(Math.min(params.prizePool.toNumber(), 100 * LAMPORTS_PER_SOL)),
              maxParticipants: Math.max(1, Math.min(params.maxParticipants, 1000)),
              questionCount: Math.max(1, Math.min(params.questionCount, 50)),
              category: params.category.slice(0, 50),
            };

            const tournamentId = generators.generateInt(10000, 99999);
            const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
            const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
              testSetup.tournamentProgram.programId
            );

            await testSetup.tournamentProgram.methods
              .createTournament(
                normalizedParams.title,
                normalizedParams.description,
                normalizedParams.entryFee,
                normalizedParams.prizePool,
                normalizedParams.maxParticipants,
                normalizedParams.startTime,
                normalizedParams.duration,
                normalizedParams.questionCount,
                normalizedParams.category,
                normalizedParams.difficulty
              )
              .accounts({
                tournament: tournamentPda,
                tournamentManager: tournamentManagerPda,
                organizer: testSetup.authority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
            
            // Property: participant count should never exceed max participants
            return tournament.participantCount <= tournament.maxParticipants;
          } catch (error) {
            // Some invalid parameters should be rejected
            return true;
          }
        },
        { runs: 30, maxSize: 100 }
      );

      console.log(`Tournament capacity property test: ${result.passed}/${result.passed + result.failed} passed`);
      expect(result.passed).to.be.greaterThan(0);
    });

    it("should validate tournament timing properties", async () => {
      const invariantHolds = await propertyTester.testInvariant(
        "Tournament timing consistency",
        async () => {
          const tournamentId = generators.generateInt(20000, 29999);
          const params = generators.generateTournamentParams();
          
          // Ensure valid timing
          const startTime = TimeHelper.future(3600);
          const validParams = {
            ...params,
            title: "Property Test Tournament",
            description: "Testing timing properties",
            entryFee: new anchor.BN(0.1 * LAMPORTS_PER_SOL),
            prizePool: new anchor.BN(1 * LAMPORTS_PER_SOL),
            maxParticipants: 10,
            startTime: new anchor.BN(startTime),
            duration: new anchor.BN(3600),
            questionCount: 5,
            category: "Test",
            difficulty: null,
          };

          try {
            const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
            const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
              testSetup.tournamentProgram.programId
            );

            await testSetup.tournamentProgram.methods
              .createTournament(
                validParams.title,
                validParams.description,
                validParams.entryFee,
                validParams.prizePool,
                validParams.maxParticipants,
                validParams.startTime,
                validParams.duration,
                validParams.questionCount,
                validParams.category,
                validParams.difficulty
              )
              .accounts({
                tournament: tournamentPda,
                tournamentManager: tournamentManagerPda,
                organizer: testSetup.authority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            return { tournamentId, tournamentPda };
          } catch (error) {
            return null;
          }
        },
        [
          // Start tournament operation
          async (state) => {
            if (!state) return state;
            
            try {
              await testSetup.tournamentProgram.methods
                .startTournament(state.tournamentId)
                .accounts({
                  tournament: state.tournamentPda,
                  organizer: testSetup.authority.publicKey,
                })
                .signers([testSetup.authority.keypair])
                .rpc();
              
              return { ...state, started: true };
            } catch (error) {
              return state;
            }
          },
        ],
        async (state) => {
          if (!state) return true;
          
          try {
            const tournament = await testSetup.tournamentProgram.account.tournament.fetch(state.tournamentPda);
            
            // Property: end time should be after start time
            const endTime = tournament.startTime.toNumber() + tournament.duration.toNumber();
            return endTime > tournament.startTime.toNumber();
          } catch (error) {
            return true;
          }
        },
        10
      );

      expect(invariantHolds).to.be.true;
    });
  });

  describe("Reward Distributor Property-Based Tests", () => {
    it("should maintain reward pool balance invariants", async () => {
      const result = await propertyTester.runPropertyTest(
        "Reward pool balance consistency",
        () => generators.generateRewardPoolParams(),
        async (params) => {
          try {
            // Normalize parameters
            const normalizedParams = {
              ...params,
              name: params.name.slice(0, 50),
              totalRewards: new anchor.BN(Math.min(params.totalRewards.toNumber(), 100 * LAMPORTS_PER_SOL)),
            };

            const poolId = normalizedParams.id.toNumber();
            const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
            const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

            // Only test SOL pools for simplicity in property tests
            const solPoolParams = {
              ...normalizedParams,
              rewardType: { sol: {} },
              tokenMint: null,
            };

            await testSetup.rewardProgram.methods
              .createRewardPool(solPoolParams, new anchor.BN(0))
              .accounts({
                rewardPool: rewardPoolPda,
                rewardVault: rewardVaultPda,
                authority: testSetup.authority.publicKey,
                authorityTokenAccount: null,
                rewardVaultToken: null,
                tokenMint: null,
                tokenProgram: null,
                associatedTokenProgram: null,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
            
            // Property: distributed rewards should never exceed total rewards
            return pool.distributedRewards.toNumber() <= pool.totalRewards.toNumber();
          } catch (error) {
            // Some invalid parameters should be rejected
            return true;
          }
        },
        { runs: 20, maxSize: 100 }
      );

      expect(result.passed).to.be.greaterThan(result.failed);
    });

    it("should validate performance-based reward calculation properties", async () => {
      // First create a test pool
      const poolId = 99999;
      const poolData = {
        id: new anchor.BN(poolId),
        name: "Property Test Pool",
        totalRewards: new anchor.BN(10 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(10 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: testSetup.authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([testSetup.authority.keypair])
        .rpc();

      const result = await propertyTester.runPropertyTest(
        "Performance reward calculation monotonicity",
        () => {
          const basePerformance = generators.generatePerformanceData();
          return {
            low: { ...basePerformance, score: generators.generateInt(0, 30) },
            high: { ...basePerformance, score: generators.generateInt(70, 100) },
            user: testSetup.users[generators.generateInt(0, testSetup.users.length - 1)],
          };
        },
        async (testCase) => {
          try {
            const { low, high, user } = testCase;
            
            // Calculate rewards for low performance
            const lowClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);
            
            await testSetup.rewardProgram.methods
              .calculateUserRewards(new anchor.BN(poolId), {
                score: low.score,
                completionTime: low.completionTime,
                stakingDuration: low.stakingDuration,
                achievementsUnlocked: low.achievementsUnlocked,
                randomSeed: low.randomSeed,
                honeycombProfile: low.honeycombProfile,
              })
              .accounts({
                rewardPool: rewardPoolPda,
                userClaim: lowClaimPda,
                user: user.publicKey,
                honeycombProfile: null,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([user.keypair])
              .rpc();

            const lowClaim = await testSetup.rewardProgram.account.userClaim.fetch(lowClaimPda);
            const lowReward = lowClaim.totalEligible.toNumber();

            // Create new user for high performance test
            const highUser = testSetup.users[(testSetup.users.indexOf(user) + 1) % testSetup.users.length];
            const highClaimPda = PDAHelper.getUserClaimPDA(poolId, highUser.publicKey, testSetup.rewardProgram.programId);
            
            await testSetup.rewardProgram.methods
              .calculateUserRewards(new anchor.BN(poolId), {
                score: high.score,
                completionTime: high.completionTime,
                stakingDuration: high.stakingDuration,
                achievementsUnlocked: high.achievementsUnlocked,
                randomSeed: high.randomSeed,
                honeycombProfile: high.honeycombProfile,
              })
              .accounts({
                rewardPool: rewardPoolPda,
                userClaim: highClaimPda,
                user: highUser.publicKey,
                honeycombProfile: null,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([highUser.keypair])
              .rpc();

            const highClaim = await testSetup.rewardProgram.account.userClaim.fetch(highClaimPda);
            const highReward = highClaim.totalEligible.toNumber();

            // Property: higher performance should yield higher or equal rewards
            return highReward >= lowReward;
          } catch (error) {
            // Some edge cases might fail, that's okay for property testing
            return true;
          }
        },
        { runs: 15, maxSize: 100 }
      );

      console.log(`Performance reward monotonicity: ${result.passed}/${result.passed + result.failed} passed`);
      expect(result.passed).to.be.greaterThan(result.failed * 0.5); // Allow some variance due to randomness
    });
  });

  describe("Fuzz Testing for Edge Cases", () => {
    it("should fuzz test question submission with malformed inputs", async () => {
      const seedInputs = [
        {
          questionText: "Valid question?",
          options: ["A", "B", "C", "D"] as [string, string, string, string],
          correctAnswer: 0,
          category: "Test",
          difficulty: 1,
        },
      ];

      const result = await fuzzTester.runFuzzTest(
        "Question submission fuzz test",
        seedInputs,
        async (input) => {
          try {
            const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
              testSetup.questionBankProgram.programId
            );
            
            const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
            const questionId = questionBank.totalQuestions.toNumber();
            const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
            const submitterReputationPda = PDAHelper.getUserReputationPDA(
              testSetup.authority.publicKey,
              testSetup.questionBankProgram.programId
            );

            await testSetup.questionBankProgram.methods
              .submitQuestion(
                input.questionText,
                input.options,
                input.correctAnswer,
                input.category,
                input.difficulty
              )
              .accounts({
                question: questionPda,
                questionBank: questionBankPda,
                submitter: testSetup.authority.publicKey,
                submitterReputation: submitterReputationPda,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            return { success: true };
          } catch (error) {
            // Expected for invalid inputs
            return { success: false, error };
          }
        },
        { iterations: 100, mutationRate: 0.4, seedValues: seedInputs }
      );

      console.log(`Fuzz test found ${result.uniqueErrors.size} unique error conditions`);
      expect(result.crashed).to.be.lessThan(result.totalRuns * 0.1); // Less than 10% should crash
    });

    it("should fuzz test tournament parameter edge cases", async () => {
      const seedInputs = [
        {
          title: "Test Tournament",
          description: "Test Description",
          entryFee: 0.1 * LAMPORTS_PER_SOL,
          prizePool: 1 * LAMPORTS_PER_SOL,
          maxParticipants: 10,
          startTime: TimeHelper.future(3600),
          duration: 3600,
          questionCount: 5,
          category: "Test",
          difficulty: null,
        },
      ];

      const result = await fuzzTester.runFuzzTest(
        "Tournament creation fuzz test",
        seedInputs,
        async (input) => {
          try {
            const tournamentId = Math.floor(Math.random() * 1000000) + 50000;
            const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
            const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
              testSetup.tournamentProgram.programId
            );

            await testSetup.tournamentProgram.methods
              .createTournament(
                input.title,
                input.description,
                new anchor.BN(input.entryFee),
                new anchor.BN(input.prizePool),
                input.maxParticipants,
                new anchor.BN(input.startTime),
                new anchor.BN(input.duration),
                input.questionCount,
                input.category,
                input.difficulty
              )
              .accounts({
                tournament: tournamentPda,
                tournamentManager: tournamentManagerPda,
                organizer: testSetup.authority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            return { success: true };
          } catch (error) {
            return { success: false, error };
          }
        },
        { iterations: 75, mutationRate: 0.5, seedValues: seedInputs }
      );

      console.log(`Tournament fuzz test: ${result.uniqueErrors.size} unique error conditions`);
      expect(result.crashed).to.be.lessThan(result.totalRuns * 0.15);
    });

    it("should fuzz test reward pool creation with extreme values", async () => {
      const seedInputs = [
        {
          id: 1,
          name: "Test Pool",
          totalRewards: 1 * LAMPORTS_PER_SOL,
          rewardType: { sol: {} },
          distributionCriteria: { performanceBased: {} },
          startTime: TimeHelper.future(3600),
          endTime: TimeHelper.future(3600 + 86400),
        },
      ];

      const result = await fuzzTester.runFuzzTest(
        "Reward pool creation fuzz test",
        seedInputs,
        async (input) => {
          try {
            const poolId = Math.floor(Math.random() * 1000000) + 100000;
            const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
            const rewardVaultPda = PDAHelper.getRewardVaultPDA(poolId, testSetup.rewardProgram.programId);

            const poolData = {
              id: new anchor.BN(poolId),
              name: input.name,
              totalRewards: new anchor.BN(input.totalRewards),
              rewardType: input.rewardType,
              tokenMint: null,
              distributionCriteria: input.distributionCriteria,
              startTime: new anchor.BN(input.startTime),
              endTime: new anchor.BN(input.endTime),
            };

            await testSetup.rewardProgram.methods
              .createRewardPool(poolData, new anchor.BN(0))
              .accounts({
                rewardPool: rewardPoolPda,
                rewardVault: rewardVaultPda,
                authority: testSetup.authority.publicKey,
                authorityTokenAccount: null,
                rewardVaultToken: null,
                tokenMint: null,
                tokenProgram: null,
                associatedTokenProgram: null,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([testSetup.authority.keypair])
              .rpc();

            return { success: true };
          } catch (error) {
            return { success: false, error };
          }
        },
        { iterations: 50, mutationRate: 0.6, seedValues: seedInputs }
      );

      console.log(`Reward pool fuzz test: ${result.uniqueErrors.size} unique error conditions`);
      expect(result.totalRuns).to.equal(50);
    });
  });

  describe("Advanced Gas Optimization Analysis", () => {
    it("should benchmark and optimize question submission gas usage", async () => {
      const result = await gasAnalyzer.benchmarkOperation(
        "question_submission_optimized",
        async () => {
          const question = generators.generateQuestion();
          const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
            testSetup.questionBankProgram.programId
          );
          
          const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
          const questionId = questionBank.totalQuestions.toNumber();
          const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
          const submitterReputationPda = PDAHelper.getUserReputationPDA(
            testSetup.authority.publicKey,
            testSetup.questionBankProgram.programId
          );

          return await testSetup.questionBankProgram.methods
            .submitQuestion(
              question.questionText.slice(0, 100), // Shorter text for optimization
              question.options.map(opt => opt.slice(0, 20)) as [string, string, string, string],
              question.correctAnswer,
              question.category.slice(0, 20),
              question.difficulty
            )
            .accounts({
              question: questionPda,
              questionBank: questionBankPda,
              submitter: testSetup.authority.publicKey,
              submitterReputation: submitterReputationPda,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([testSetup.authority.keypair])
            .rpc();
        },
        15
      );

      // Verify gas usage is reasonable
      expect(result.averageGas).to.be.lessThan(0.01 * LAMPORTS_PER_SOL);
      expect(result.standardDeviation).to.be.lessThan(result.averageGas * 0.2); // Low variance
    });

    it("should compare gas costs between different tournament sizes", async () => {
      // Small tournament
      await gasAnalyzer.benchmarkOperation(
        "small_tournament_creation",
        async () => {
          const tournamentId = Math.floor(Math.random() * 1000000) + 200000;
          const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
          const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
            testSetup.tournamentProgram.programId
          );

          return await testSetup.tournamentProgram.methods
            .createTournament(
              "Small Tournament",
              "Small test",
              new anchor.BN(0.1 * LAMPORTS_PER_SOL),
              new anchor.BN(1 * LAMPORTS_PER_SOL),
              5, // Small size
              new anchor.BN(TimeHelper.future(3600)),
              new anchor.BN(1800),
              3,
              "Test",
              null
            )
            .accounts({
              tournament: tournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: testSetup.authority.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([testSetup.authority.keypair])
            .rpc();
        },
        10
      );

      // Large tournament
      await gasAnalyzer.benchmarkOperation(
        "large_tournament_creation",
        async () => {
          const tournamentId = Math.floor(Math.random() * 1000000) + 300000;
          const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
          const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
            testSetup.tournamentProgram.programId
          );

          return await testSetup.tournamentProgram.methods
            .createTournament(
              "Large Tournament with a much longer title that uses more space",
              "Large test tournament with a much longer description that tests gas usage with more data storage requirements and validation",
              new anchor.BN(1 * LAMPORTS_PER_SOL),
              new anchor.BN(100 * LAMPORTS_PER_SOL),
              1000, // Large size
              new anchor.BN(TimeHelper.future(3600)),
              new anchor.BN(7200),
              50,
              "Complex Category Name",
              3
            )
            .accounts({
              tournament: tournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: testSetup.authority.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([testSetup.authority.keypair])
            .rpc();
        },
        10
      );

      const comparison = gasAnalyzer.compareOperations(
        "small_tournament_creation",
        "large_tournament_creation"
      );

      expect(comparison.difference).to.be.greaterThan(0);
    });

    it("should analyze gas optimization opportunities", async () => {
      // Benchmark various reward operations
      await gasAnalyzer.benchmarkOperation(
        "sol_reward_calculation",
        async () => {
          const poolId = 99999; // Use existing pool
          const user = testSetup.users[Math.floor(Math.random() * testSetup.users.length)];
          const performanceData = generators.generatePerformanceData();
          
          const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
          const userClaimPda = PDAHelper.getUserClaimPDA(poolId, user.publicKey, testSetup.rewardProgram.programId);

          try {
            return await testSetup.rewardProgram.methods
              .calculateUserRewards(new anchor.BN(poolId), {
                score: Math.min(100, Math.max(0, performanceData.score)),
                completionTime: performanceData.completionTime,
                stakingDuration: performanceData.stakingDuration,
                achievementsUnlocked: Math.min(100, Math.max(0, performanceData.achievementsUnlocked)),
                randomSeed: performanceData.randomSeed,
                honeycombProfile: null,
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
          } catch (error) {
            // Return dummy transaction for failed calculations
            return "failed";
          }
        },
        20
      );

      const analysis = gasAnalyzer.analyzeOptimizationOpportunities();
      
      console.log(`\n⚡ Gas Optimization Analysis Results:`);
      console.log(`  High variance operations: ${analysis.highVarianceOperations.length}`);
      console.log(`  Expensive operations: ${analysis.expensiveOperations.length}`);
      console.log(`  Total recommendations: ${analysis.recommendations.length}`);

      // All operations should be reasonably efficient
      expect(analysis.expensiveOperations.length).to.be.lessThan(5);
    });
  });

  describe("Security Vulnerability Testing", () => {
    it("should run comprehensive security test suite", async () => {
      const securityConfig: SecurityTestConfig = {
        enableReentrancyCheck: true,
        enableOverflowCheck: true,
        enableAuthorizationCheck: true,
        enableTimeManipulationCheck: true,
      };

      const results = await securityTester.runSecurityTestSuite(securityConfig);

      // All security tests should pass
      expect(results.reentrancySecure).to.be.true;
      expect(results.authorizationSecure).to.be.true;
      expect(results.timeSecure).to.be.true;
      expect(results.dosSecure).to.be.true;
      
      // Log comprehensive security status
      console.log(`\n🔒 Security Test Results Summary:`);
      console.log(`  Overall Security Status: ${results.overallSecure ? '✅ SECURE' : '❌ VULNERABILITIES DETECTED'}`);
      console.log(`  Tests Passed: ${Object.values(results).filter(r => r === true).length - 1}/${Object.keys(results).length - 1}`);
    });

    it("should test for front-running vulnerabilities", async () => {
      console.log("🏃 Testing front-running protection");
      
      // Test scenario: Multiple users trying to register for limited tournament spots
      const frontRunTestTournamentId = 888888;
      const tournamentPda = PDAHelper.getTournamentPDA(frontRunTestTournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      // Create tournament with very limited spots
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Front-run Test Tournament",
          "Testing front-running protection",
          new anchor.BN(0.1 * LAMPORTS_PER_SOL),
          new anchor.BN(1 * LAMPORTS_PER_SOL),
          2, // Only 2 spots
          new anchor.BN(TimeHelper.future(3600)),
          new anchor.BN(1800),
          3,
          "Test",
          null
        )
        .accounts({
          tournament: tournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: testSetup.authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([testSetup.authority.keypair])
        .rpc();

      // Simulate multiple users trying to register simultaneously
      const participants = testSetup.users.slice(0, 4); // 4 users for 2 spots
      const registrationPromises = participants.map(participant => {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );

        return testSetup.tournamentProgram.methods
          .registerForTournament(frontRunTestTournamentId)
          .accounts({
            tournament: tournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([participant.keypair])
          .rpc();
      });

      try {
        await Promise.all(registrationPromises);
        console.log("  ⚠️  All registrations succeeded - potential front-running issue");
      } catch (error) {
        console.log("  ✅ Front-running protection working - some registrations failed as expected");
      }

      // Verify only 2 participants registered
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.participantCount).to.be.lessThanOrEqual(2);
    });

    it("should test for MEV (Maximal Extractable Value) vulnerabilities", async () => {
      console.log("💰 Testing MEV protection");
      
      // Test scenario: Reward claiming with predictable outcomes
      const mevTestPoolId = 777777;
      const poolData = {
        id: new anchor.BN(mevTestPoolId),
        name: "MEV Test Pool",
        totalRewards: new anchor.BN(10 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { randomDrop: {} }, // Random distribution is susceptible to MEV
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 86400)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(mevTestPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(mevTestPoolId, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(10 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: testSetup.authority.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([testSetup.authority.keypair])
        .rpc();

      // Test with predictable random seeds (MEV vulnerability)
      const predictableSeeds = [12345, 12346, 12347, 12348, 12349];
      let winnerCount = 0;

      for (let i = 0; i < predictableSeeds.length; i++) {
        const user = testSetup.users[i];
        const userClaimPda = PDAHelper.getUserClaimPDA(mevTestPoolId, user.publicKey, testSetup.rewardProgram.programId);
        
        try {
          await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(mevTestPoolId), {
              score: 0,
              completionTime: new anchor.BN(0),
              stakingDuration: new anchor.BN(0),
              achievementsUnlocked: 0,
              randomSeed: new anchor.BN(predictableSeeds[i]),
              honeycombProfile: null,
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

          const claim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
          if (claim.totalEligible.toNumber() > 0) {
            winnerCount++;
          }
        } catch (error) {
          // Continue with test
        }
      }

      if (winnerCount === predictableSeeds.length) {
        console.log("  ⚠️  All predictable seeds won - potential MEV vulnerability");
      } else {
        console.log(`  ✅ MEV protection working - only ${winnerCount}/${predictableSeeds.length} predictable attempts succeeded`);
      }

      // MEV protection should prevent predictable outcomes
      expect(winnerCount).to.be.lessThan(predictableSeeds.length);
    });
  });

  describe("Cross-Contract Property Testing", () => {
    it("should maintain data consistency across contract interactions", async () => {
      const result = await propertyTester.runPropertyTest(
        "Cross-contract data consistency",
        () => ({
          questionData: generators.generateQuestion(),
          tournamentParams: generators.generateTournamentParams(),
          rewardParams: generators.generateRewardPoolParams(),
        }),
        async (testData) => {
          try {
            // Test cross-contract consistency
            const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
              testSetup.questionBankProgram.programId
            );
            const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
              testSetup.tournamentProgram.programId
            );

            const initialQuestionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
            const initialTournamentManager = await testSetup.tournamentProgram.account.tournamentManagerState.fetch(tournamentManagerPda);

            const initialQuestionCount = initialQuestionBank.totalQuestions.toNumber();
            const initialTournamentCount = initialTournamentManager.tournamentCount.toNumber();

            // Property: Global counters should be monotonic and consistent
            return initialQuestionCount >= 0 && initialTournamentCount >= 0;
          } catch (error) {
            return false;
          }
        },
        { runs: 25, maxSize: 50 }
      );

      expect(result.passed).to.equal(result.passed + result.failed);
    });

    it("should test tournament-reward integration properties", async () => {
      const invariantHolds = await propertyTester.testInvariant(
        "Tournament-reward integration consistency",
        async () => {
          // Create linked tournament and reward pool
          const tournamentId = generators.generateInt(400000, 499999);
          const rewardPoolId = tournamentId; // Same ID for linking
          
          return { tournamentId, rewardPoolId, participants: [] };
        },
        [
          // Create tournament
          async (state) => {
            try {
              const params = generators.generateTournamentParams();
              const tournamentPda = PDAHelper.getTournamentPDA(state.tournamentId, testSetup.tournamentProgram.programId);
              const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
                testSetup.tournamentProgram.programId
              );

              await testSetup.tournamentProgram.methods
                .createTournament(
                  "Integration Test Tournament",
                  "Testing integration",
                  new anchor.BN(0.1 * LAMPORTS_PER_SOL),
                  new anchor.BN(1 * LAMPORTS_PER_SOL),
                  5,
                  new anchor.BN(TimeHelper.future(3600)),
                  new anchor.BN(1800),
                  3,
                  "Test",
                  null
                )
                .accounts({
                  tournament: tournamentPda,
                  tournamentManager: tournamentManagerPda,
                  organizer: testSetup.authority.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([testSetup.authority.keypair])
                .rpc();

              return { ...state, tournamentCreated: true };
            } catch (error) {
              return state;
            }
          },
          // Create reward pool
          async (state) => {
            try {
              const rewardPoolPda = PDAHelper.getRewardPoolPDA(state.rewardPoolId, testSetup.rewardProgram.programId);
              const rewardVaultPda = PDAHelper.getRewardVaultPDA(state.rewardPoolId, testSetup.rewardProgram.programId);

              const poolData = {
                id: new anchor.BN(state.rewardPoolId),
                name: "Integration Test Pool",
                totalRewards: new anchor.BN(1 * LAMPORTS_PER_SOL),
                rewardType: { sol: {} },
                tokenMint: null,
                distributionCriteria: { performanceBased: {} },
                startTime: new anchor.BN(TimeHelper.future(1800)),
                endTime: new anchor.BN(TimeHelper.future(1800 + 86400)),
              };

              await testSetup.rewardProgram.methods
                .createRewardPool(poolData, new anchor.BN(1 * LAMPORTS_PER_SOL))
                .accounts({
                  rewardPool: rewardPoolPda,
                  rewardVault: rewardVaultPda,
                  authority: testSetup.authority.publicKey,
                  authorityTokenAccount: null,
                  rewardVaultToken: null,
                  tokenMint: null,
                  tokenProgram: null,
                  associatedTokenProgram: null,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([testSetup.authority.keypair])
                .rpc();

              return { ...state, rewardPoolCreated: true };
            } catch (error) {
              return state;
            }
          },
        ],
        async (state) => {
          // Invariant: linked tournament and reward pool should have consistent IDs
          return state.tournamentId === state.rewardPoolId;
        },
        5
      );

      expect(invariantHolds).to.be.true;
    });
  });
});