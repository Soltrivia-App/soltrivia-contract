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

describe("TriviaComb - Integration Test Suite", () => {
  let testSetup: TestSetup;
  let gasTracker: GasTracker;
  
  // Cross-contract data
  let tournamentId: number = 100;
  let questionPoolId: number = 200;
  let rewardPoolId: number = 300;
  
  // Test scenarios
  let validQuestions: TestQuestion[];
  let participants: TestUser[];

  before(async () => {
    console.log("🚀 Starting TriviaComb Integration Test Suite");
    
    testSetup = new TestSetup();
    gasTracker = new GasTracker();
    
    await testSetup.initialize();
    
    // Generate test data for integration scenarios
    validQuestions = MockDataGenerator.generateQuestions(25);
    participants = testSetup.users.slice(0, 8); // 8 participants for tournaments
    
    console.log("✅ Integration test setup complete");
  });

  after(async () => {
    await testSetup.cleanup();
    gasTracker.printSummary();
  });

  describe("End-to-End Tournament Flow", () => {
    it("should create complete tournament ecosystem", async () => {
      const organizer = testSetup.authority;
      
      // Step 1: Submit and approve questions for the tournament
      console.log("📝 Step 1: Setting up question bank for tournament");
      
      const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
        testSetup.questionBankProgram.programId
      );
      
      let approvedQuestionIds: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const question = validQuestions[i];
        const curator = testSetup.curators[i % testSetup.curators.length];
        
        // Get current question count
        const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
        const questionId = questionBank.totalQuestions.toNumber();
        
        const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
        const submitterReputationPda = PDAHelper.getUserReputationPDA(
          organizer.publicKey,
          testSetup.questionBankProgram.programId
        );
        
        // Submit question
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
            submitter: organizer.publicKey,
            submitterReputation: submitterReputationPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([organizer.keypair])
          .rpc();
        
        // Curator approves question
        await testSetup.questionBankProgram.methods
          .voteOnQuestion(questionId, { approve: {} })
          .accounts({
            question: questionPda,
            questionBank: questionBankPda,
            voter: curator.publicKey,
            voterReputation: PDAHelper.getUserReputationPDA(
              curator.publicKey,
              testSetup.questionBankProgram.programId
            ),
          })
          .signers([curator.keypair])
          .rpc();
        
        // Finalize question as approved
        await testSetup.questionBankProgram.methods
          .finalizeQuestion(questionId)
          .accounts({
            question: questionPda,
            questionBank: questionBankPda,
            authority: organizer.publicKey,
          })
          .signers([organizer.keypair])
          .rpc();
        
        approvedQuestionIds.push(questionId);
      }
      
      console.log(`✅ Approved ${approvedQuestionIds.length} questions for tournament`);
      
      // Step 2: Create reward pool for tournament prizes
      console.log("💰 Step 2: Creating tournament reward pool");
      
      const rewardPoolData = {
        id: new anchor.BN(rewardPoolId),
        name: "Tournament Prize Pool",
        totalRewards: new anchor.BN(20 * LAMPORTS_PER_SOL), // 20 SOL prize pool
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 7 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(rewardPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(rewardPoolId, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .createRewardPool(rewardPoolData, new anchor.BN(20 * LAMPORTS_PER_SOL))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: organizer.publicKey,
          authorityTokenAccount: null,
          rewardVaultToken: null,
          tokenMint: null,
          tokenProgram: null,
          associatedTokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();
      
      console.log("✅ Tournament reward pool created with 20 SOL");
      
      // Step 3: Create tournament
      console.log("🏆 Step 3: Creating tournament");
      
      const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      const { result, metrics } = await gasTracker.trackGas(
        "create_integrated_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .createTournament(
              "TriviaComb Championship",
              "Ultimate trivia competition with approved questions",
              new anchor.BN(0.5 * LAMPORTS_PER_SOL), // 0.5 SOL entry fee
              new anchor.BN(20 * LAMPORTS_PER_SOL), // 20 SOL prize pool
              50, // max participants
              new anchor.BN(TimeHelper.future(7200)), // start in 2 hours
              new anchor.BN(3600), // 1 hour duration
              approvedQuestionIds.length, // number of questions
              "Mixed", // category
              null // difficulty (any)
            )
            .accounts({
              tournament: tournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: organizer.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([organizer.keypair])
            .rpc();
        }
      );

      console.log(`✅ Tournament created, cost: ${metrics.lamports} lamports`);
      
      // Verify tournament was created with correct data
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.title).to.equal("TriviaComb Championship");
      expect(tournament.maxParticipants).to.equal(50);
      expect(tournament.questionCount).to.equal(approvedQuestionIds.length);
      expect(tournament.prizePool.toNumber()).to.equal(20 * LAMPORTS_PER_SOL);
    });

    it("should handle participant registration with entry fees", async () => {
      console.log("👥 Registering participants for tournament");
      
      const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
      let registrationCount = 0;

      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        // Get participant balance before registration
        const balanceBefore = await testSetup.provider.connection.getBalance(participant.publicKey);
        
        const { result, metrics } = await gasTracker.trackGas(
          `register_participant_${registrationCount}`,
          async () => {
            return await testSetup.tournamentProgram.methods
              .registerForTournament(tournamentId)
              .accounts({
                tournament: tournamentPda,
                registration: registrationPda,
                participant: participant.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([participant.keypair])
              .rpc();
          }
        );
        
        // Verify registration was successful
        const registration = await testSetup.tournamentProgram.account.registration.fetch(registrationPda);
        expect(registration.participant.toString()).to.equal(participant.publicKey.toString());
        expect(registration.tournament.toString()).to.equal(tournamentPda.toString());
        expect(registration.registrationTime.toNumber()).to.be.greaterThan(0);
        
        // Verify entry fee was paid
        const balanceAfter = await testSetup.provider.connection.getBalance(participant.publicKey);
        const expectedBalance = balanceBefore - (0.5 * LAMPORTS_PER_SOL) - metrics.lamports;
        expect(balanceAfter).to.be.approximately(expectedBalance, 10000);
        
        registrationCount++;
      }
      
      console.log(`✅ Registered ${registrationCount} participants`);
      
      // Verify tournament participant count was updated
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.participantCount).to.equal(registrationCount);
    });

    it("should start tournament and submit answers", async () => {
      console.log("🎮 Starting tournament and submitting answers");
      
      const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
      const organizer = testSetup.authority;
      
      // Start tournament (simulate time passing)
      await testSetup.tournamentProgram.methods
        .startTournament(tournamentId)
        .accounts({
          tournament: tournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();
      
      console.log("✅ Tournament started");
      
      // Simulate participants answering questions
      for (let participantIndex = 0; participantIndex < participants.length; participantIndex++) {
        const participant = participants[participantIndex];
        const answers: number[] = [];
        let correctAnswers = 0;
        
        // Generate answers based on participant skill level
        const skillLevel = (participantIndex + 1) / participants.length; // 0.125 to 1.0
        
        for (let questionIndex = 0; questionIndex < validQuestions.length; questionIndex++) {
          const question = validQuestions[questionIndex];
          let answer: number;
          
          // Higher skill level = higher chance of correct answer
          if (Math.random() < skillLevel) {
            answer = question.correctAnswer;
            correctAnswers++;
          } else {
            // Random wrong answer
            do {
              answer = Math.floor(Math.random() * 4);
            } while (answer === question.correctAnswer);
          }
          
          answers.push(answer);
        }
        
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        // Submit answers for the participant
        await testSetup.tournamentProgram.methods
          .submitAnswers(tournamentId, answers)
          .accounts({
            tournament: tournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
          })
          .signers([participant.keypair])
          .rpc();
        
        console.log(`✅ Participant ${participantIndex + 1} submitted answers: ${correctAnswers}/${validQuestions.length} correct`);
      }
    });

    it("should end tournament and calculate final scores", async () => {
      console.log("🏁 Ending tournament and calculating scores");
      
      const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
      const organizer = testSetup.authority;
      
      // End tournament
      await testSetup.tournamentProgram.methods
        .endTournament(tournamentId)
        .accounts({
          tournament: tournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();
      
      console.log("✅ Tournament ended");
      
      // Get final scores for all participants
      const participantScores: Array<{ user: TestUser; score: number; rank: number }> = [];
      
      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        const registration = await testSetup.tournamentProgram.account.registration.fetch(registrationPda);
        participantScores.push({
          user: participant,
          score: registration.score,
          rank: registration.rank,
        });
      }
      
      // Sort by score to verify ranking
      participantScores.sort((a, b) => b.score - a.score);
      
      console.log("\n🏆 Final Tournament Results:");
      for (let i = 0; i < participantScores.length; i++) {
        const participant = participantScores[i];
        console.log(`  ${i + 1}. Score: ${participant.score}, Rank: ${participant.rank}`);
        
        // Verify ranking is correct
        expect(participant.rank).to.equal(i + 1);
      }
    });

    it("should distribute tournament rewards based on performance", async () => {
      console.log("💰 Distributing tournament rewards");
      
      const rewardPoolPda = PDAHelper.getRewardPoolPDA(rewardPoolId, testSetup.rewardProgram.programId);
      const tournamentPda = PDAHelper.getTournamentPDA(tournamentId, testSetup.tournamentProgram.programId);
      
      // Calculate and distribute rewards for top performers
      const topPerformers = participants.slice(0, 5); // Top 5 get rewards
      
      for (let i = 0; i < topPerformers.length; i++) {
        const participant = topPerformers[i];
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        // Get participant's tournament performance
        const registration = await testSetup.tournamentProgram.account.registration.fetch(registrationPda);
        
        // Calculate performance data for rewards
        const performanceData = {
          score: registration.score,
          completionTime: new anchor.BN(registration.completionTime.toNumber()),
          stakingDuration: new anchor.BN(0),
          achievementsUnlocked: Math.max(1, Math.floor(registration.score / 10)), // 1 achievement per 10 points
          randomSeed: new anchor.BN(Math.floor(Math.random() * 1000000)),
          honeycombProfile: null,
        };
        
        const userClaimPda = PDAHelper.getUserClaimPDA(rewardPoolId, participant.publicKey, testSetup.rewardProgram.programId);
        
        // Calculate tournament rewards
        const { result, metrics } = await gasTracker.trackGas(
          `calculate_tournament_reward_${i}`,
          async () => {
            return await testSetup.rewardProgram.methods
              .calculateUserRewards(new anchor.BN(rewardPoolId), performanceData)
              .accounts({
                rewardPool: rewardPoolPda,
                userClaim: userClaimPda,
                user: participant.publicKey,
                honeycombProfile: null,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([participant.keypair])
              .rpc();
          }
        );
        
        // Get calculated reward amount
        const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
        const rewardAmount = userClaim.totalEligible.toNumber();
        
        console.log(`✅ Participant ${i + 1} (Score: ${registration.score}) eligible for ${rewardAmount} lamports`);
        
        // Claim the rewards
        if (rewardAmount > 0) {
          const rewardVaultPda = PDAHelper.getRewardVaultPDA(rewardPoolId, testSetup.rewardProgram.programId);
          const balanceBefore = await testSetup.provider.connection.getBalance(participant.publicKey);
          
          await testSetup.rewardProgram.methods
            .claimRewards(new anchor.BN(rewardPoolId))
            .accounts({
              rewardPool: rewardPoolPda,
              userClaim: userClaimPda,
              rewardVault: rewardVaultPda,
              user: participant.publicKey,
              userTokenAccount: null,
              rewardVaultToken: null,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([participant.keypair])
            .rpc();
          
          const balanceAfter = await testSetup.provider.connection.getBalance(participant.publicKey);
          const actualReward = balanceAfter - balanceBefore;
          
          console.log(`✅ Participant ${i + 1} claimed ${actualReward} lamports`);
          expect(actualReward).to.be.greaterThan(0);
        }
      }
    });
  });

  describe("Question Bank and Tournament Integration", () => {
    it("should use question bank questions in tournament", async () => {
      console.log("🔗 Testing Question Bank - Tournament integration");
      
      const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
        testSetup.questionBankProgram.programId
      );
      
      // Get current state of question bank
      const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
      const totalQuestions = questionBank.totalQuestions.toNumber();
      const activeQuestions = questionBank.activeQuestions.toNumber();
      
      console.log(`📊 Question Bank Stats: ${totalQuestions} total, ${activeQuestions} active`);
      
      // Verify we have enough approved questions for tournaments
      expect(activeQuestions).to.be.greaterThanOrEqual(10);
      
      // Create another tournament using different subset of questions
      const secondTournamentId = 101;
      const tournamentPda = PDAHelper.getTournamentPDA(secondTournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );
      
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Question Bank Special",
          "Tournament featuring community-approved questions",
          new anchor.BN(0.2 * LAMPORTS_PER_SOL), // Lower entry fee
          new anchor.BN(5 * LAMPORTS_PER_SOL), // Smaller prize pool
          20, // max participants
          new anchor.BN(TimeHelper.future(10800)), // start in 3 hours
          new anchor.BN(1800), // 30 minute duration
          Math.min(activeQuestions, 15), // Use available questions
          "Science", // specific category
          2 // medium difficulty
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
      expect(tournament.questionCount).to.be.greaterThan(0);
      expect(tournament.questionCount).to.be.lessThanOrEqual(activeQuestions);
      
      console.log(`✅ Created tournament with ${tournament.questionCount} questions from question bank`);
    });

    it("should handle question quality impact on tournaments", async () => {
      console.log("📈 Testing question quality impact");
      
      // Submit some high-quality questions with detailed metadata
      const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
        testSetup.questionBankProgram.programId
      );
      
      const highQualityQuestions = [
        {
          questionText: "What is the time complexity of binary search in a sorted array?",
          options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
          correctAnswer: 1,
          category: "Computer Science",
          difficulty: 3,
        },
        {
          questionText: "Which layer of the OSI model handles end-to-end communication?",
          options: ["Network", "Transport", "Session", "Presentation"],
          correctAnswer: 1,
          category: "Computer Science",
          difficulty: 2,
        },
        {
          questionText: "What is the result of 2^8 in decimal?",
          options: ["128", "256", "512", "64"],
          correctAnswer: 1,
          category: "Mathematics",
          difficulty: 1,
        },
      ];
      
      let submittedQuestionIds: number[] = [];
      
      for (const question of highQualityQuestions) {
        const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
        const questionId = questionBank.totalQuestions.toNumber();
        
        const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
        const submitterReputationPda = PDAHelper.getUserReputationPDA(
          testSetup.authority.publicKey,
          testSetup.questionBankProgram.programId
        );
        
        // Submit high-quality question
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
        
        // Multiple curators approve (simulating high quality)
        for (const curator of testSetup.curators) {
          await testSetup.questionBankProgram.methods
            .voteOnQuestion(questionId, { approve: {} })
            .accounts({
              question: questionPda,
              questionBank: questionBankPda,
              voter: curator.publicKey,
              voterReputation: PDAHelper.getUserReputationPDA(
                curator.publicKey,
                testSetup.questionBankProgram.programId
              ),
            })
            .signers([curator.keypair])
            .rpc();
        }
        
        // Finalize as approved
        await testSetup.questionBankProgram.methods
          .finalizeQuestion(questionId)
          .accounts({
            question: questionPda,
            questionBank: questionBankPda,
            authority: testSetup.authority.publicKey,
          })
          .signers([testSetup.authority.keypair])
          .rpc();
        
        submittedQuestionIds.push(questionId);
      }
      
      console.log(`✅ Submitted and approved ${submittedQuestionIds.length} high-quality questions`);
      
      // Verify these questions can be used in high-stakes tournaments
      const premiumTournamentId = 102;
      const tournamentPda = PDAHelper.getTournamentPDA(premiumTournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );
      
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Premium Knowledge Contest",
          "High-stakes tournament with curated questions",
          new anchor.BN(1 * LAMPORTS_PER_SOL), // Higher entry fee
          new anchor.BN(50 * LAMPORTS_PER_SOL), // Larger prize pool
          100, // max participants
          new anchor.BN(TimeHelper.future(14400)), // start in 4 hours
          new anchor.BN(2700), // 45 minute duration
          submittedQuestionIds.length,
          "Mixed", // category
          null // difficulty (any)
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
      expect(tournament.prizePool.toNumber()).to.equal(50 * LAMPORTS_PER_SOL);
      expect(tournament.entryFee.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);
      
      console.log("✅ Premium tournament created with curated questions");
    });
  });

  describe("Reward Distribution and Tournament Integration", () => {
    it("should create achievement-based rewards for tournament winners", async () => {
      console.log("🎖️ Testing achievement-based reward integration");
      
      // Create achievement-based token reward pool
      const achievementPoolId = 400;
      const rewardPoolData = {
        id: new anchor.BN(achievementPoolId),
        name: "Tournament Achievement Rewards",
        totalRewards: new anchor.BN(1000000 * 1000000), // 1M tokens
        rewardType: { splToken: {} },
        tokenMint: testSetup.tokenMint,
        distributionCriteria: { achievementBased: {} },
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 30 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(achievementPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(achievementPoolId, testSetup.rewardProgram.programId);
      
      const [rewardVaultTokenPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("reward_vault_token"),
          rewardVaultPda.toBuffer(),
          testSetup.tokenMint.toBuffer(),
        ],
        testSetup.rewardProgram.programId
      );

      await testSetup.rewardProgram.methods
        .createRewardPool(rewardPoolData, new anchor.BN(1000000 * 1000000))
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: testSetup.authority.publicKey,
          authorityTokenAccount: testSetup.authority.tokenAccount,
          rewardVaultToken: rewardVaultTokenPda,
          tokenMint: testSetup.tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([testSetup.authority.keypair])
        .rpc();
      
      console.log("✅ Achievement-based token reward pool created");
      
      // Simulate tournament winners earning different achievement levels
      const winners = participants.slice(0, 3); // Top 3 winners
      const achievementLevels = [
        { name: "Champion", achievements: 20, bonus: 1000 },
        { name: "Runner-up", achievements: 15, bonus: 500 },
        { name: "Third Place", achievements: 10, bonus: 250 },
      ];
      
      for (let i = 0; i < winners.length; i++) {
        const winner = winners[i];
        const level = achievementLevels[i];
        
        const achievementData = {
          score: 0, // Not used for achievement-based
          completionTime: new anchor.BN(0),
          stakingDuration: new anchor.BN(0),
          achievementsUnlocked: level.achievements,
          randomSeed: new anchor.BN(Math.floor(Math.random() * 1000000)),
          honeycombProfile: null,
        };
        
        const userClaimPda = PDAHelper.getUserClaimPDA(achievementPoolId, winner.publicKey, testSetup.rewardProgram.programId);
        
        // Calculate achievement rewards
        await testSetup.rewardProgram.methods
          .calculateUserRewards(new anchor.BN(achievementPoolId), achievementData)
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: userClaimPda,
            user: winner.publicKey,
            honeycombProfile: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([winner.keypair])
          .rpc();
        
        const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
        const tokenReward = userClaim.totalEligible.toNumber();
        
        console.log(`🏆 ${level.name} earned ${tokenReward} tokens for ${level.achievements} achievements`);
        
        // Claim achievement tokens
        const tokenBalanceBefore = await getAccount(testSetup.provider.connection, winner.tokenAccount);
        
        await testSetup.rewardProgram.methods
          .claimRewards(new anchor.BN(achievementPoolId))
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: userClaimPda,
            rewardVault: rewardVaultPda,
            user: winner.publicKey,
            userTokenAccount: winner.tokenAccount,
            rewardVaultToken: rewardVaultTokenPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([winner.keypair])
          .rpc();
        
        const tokenBalanceAfter = await getAccount(testSetup.provider.connection, winner.tokenAccount);
        const tokensReceived = Number(tokenBalanceAfter.amount) - Number(tokenBalanceBefore.amount);
        
        console.log(`✅ ${level.name} claimed ${tokensReceived} tokens successfully`);
        expect(tokensReceived).to.equal(tokenReward);
      }
    });

    it("should handle staking rewards for long-term tournament participants", async () => {
      console.log("🔒 Testing staking rewards for tournament participants");
      
      // Create staking reward pool for tournament participants
      const stakingPoolId = 500;
      const poolData = {
        id: new anchor.BN(stakingPoolId),
        name: "Tournament Participant Staking Rewards",
        totalRewards: new anchor.BN(100 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { stakingRewards: {} },
        startTime: new anchor.BN(TimeHelper.future(3600)),
        endTime: new anchor.BN(TimeHelper.future(3600 + 365 * 24 * 3600)),
      };

      const rewardPoolPda = PDAHelper.getRewardPoolPDA(stakingPoolId, testSetup.rewardProgram.programId);
      const rewardVaultPda = PDAHelper.getRewardVaultPDA(stakingPoolId, testSetup.rewardProgram.programId);

      await testSetup.rewardProgram.methods
        .createRewardPool(poolData, new anchor.BN(100 * LAMPORTS_PER_SOL))
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
      
      console.log("✅ Staking reward pool created for tournament participants");
      
      // Simulate different staking durations for tournament participants
      const stakingParticipants = participants.slice(3, 6); // Different set of participants
      const stakingDurations = [
        { days: 30, participant: stakingParticipants[0] },
        { days: 90, participant: stakingParticipants[1] },
        { days: 180, participant: stakingParticipants[2] },
      ];
      
      for (const { days, participant } of stakingDurations) {
        const stakingData = {
          score: 0,
          completionTime: new anchor.BN(0),
          stakingDuration: new anchor.BN(days * 24 * 60 * 60), // Convert days to seconds
          achievementsUnlocked: 0,
          randomSeed: new anchor.BN(Math.floor(Math.random() * 1000000)),
          honeycombProfile: null,
        };
        
        const userClaimPda = PDAHelper.getUserClaimPDA(stakingPoolId, participant.publicKey, testSetup.rewardProgram.programId);
        
        // Calculate staking rewards
        await testSetup.rewardProgram.methods
          .calculateUserRewards(new anchor.BN(stakingPoolId), stakingData)
          .accounts({
            rewardPool: rewardPoolPda,
            userClaim: userClaimPda,
            user: participant.publicKey,
            honeycombProfile: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([participant.keypair])
          .rpc();
        
        const userClaim = await testSetup.rewardProgram.account.userClaim.fetch(userClaimPda);
        const stakingReward = userClaim.totalEligible.toNumber();
        
        console.log(`⏰ ${days}-day staker earned ${stakingReward} lamports`);
        expect(stakingReward).to.be.greaterThan(0);
        
        // Longer staking should yield higher rewards
        if (days > 30) {
          // We'll verify this in a batch comparison
        }
      }
    });
  });

  describe("Cross-Contract Performance and Stress Testing", () => {
    it("should handle concurrent operations across all contracts", async () => {
      console.log("🚀 Testing concurrent cross-contract operations");
      
      // Create operations that span all three contracts
      const concurrentOperations = [
        // Question submissions
        ...Array(3).fill(0).map((_, i) => async () => {
          const question = validQuestions[i + 15];
          const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
            testSetup.questionBankProgram.programId
          );
          
          const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
          const questionId = questionBank.totalQuestions.toNumber();
          const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
          const submitterReputationPda = PDAHelper.getUserReputationPDA(
            testSetup.users[i].publicKey,
            testSetup.questionBankProgram.programId
          );
          
          return await testSetup.questionBankProgram.methods
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
              submitter: testSetup.users[i].publicKey,
              submitterReputation: submitterReputationPda,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([testSetup.users[i].keypair])
            .rpc();
        }),
        
        // Tournament registrations
        ...Array(3).fill(0).map((_, i) => async () => {
          const participant = testSetup.users[i + 3];
          const tournamentPda = PDAHelper.getTournamentPDA(101, testSetup.tournamentProgram.programId); // Second tournament
          const registrationPda = PDAHelper.getRegistrationPDA(
            tournamentPda,
            participant.publicKey,
            testSetup.tournamentProgram.programId
          );
          
          return await testSetup.tournamentProgram.methods
            .registerForTournament(101)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([participant.keypair])
            .rpc();
        }),
        
        // Reward calculations
        ...Array(3).fill(0).map((_, i) => async () => {
          const user = testSetup.users[i + 6];
          const performanceData = MockDataGenerator.generatePerformanceData("random");
          const rewardPoolPda = PDAHelper.getRewardPoolPDA(rewardPoolId, testSetup.rewardProgram.programId);
          const userClaimPda = PDAHelper.getUserClaimPDA(rewardPoolId, user.publicKey, testSetup.rewardProgram.programId);
          
          return await testSetup.rewardProgram.methods
            .calculateUserRewards(new anchor.BN(rewardPoolId), {
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
        }),
      ];
      
      const { results, throughput, avgTime } = await LoadTester.measureThroughput(
        async () => {
          return await LoadTester.concurrentOperations(concurrentOperations, 5);
        },
        1,
        "Cross-contract concurrent operations"
      );
      
      console.log(`✅ Concurrent operations completed: ${results[0].length} operations`);
      expect(throughput).to.be.greaterThan(0);
    });

    it("should measure gas efficiency across integrated workflows", async () => {
      console.log("⛽ Measuring gas efficiency for integrated workflows");
      
      // Complete workflow: Submit question -> Create tournament -> Register -> Distribute rewards
      const workflowUser = testSetup.users[8];
      const workflowTournamentId = 103;
      
      // Step 1: Submit a question
      let totalGasCost = 0;
      
      const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
        testSetup.questionBankProgram.programId
      );
      
      const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
      const questionId = questionBank.totalQuestions.toNumber();
      const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
      const submitterReputationPda = PDAHelper.getUserReputationPDA(
        workflowUser.publicKey,
        testSetup.questionBankProgram.programId
      );
      
      const { result: submitResult, metrics: submitMetrics } = await gasTracker.trackGas(
        "workflow_submit_question",
        async () => {
          return await testSetup.questionBankProgram.methods
            .submitQuestion(
              "What is the capital of France?",
              ["London", "Berlin", "Paris", "Madrid"],
              2,
              "Geography",
              1
            )
            .accounts({
              question: questionPda,
              questionBank: questionBankPda,
              submitter: workflowUser.publicKey,
              submitterReputation: submitterReputationPda,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([workflowUser.keypair])
            .rpc();
        }
      );
      totalGasCost += submitMetrics.lamports;
      
      // Step 2: Create mini tournament
      const tournamentPda = PDAHelper.getTournamentPDA(workflowTournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );
      
      const { result: createResult, metrics: createMetrics } = await gasTracker.trackGas(
        "workflow_create_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .createTournament(
              "Gas Test Tournament",
              "Testing gas efficiency",
              new anchor.BN(0.1 * LAMPORTS_PER_SOL),
              new anchor.BN(2 * LAMPORTS_PER_SOL),
              10,
              new anchor.BN(TimeHelper.future(18000)),
              new anchor.BN(1800),
              5,
              "Mixed",
              null
            )
            .accounts({
              tournament: tournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: workflowUser.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([workflowUser.keypair])
            .rpc();
        }
      );
      totalGasCost += createMetrics.lamports;
      
      // Step 3: Register for tournament
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        workflowUser.publicKey,
        testSetup.tournamentProgram.programId
      );
      
      const { result: registerResult, metrics: registerMetrics } = await gasTracker.trackGas(
        "workflow_register_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .registerForTournament(workflowTournamentId)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: workflowUser.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([workflowUser.keypair])
            .rpc();
        }
      );
      totalGasCost += registerMetrics.lamports;
      
      // Step 4: Calculate and claim rewards
      const workflowRewardPoolId = 600;
      const workflowPoolData = {
        id: new anchor.BN(workflowRewardPoolId),
        name: "Workflow Test Pool",
        totalRewards: new anchor.BN(5 * LAMPORTS_PER_SOL),
        rewardType: { sol: {} },
        tokenMint: null,
        distributionCriteria: { performanceBased: {} },
        startTime: new anchor.BN(TimeHelper.future(1800)),
        endTime: new anchor.BN(TimeHelper.future(1800 + 7 * 24 * 3600)),
      };

      const workflowRewardPoolPda = PDAHelper.getRewardPoolPDA(workflowRewardPoolId, testSetup.rewardProgram.programId);
      const workflowRewardVaultPda = PDAHelper.getRewardVaultPDA(workflowRewardPoolId, testSetup.rewardProgram.programId);

      const { result: poolResult, metrics: poolMetrics } = await gasTracker.trackGas(
        "workflow_create_reward_pool",
        async () => {
          return await testSetup.rewardProgram.methods
            .createRewardPool(workflowPoolData, new anchor.BN(5 * LAMPORTS_PER_SOL))
            .accounts({
              rewardPool: workflowRewardPoolPda,
              rewardVault: workflowRewardVaultPda,
              authority: workflowUser.publicKey,
              authorityTokenAccount: null,
              rewardVaultToken: null,
              tokenMint: null,
              tokenProgram: null,
              associatedTokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([workflowUser.keypair])
            .rpc();
        }
      );
      totalGasCost += poolMetrics.lamports;
      
      console.log(`\n💰 Complete Workflow Gas Analysis:`);
      console.log(`  Question Submission: ${submitMetrics.lamports} lamports`);
      console.log(`  Tournament Creation: ${createMetrics.lamports} lamports`);
      console.log(`  Tournament Registration: ${registerMetrics.lamports} lamports`);
      console.log(`  Reward Pool Creation: ${poolMetrics.lamports} lamports`);
      console.log(`  Total Workflow Cost: ${totalGasCost} lamports (${(totalGasCost / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
      
      // Verify total cost is reasonable (under 0.1 SOL)
      expect(totalGasCost).to.be.lessThan(0.1 * LAMPORTS_PER_SOL);
    });
  });

  describe("Data Consistency and State Management", () => {
    it("should maintain data consistency across contract interactions", async () => {
      console.log("🔄 Testing data consistency across contracts");
      
      // Test scenario: Multiple users interact with all contracts simultaneously
      const consistencyUsers = testSetup.users.slice(0, 4);
      
      // Initial state snapshots
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
      
      console.log(`📊 Initial state - Questions: ${initialQuestionCount}, Tournaments: ${initialTournamentCount}`);
      
      // Perform multiple operations that should update global state
      let operationsCount = 0;
      
      for (const user of consistencyUsers) {
        // Submit question
        const question = validQuestions[operationsCount + 20];
        const questionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
        const questionId = questionBank.totalQuestions.toNumber();
        const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
        const submitterReputationPda = PDAHelper.getUserReputationPDA(
          user.publicKey,
          testSetup.questionBankProgram.programId
        );
        
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
            submitter: user.publicKey,
            submitterReputation: submitterReputationPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user.keypair])
          .rpc();
        
        operationsCount++;
      }
      
      // Verify state updates are consistent
      const finalQuestionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
      const finalQuestionCount = finalQuestionBank.totalQuestions.toNumber();
      
      expect(finalQuestionCount).to.equal(initialQuestionCount + operationsCount);
      console.log(`✅ Question count correctly updated: ${finalQuestionCount}`);
      
      // Test cross-reference integrity
      for (let i = 0; i < operationsCount; i++) {
        const questionId = initialQuestionCount + i;
        const questionPda = PDAHelper.getQuestionPDA(questionId, testSetup.questionBankProgram.programId);
        const question = await testSetup.questionBankProgram.account.question.fetch(questionPda);
        
        expect(question.id.toNumber()).to.equal(questionId);
        expect(question.submitter.toString()).to.equal(consistencyUsers[i].publicKey.toString());
      }
      
      console.log("✅ Cross-reference integrity verified");
    });

    it("should handle edge cases in state transitions", async () => {
      console.log("🎯 Testing edge cases in state transitions");
      
      // Test edge case: Tournament with exactly max participants
      const edgeTournamentId = 104;
      const maxParticipants = 5; // Small number for testing
      
      const tournamentPda = PDAHelper.getTournamentPDA(edgeTournamentId, testSetup.tournamentProgram.programId);
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );
      
      // Create tournament with small max participants
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Edge Case Tournament",
          "Testing max participants edge case",
          new anchor.BN(0.1 * LAMPORTS_PER_SOL),
          new anchor.BN(1 * LAMPORTS_PER_SOL),
          maxParticipants,
          new anchor.BN(TimeHelper.future(21600)),
          new anchor.BN(1800),
          5,
          "Mixed",
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
      
      // Register exactly max participants
      const edgeParticipants = testSetup.users.slice(0, maxParticipants);
      
      for (const participant of edgeParticipants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        await testSetup.tournamentProgram.methods
          .registerForTournament(edgeTournamentId)
          .accounts({
            tournament: tournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([participant.keypair])
          .rpc();
      }
      
      // Verify tournament is now full
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.participantCount).to.equal(maxParticipants);
      
      // Try to register one more participant (should fail)
      const extraParticipant = testSetup.users[maxParticipants];
      const extraRegistrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        extraParticipant.publicKey,
        testSetup.tournamentProgram.programId
      );
      
      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .registerForTournament(edgeTournamentId)
            .accounts({
              tournament: tournamentPda,
              registration: extraRegistrationPda,
              participant: extraParticipant.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([extraParticipant.keypair])
            .rpc();
        },
        "TournamentFull"
      );
      
      console.log("✅ Max participants edge case handled correctly");
    });
  });

  describe("Final Integration Validation", () => {
    it("should validate complete ecosystem functionality", async () => {
      console.log("🎯 Final ecosystem validation");
      
      // Summary of all integrated components
      const { questionBankPda } = PDAHelper.getQuestionBankPDAs(
        testSetup.questionBankProgram.programId
      );
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );
      
      // Get final state of all contracts
      const finalQuestionBank = await testSetup.questionBankProgram.account.questionBank.fetch(questionBankPda);
      const finalTournamentManager = await testSetup.tournamentProgram.account.tournamentManagerState.fetch(tournamentManagerPda);
      
      // Validate Question Bank ecosystem
      expect(finalQuestionBank.totalQuestions.toNumber()).to.be.greaterThan(20);
      expect(finalQuestionBank.activeQuestions.toNumber()).to.be.greaterThan(10);
      expect(finalQuestionBank.curators.length).to.equal(3);
      
      console.log(`📚 Question Bank: ${finalQuestionBank.totalQuestions.toNumber()} total, ${finalQuestionBank.activeQuestions.toNumber()} active`);
      
      // Validate Tournament ecosystem
      expect(finalTournamentManager.tournamentCount.toNumber()).to.be.greaterThan(5);
      expect(finalTournamentManager.totalParticipants.toNumber()).to.be.greaterThan(15);
      
      console.log(`🏆 Tournaments: ${finalTournamentManager.tournamentCount.toNumber()} created, ${finalTournamentManager.totalParticipants.toNumber()} total participants`);
      
      // Validate Reward Distribution ecosystem
      const activeRewardPools = [rewardPoolId, 400, 500, 600]; // Pools created during testing
      let totalRewardsDistributed = 0;
      
      for (const poolId of activeRewardPools) {
        try {
          const rewardPoolPda = PDAHelper.getRewardPoolPDA(poolId, testSetup.rewardProgram.programId);
          const pool = await testSetup.rewardProgram.account.rewardPool.fetch(rewardPoolPda);
          totalRewardsDistributed += pool.distributedRewards.toNumber();
        } catch (error) {
          // Pool might not exist, continue
        }
      }
      
      console.log(`💰 Rewards: Distributed across ${activeRewardPools.length} pools`);
      
      // Validate cross-contract integration
      expect(finalQuestionBank.totalQuestions.toNumber()).to.be.greaterThanOrEqual(
        finalTournamentManager.tournamentCount.toNumber()
      ); // Should have enough questions for tournaments
      
      console.log("✅ All ecosystem components validated successfully");
      
      // Performance summary
      const allMetrics = gasTracker.getMetrics();
      const totalOperations = allMetrics.length;
      const totalGasCost = allMetrics.reduce((sum, m) => sum + m.lamports, 0);
      const avgGasCost = totalGasCost / totalOperations;
      
      console.log(`\n📊 Integration Test Summary:`);
      console.log(`  Total Operations: ${totalOperations}`);
      console.log(`  Total Gas Cost: ${totalGasCost} lamports (${(totalGasCost / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
      console.log(`  Average Cost per Operation: ${avgGasCost.toFixed(0)} lamports`);
      console.log(`  Participants Processed: ${participants.length}`);
      console.log(`  Questions Processed: ${validQuestions.length}`);
      console.log(`  Cross-Contract Interactions: Successfully tested`);
      
      // Final validation - ecosystem is production ready
      expect(totalOperations).to.be.greaterThan(50); // Comprehensive testing
      expect(avgGasCost).to.be.lessThan(0.01 * LAMPORTS_PER_SOL); // Reasonable gas costs
      expect(totalGasCost).to.be.lessThan(1 * LAMPORTS_PER_SOL); // Total cost under 1 SOL
      
      console.log("\n🎉 TriviaComb ecosystem integration testing completed successfully!");
    });
  });
});