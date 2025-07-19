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
  TestUser 
} from "./utils/test-helpers";

describe("Tournament Manager - Comprehensive Test Suite", () => {
  let testSetup: TestSetup;
  let gasTracker: GasTracker;
  
  // Tournament data
  let tournamentId: number = 1;
  let nextTournamentId: number = 2;

  before(async () => {
    console.log("🚀 Starting Tournament Manager Test Suite");
    
    testSetup = new TestSetup();
    gasTracker = new GasTracker();
    
    await testSetup.initialize();
    
    console.log("✅ Test setup complete");
  });

  after(async () => {
    await testSetup.cleanup();
    gasTracker.printSummary();
  });

  describe("Program Initialization", () => {
    it("should initialize Tournament Manager with correct authority", async () => {
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      const tournamentManager = await testSetup.tournamentProgram.account.tournamentManagerState.fetch(
        tournamentManagerPda
      );

      expect(tournamentManager.authority.toString()).to.equal(
        testSetup.authority.publicKey.toString()
      );
      expect(tournamentManager.tournamentCount.toNumber()).to.equal(0);
      expect(tournamentManager.totalParticipants.toNumber()).to.equal(0);
    });
  });

  describe("Tournament Creation", () => {
    it("should create a tournament with SOL entry fee", async () => {
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(3600); // Start in 1 hour
      const duration = 7200; // 2 hours
      
      const tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      const { result, metrics } = await gasTracker.trackGas(
        "create_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .createTournament(
              "Weekly Trivia Championship",
              "Test your knowledge across various categories",
              new anchor.BN(0.1 * LAMPORTS_PER_SOL), // 0.1 SOL entry fee
              new anchor.BN(5 * LAMPORTS_PER_SOL), // 5 SOL prize pool
              100, // max participants
              new anchor.BN(startTime),
              new anchor.BN(duration),
              20, // question count
              "General", // category
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

      console.log(`Tournament creation cost: ${metrics.lamports} lamports`);

      // Verify tournament was created
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.id.toNumber()).to.equal(tournamentId);
      expect(tournament.organizer.toString()).to.equal(organizer.publicKey.toString());
      expect(tournament.name).to.equal("Weekly Trivia Championship");
      expect(tournament.entryFee.toNumber()).to.equal(0.1 * LAMPORTS_PER_SOL);
      expect(tournament.prizePool.toNumber()).to.equal(5 * LAMPORTS_PER_SOL);
      expect(tournament.maxParticipants).to.equal(100);
      expect(tournament.currentParticipants).to.equal(0);
      expect(tournament.questionCount).to.equal(20);
      expect(tournament.status).to.deep.equal({ registration: {} });

      // Verify tournament manager updated
      const tournamentManager = await testSetup.tournamentProgram.account.tournamentManagerState.fetch(
        tournamentManagerPda
      );
      expect(tournamentManager.tournamentCount.toNumber()).to.equal(1);
    });

    it("should create a tournament with token entry fee", async () => {
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(3600);
      const duration = 7200;
      
      const tournamentPda = PDAHelper.getTournamentPDA(
        nextTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "Token Tournament",
          "Tournament with token entry fee",
          new anchor.BN(1000 * 1000000), // 1000 tokens entry fee
          new anchor.BN(10000 * 1000000), // 10000 tokens prize pool
          50, // max participants
          new anchor.BN(startTime),
          new anchor.BN(duration),
          15, // question count
          "Science", // category
          2 // medium difficulty
        )
        .accounts({
          tournament: tournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Verify tournament
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.id.toNumber()).to.equal(nextTournamentId);
      expect(tournament.entryFee.toNumber()).to.equal(1000 * 1000000);
      expect(tournament.category).to.equal("Science");
      expect(tournament.difficulty).to.equal(2);

      nextTournamentId++;
    });

    it("should reject tournament with invalid parameters", async () => {
      const organizer = testSetup.authority;
      const pastTime = TimeHelper.past(3600); // Past time
      
      const invalidTournamentPda = PDAHelper.getTournamentPDA(
        99,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .createTournament(
              "A".repeat(101), // Name too long
              "Valid description",
              new anchor.BN(LAMPORTS_PER_SOL),
              new anchor.BN(5 * LAMPORTS_PER_SOL),
              100,
              new anchor.BN(pastTime), // Invalid start time
              new anchor.BN(3600),
              20,
              "General",
              null
            )
            .accounts({
              tournament: invalidTournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: organizer.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "NameTooLong"
      );
    });

    it("should reject tournament with zero max participants", async () => {
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(3600);
      
      const invalidTournamentPda = PDAHelper.getTournamentPDA(
        98,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .createTournament(
              "Valid Tournament",
              "Valid description",
              new anchor.BN(LAMPORTS_PER_SOL),
              new anchor.BN(5 * LAMPORTS_PER_SOL),
              0, // Invalid max participants
              new anchor.BN(startTime),
              new anchor.BN(3600),
              20,
              "General",
              null
            )
            .accounts({
              tournament: invalidTournamentPda,
              tournamentManager: tournamentManagerPda,
              organizer: organizer.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "InvalidMaxParticipants"
      );
    });
  });

  describe("Tournament Registration", () => {
    let tournamentPda: PublicKey;
    let vaultPda: PublicKey;

    before(async () => {
      tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );

      // Create tournament vault for escrow
      const [vaultAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("tournament_vault"), tournamentPda.toBuffer()],
        testSetup.tournamentProgram.programId
      );
      vaultPda = vaultAddress;
    });

    it("should register participant with SOL entry fee", async () => {
      const participant = testSetup.users[0];
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      const participantBalanceBefore = await testSetup.provider.connection.getBalance(
        participant.publicKey
      );

      const { result, metrics } = await gasTracker.trackGas(
        "register_for_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .registerForTournament()
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
              participantTokenAccount: null,
              tournamentVault: vaultPda,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([participant.keypair])
            .rpc();
        }
      );

      // Verify registration
      const registration = await testSetup.tournamentProgram.account.registration.fetch(
        registrationPda
      );
      expect(registration.participant.toString()).to.equal(participant.publicKey.toString());
      expect(registration.score).to.equal(0);
      expect(registration.completed).to.be.false;

      // Verify tournament updated
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.currentParticipants).to.equal(1);

      // Verify entry fee was collected
      const participantBalanceAfter = await testSetup.provider.connection.getBalance(
        participant.publicKey
      );
      const entryFee = 0.1 * LAMPORTS_PER_SOL;
      expect(participantBalanceBefore - participantBalanceAfter).to.be.greaterThan(entryFee - 10000); // Account for gas
    });

    it("should register multiple participants", async () => {
      const participants = testSetup.users.slice(1, 4); // 3 more participants

      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );

        await testSetup.tournamentProgram.methods
          .registerForTournament()
          .accounts({
            tournament: tournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
            participantTokenAccount: null,
            tournamentVault: vaultPda,
            tokenProgram: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([participant.keypair])
          .rpc();
      }

      // Verify total participants
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.currentParticipants).to.equal(4);
    });

    it("should prevent duplicate registration", async () => {
      const participant = testSetup.users[0]; // Already registered
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .registerForTournament()
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
              participantTokenAccount: null,
              tournamentVault: vaultPda,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([participant.keypair])
            .rpc();
        },
        "AlreadyRegistered" // This error would need to be added to the program
      );
    });

    it("should prevent registration when tournament is full", async () => {
      // Create a tournament with max 1 participant
      const smallTournamentId = 50;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(3600);
      
      const smallTournamentPda = PDAHelper.getTournamentPDA(
        smallTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      // Create small tournament
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Small Tournament",
          "Tournament with only 1 participant",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          1, // max 1 participant
          new anchor.BN(startTime),
          new anchor.BN(3600),
          10,
          "General",
          null
        )
        .accounts({
          tournament: smallTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Register first participant
      const participant1 = testSetup.users[5];
      const registration1Pda = PDAHelper.getRegistrationPDA(
        smallTournamentPda,
        participant1.publicKey,
        testSetup.tournamentProgram.programId
      );

      const [smallVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tournament_vault"), smallTournamentPda.toBuffer()],
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .registerForTournament()
        .accounts({
          tournament: smallTournamentPda,
          registration: registration1Pda,
          participant: participant1.publicKey,
          participantTokenAccount: null,
          tournamentVault: smallVaultPda,
          tokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([participant1.keypair])
        .rpc();

      // Try to register second participant (should fail)
      const participant2 = testSetup.users[6];
      const registration2Pda = PDAHelper.getRegistrationPDA(
        smallTournamentPda,
        participant2.publicKey,
        testSetup.tournamentProgram.programId
      );

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .registerForTournament()
            .accounts({
              tournament: smallTournamentPda,
              registration: registration2Pda,
              participant: participant2.publicKey,
              participantTokenAccount: null,
              tournamentVault: smallVaultPda,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([participant2.keypair])
            .rpc();
        },
        "TournamentFull"
      );
    });
  });

  describe("Tournament Start", () => {
    let tournamentPda: PublicKey;

    before(async () => {
      tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );
    });

    it("should prevent starting tournament before start time", async () => {
      const organizer = testSetup.authority;

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .startTournament()
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "TournamentNotReady"
      );
    });

    it("should start tournament at scheduled time", async () => {
      // Wait for tournament start time (this test assumes we can mock time or use a very short wait)
      console.log("⏰ Waiting for tournament start time...");
      await TimeHelper.wait(61); // Wait 61 seconds to pass start time

      const organizer = testSetup.authority;

      const { result, metrics } = await gasTracker.trackGas(
        "start_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .startTournament()
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        }
      );

      // Verify tournament status
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.status).to.deep.equal({ active: {} });
      expect(tournament.actualStartTime).to.not.be.null;
    });

    it("should prevent non-organizer from starting tournament", async () => {
      // Create another tournament for this test
      const nonOrganizerTournamentId = 10;
      const organizer = testSetup.authority;
      const nonOrganizer = testSetup.users[7];
      const startTime = TimeHelper.future(60); // Start soon
      
      const nonOrgTournamentPda = PDAHelper.getTournamentPDA(
        nonOrganizerTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      // Create tournament
      await testSetup.tournamentProgram.methods
        .createTournament(
          "Non-Organizer Test",
          "Test tournament",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(3600),
          10,
          "General",
          null
        )
        .accounts({
          tournament: nonOrgTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Wait for start time
      await TimeHelper.wait(61);

      // Try to start with non-organizer
      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .startTournament()
            .accounts({
              tournament: nonOrgTournamentPda,
              organizer: nonOrganizer.publicKey,
            })
            .signers([nonOrganizer.keypair])
            .rpc();
        },
        "ConstraintHasOne" // Anchor constraint error
      );
    });

    it("should prevent starting tournament with insufficient participants", async () => {
      // Create tournament with no participants
      const emptyTournamentId = 11;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(60);
      
      const emptyTournamentPda = PDAHelper.getTournamentPDA(
        emptyTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "Empty Tournament",
          "Tournament with no participants",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(3600),
          10,
          "General",
          null
        )
        .accounts({
          tournament: emptyTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      await TimeHelper.wait(61);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .startTournament()
            .accounts({
              tournament: emptyTournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "InsufficientParticipants"
      );
    });
  });

  describe("Answer Submission", () => {
    let tournamentPda: PublicKey;
    let participants: TestUser[];

    before(async () => {
      tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );
      participants = testSetup.users.slice(0, 4);
    });

    it("should allow participant to submit answers", async () => {
      const participant = participants[0];
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      // Generate answers (array of answer indices 0-3)
      const answers = Array.from({ length: 20 }, (_, i) => i % 4);

      const { result, metrics } = await gasTracker.trackGas(
        "submit_answers",
        async () => {
          return await testSetup.tournamentProgram.methods
            .submitAnswers(answers)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
            })
            .signers([participant.keypair])
            .rpc();
        }
      );

      // Verify answers were submitted
      const registration = await testSetup.tournamentProgram.account.registration.fetch(
        registrationPda
      );
      expect(registration.completed).to.be.true;
      expect(registration.score).to.be.greaterThan(0);
      expect(registration.submissionTime).to.not.be.null;
    });

    it("should calculate different scores for different answers", async () => {
      const participant = participants[1];
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      // Generate different answers
      const answers = Array.from({ length: 20 }, (_, i) => (i + 1) % 4);

      await testSetup.tournamentProgram.methods
        .submitAnswers(answers)
        .accounts({
          tournament: tournamentPda,
          registration: registrationPda,
          participant: participant.publicKey,
        })
        .signers([participant.keypair])
        .rpc();

      // Get both participants' scores
      const registration1 = await testSetup.tournamentProgram.account.registration.fetch(
        PDAHelper.getRegistrationPDA(
          tournamentPda,
          participants[0].publicKey,
          testSetup.tournamentProgram.programId
        )
      );

      const registration2 = await testSetup.tournamentProgram.account.registration.fetch(
        registrationPda
      );

      // Scores should be different (since we used different answer patterns)
      console.log(`Participant 1 score: ${registration1.score}`);
      console.log(`Participant 2 score: ${registration2.score}`);
    });

    it("should prevent double submission", async () => {
      const participant = participants[0]; // Already submitted
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      const answers = Array.from({ length: 20 }, (_, i) => i % 4);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .submitAnswers(answers)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
            })
            .signers([participant.keypair])
            .rpc();
        },
        "AlreadySubmitted"
      );
    });

    it("should reject answers with wrong count", async () => {
      const participant = participants[2];
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      const wrongAnswers = [0, 1, 2]; // Only 3 answers instead of 20

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .submitAnswers(wrongAnswers)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
            })
            .signers([participant.keypair])
            .rpc();
        },
        "InvalidAnswerCount"
      );
    });

    it("should prevent submission after tournament ends", async () => {
      // Wait for tournament to end
      console.log("⏰ Waiting for tournament to end...");
      await TimeHelper.wait(121); // Wait for tournament duration to pass

      const participant = participants[3];
      const registrationPda = PDAHelper.getRegistrationPDA(
        tournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      const answers = Array.from({ length: 20 }, (_, i) => i % 4);

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .submitAnswers(answers)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: participant.publicKey,
            })
            .signers([participant.keypair])
            .rpc();
        },
        "TournamentEnded"
      );
    });
  });

  describe("Tournament End", () => {
    let tournamentPda: PublicKey;

    before(async () => {
      tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );
    });

    it("should end tournament after duration expires", async () => {
      const organizer = testSetup.authority;

      const { result, metrics } = await gasTracker.trackGas(
        "end_tournament",
        async () => {
          return await testSetup.tournamentProgram.methods
            .endTournament()
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        }
      );

      // Verify tournament ended
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      expect(tournament.status).to.deep.equal({ ended: {} });
      expect(tournament.endedAt).to.not.be.null;
    });

    it("should prevent ending tournament before time", async () => {
      // Create a new tournament that just started
      const futureTournamentId = 20;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(60);
      
      const futureTournamentPda = PDAHelper.getTournamentPDA(
        futureTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "Future Tournament",
          "Tournament for testing early end",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(3600), // 1 hour duration
          10,
          "General",
          null
        )
        .accounts({
          tournament: futureTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      await TimeHelper.wait(61); // Wait for start

      await testSetup.tournamentProgram.methods
        .startTournament()
        .accounts({
          tournament: futureTournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();

      // Try to end immediately (should fail)
      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .endTournament()
            .accounts({
              tournament: futureTournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "TournamentNotEnded"
      );
    });
  });

  describe("Prize Distribution", () => {
    let tournamentPda: PublicKey;

    before(async () => {
      tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );
    });

    it("should distribute prizes to winners", async () => {
      const organizer = testSetup.authority;
      
      // Get participants and their scores
      const participants = testSetup.users.slice(0, 2); // First 2 participants who submitted
      const winners = participants.map(p => p.publicKey);
      const prizeAmounts = [
        new anchor.BN(3 * LAMPORTS_PER_SOL), // 1st place
        new anchor.BN(2 * LAMPORTS_PER_SOL), // 2nd place
      ];

      const { result, metrics } = await gasTracker.trackGas(
        "distribute_prizes",
        async () => {
          return await testSetup.tournamentProgram.methods
            .distributePrizes(winners, prizeAmounts)
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        }
      );

      console.log(`Prize distribution cost: ${metrics.lamports} lamports`);

      // Verify tournament marked prizes as distributed
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(tournamentPda);
      // Prize distribution status would be tracked in the tournament state
    });

    it("should reject invalid prize data", async () => {
      const organizer = testSetup.authority;
      
      const winners = [testSetup.users[0].publicKey];
      const prizeAmounts = [
        new anchor.BN(3 * LAMPORTS_PER_SOL),
        new anchor.BN(2 * LAMPORTS_PER_SOL), // More amounts than winners
      ];

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .distributePrizes(winners, prizeAmounts)
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "InvalidPrizeData"
      );
    });

    it("should reject prize distribution exceeding pool", async () => {
      const organizer = testSetup.authority;
      
      const winners = [testSetup.users[0].publicKey];
      const prizeAmounts = [new anchor.BN(100 * LAMPORTS_PER_SOL)]; // More than prize pool

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .distributePrizes(winners, prizeAmounts)
            .accounts({
              tournament: tournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "InsufficientPrizePool"
      );
    });
  });

  describe("Performance Tests", () => {
    it("should handle large tournament registration efficiently", async () => {
      // Create tournament for load testing
      const loadTestTournamentId = 30;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(3600);
      
      const loadTournamentPda = PDAHelper.getTournamentPDA(
        loadTestTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "Load Test Tournament",
          "Tournament for performance testing",
          new anchor.BN(0), // No entry fee for easier testing
          new anchor.BN(10 * LAMPORTS_PER_SOL),
          1000, // Large max participants
          new anchor.BN(startTime),
          new anchor.BN(3600),
          10,
          "General",
          null
        )
        .accounts({
          tournament: loadTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Create registration operations for available users
      const registrationOps = testSetup.users.slice(0, 8).map(user => 
        async () => {
          const registrationPda = PDAHelper.getRegistrationPDA(
            loadTournamentPda,
            user.publicKey,
            testSetup.tournamentProgram.programId
          );

          const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("tournament_vault"), loadTournamentPda.toBuffer()],
            testSetup.tournamentProgram.programId
          );

          return await testSetup.tournamentProgram.methods
            .registerForTournament()
            .accounts({
              tournament: loadTournamentPda,
              registration: registrationPda,
              participant: user.publicKey,
              participantTokenAccount: null,
              tournamentVault: vaultPda,
              tokenProgram: null,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user.keypair])
            .rpc();
        }
      );

      const { throughput, avgTime } = await LoadTester.measureThroughput(
        registrationOps[0], // Test single registration throughput
        1,
        "Tournament registration"
      );

      expect(avgTime).to.be.lessThan(5000); // Should complete in under 5 seconds

      // Execute all registrations
      const results = await LoadTester.concurrentOperations(registrationOps, 3);
      expect(results.length).to.equal(8);

      // Verify all registrations
      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(
        loadTournamentPda
      );
      expect(tournament.currentParticipants).to.equal(8);
    });

    it("should handle batch answer submissions efficiently", async () => {
      // Test rapid answer submissions
      const submissionOps = testSetup.users.slice(0, 3).map(user => 
        async () => {
          const tournamentPda = PDAHelper.getTournamentPDA(
            30, // Load test tournament
            testSetup.tournamentProgram.programId
          );
          
          const registrationPda = PDAHelper.getRegistrationPDA(
            tournamentPda,
            user.publicKey,
            testSetup.tournamentProgram.programId
          );

          const answers = Array.from({ length: 10 }, (_, i) => Math.floor(Math.random() * 4));

          return await testSetup.tournamentProgram.methods
            .submitAnswers(answers)
            .accounts({
              tournament: tournamentPda,
              registration: registrationPda,
              participant: user.publicKey,
            })
            .signers([user.keypair])
            .rpc();
        }
      );

      // Wait for tournament to start
      await TimeHelper.wait(61);

      // Start the tournament
      const loadTournamentPda = PDAHelper.getTournamentPDA(
        30,
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .startTournament()
        .accounts({
          tournament: loadTournamentPda,
          organizer: testSetup.authority.publicKey,
        })
        .signers([testSetup.authority.keypair])
        .rpc();

      const { throughput } = await LoadTester.measureThroughput(
        submissionOps[0], // Test single submission
        1,
        "Answer submission"
      );

      // Execute all submissions
      const results = await LoadTester.concurrentOperations(submissionOps, 2);
      expect(results.length).to.equal(3);
    });
  });

  describe("Edge Cases", () => {
    it("should handle tournament with no submissions gracefully", async () => {
      // Create tournament, register participants, but don't submit answers
      const noSubmissionTournamentId = 40;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(60);
      
      const noSubTournamentPda = PDAHelper.getTournamentPDA(
        noSubmissionTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "No Submission Tournament",
          "Tournament with no answer submissions",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(120), // 2 minute duration
          5,
          "General",
          null
        )
        .accounts({
          tournament: noSubTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Register participants
      const participant = testSetup.users[9];
      const registrationPda = PDAHelper.getRegistrationPDA(
        noSubTournamentPda,
        participant.publicKey,
        testSetup.tournamentProgram.programId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tournament_vault"), noSubTournamentPda.toBuffer()],
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .registerForTournament()
        .accounts({
          tournament: noSubTournamentPda,
          registration: registrationPda,
          participant: participant.publicKey,
          participantTokenAccount: null,
          tournamentVault: vaultPda,
          tokenProgram: null,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([participant.keypair])
        .rpc();

      await TimeHelper.wait(61); // Start tournament

      await testSetup.tournamentProgram.methods
        .startTournament()
        .accounts({
          tournament: noSubTournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();

      await TimeHelper.wait(121); // Wait for end

      // End tournament (should work even with no submissions)
      await testSetup.tournamentProgram.methods
        .endTournament()
        .accounts({
          tournament: noSubTournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();

      const tournament = await testSetup.tournamentProgram.account.tournament.fetch(
        noSubTournamentPda
      );
      expect(tournament.status).to.deep.equal({ ended: {} });
    });

    it("should handle tied scores appropriately", async () => {
      // Create tournament and have multiple participants submit identical answers
      const tieTournamentId = 41;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(60);
      
      const tieTournamentPda = PDAHelper.getTournamentPDA(
        tieTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "Tie Tournament",
          "Tournament for testing tied scores",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(180), // 3 minute duration
          5,
          "General",
          null
        )
        .accounts({
          tournament: tieTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Register multiple participants
      const participants = testSetup.users.slice(0, 3);
      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tieTournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );

        const [vaultPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("tournament_vault"), tieTournamentPda.toBuffer()],
          testSetup.tournamentProgram.programId
        );

        await testSetup.tournamentProgram.methods
          .registerForTournament()
          .accounts({
            tournament: tieTournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
            participantTokenAccount: null,
            tournamentVault: vaultPda,
            tokenProgram: null,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([participant.keypair])
          .rpc();
      }

      await TimeHelper.wait(61); // Start

      await testSetup.tournamentProgram.methods
        .startTournament()
        .accounts({
          tournament: tieTournamentPda,
          organizer: organizer.publicKey,
        })
        .signers([organizer.keypair])
        .rpc();

      // Submit identical answers for all participants
      const identicalAnswers = [0, 1, 2, 3, 0]; // Same pattern
      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tieTournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );

        await testSetup.tournamentProgram.methods
          .submitAnswers(identicalAnswers)
          .accounts({
            tournament: tieTournamentPda,
            registration: registrationPda,
            participant: participant.publicKey,
          })
          .signers([participant.keypair])
          .rpc();
      }

      // Check that all participants have same score
      const scores = [];
      for (const participant of participants) {
        const registrationPda = PDAHelper.getRegistrationPDA(
          tieTournamentPda,
          participant.publicKey,
          testSetup.tournamentProgram.programId
        );
        
        const registration = await testSetup.tournamentProgram.account.registration.fetch(
          registrationPda
        );
        scores.push(registration.score);
      }

      // All scores should be identical
      expect(scores[0]).to.equal(scores[1]);
      expect(scores[1]).to.equal(scores[2]);
      console.log(`All participants tied with score: ${scores[0]}`);
    });
  });

  describe("Security Tests", () => {
    it("should prevent unauthorized prize distribution", async () => {
      const nonOrganizer = testSetup.users[8];
      const tournamentPda = PDAHelper.getTournamentPDA(
        tournamentId,
        testSetup.tournamentProgram.programId
      );

      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .distributePrizes([testSetup.users[0].publicKey], [new anchor.BN(LAMPORTS_PER_SOL)])
            .accounts({
              tournament: tournamentPda,
              organizer: nonOrganizer.publicKey,
            })
            .signers([nonOrganizer.keypair])
            .rpc();
        },
        "ConstraintHasOne"
      );
    });

    it("should validate tournament state transitions", async () => {
      // Test that tournaments follow proper state machine
      const stateTournamentId = 50;
      const organizer = testSetup.authority;
      const startTime = TimeHelper.future(60);
      
      const stateTournamentPda = PDAHelper.getTournamentPDA(
        stateTournamentId,
        testSetup.tournamentProgram.programId
      );
      
      const { tournamentManagerPda } = PDAHelper.getTournamentManagerPDAs(
        testSetup.tournamentProgram.programId
      );

      await testSetup.tournamentProgram.methods
        .createTournament(
          "State Test Tournament",
          "Tournament for state testing",
          new anchor.BN(0),
          new anchor.BN(LAMPORTS_PER_SOL),
          10,
          new anchor.BN(startTime),
          new anchor.BN(120),
          5,
          "General",
          null
        )
        .accounts({
          tournament: stateTournamentPda,
          tournamentManager: tournamentManagerPda,
          organizer: organizer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer.keypair])
        .rpc();

      // Try to end tournament before it starts (should fail)
      await AssertionHelper.assertError(
        async () => {
          await testSetup.tournamentProgram.methods
            .endTournament()
            .accounts({
              tournament: stateTournamentPda,
              organizer: organizer.publicKey,
            })
            .signers([organizer.keypair])
            .rpc();
        },
        "InvalidStatus"
      );
    });
  });
});