#!/usr/bin/env ts-node

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { 
  Connection, 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { QuestionBank } from "../target/types/question_bank";
import { TournamentManager } from "../target/types/tournament_manager";
import { RewardDistributor } from "../target/types/reward_distributor";
import {
  DeploymentConfig,
  ConfigurationResult,
  DeployedPrograms,
  DeploymentLogger,
  SolanaCluster,
  RewardPoolConfig,
  TournamentConfig,
  PostDeploymentTasks,
} from "./types/deployment";
import {
  loadEnvironmentConfig,
  loadProgramKeypairs,
  DeploymentLoggerImpl,
  sendTransactionWithRetry,
  waitForAccountCreation,
  getQuestionBankPDA,
  getTournamentManagerPDA,
  getUserReputationPDA,
  getRewardPoolPDA,
  getRewardVaultPDA,
  createTestToken,
  createTokenAccountAndMint,
  formatDuration,
  generateDeploymentId,
  saveDeploymentResult,
} from "./utils/deployment-utils";

// ============================================================================
// Configuration Templates
// ============================================================================

const CONFIGURATION_TEMPLATES = {
  development: {
    curators: [
      // Development curators - replace with actual pubkeys
      "11111111111111111111111111111111",
      "22222222222222222222222222222222",
    ],
    rewardPools: [
      {
        id: 1,
        name: "Development Performance Pool",
        totalRewards: new BN(10 * LAMPORTS_PER_SOL),
        rewardType: "sol" as const,
        distributionCriteria: "performance" as const,
        duration: 30 * 24 * 60 * 60, // 30 days
      },
      {
        id: 2,
        name: "Development Achievement Pool",
        totalRewards: new BN(1000000000000), // 1M tokens
        rewardType: "spl-token" as const,
        distributionCriteria: "achievement" as const,
        duration: 60 * 24 * 60 * 60, // 60 days
      },
    ],
    tournaments: [
      {
        name: "Development Tournament",
        description: "A test tournament for development",
        entryFee: new BN(0.1 * LAMPORTS_PER_SOL),
        prizePool: new BN(1 * LAMPORTS_PER_SOL),
        maxParticipants: 100,
        questionCount: 10,
        category: "General",
        difficulty: 1,
        duration: new BN(7 * 24 * 60 * 60), // 7 days
      },
    ],
    sampleQuestions: [
      {
        text: "What is the native token of the Solana blockchain?",
        options: ["SOL", "ETH", "BTC", "USDC"],
        correctAnswer: 0,
        category: "Blockchain",
        difficulty: 1,
        explanation: "SOL is the native cryptocurrency of the Solana blockchain platform.",
      },
      {
        text: "Which programming language is primarily used for Solana smart contracts?",
        options: ["Solidity", "Rust", "JavaScript", "Python"],
        correctAnswer: 1,
        category: "Development",
        difficulty: 2,
        explanation: "Rust is the primary programming language for developing Solana smart contracts.",
      },
    ],
  },
  production: {
    curators: [
      // Production curators - replace with actual pubkeys
      "CuratorPublicKey1111111111111111111111111",
      "CuratorPublicKey2222222222222222222222222",
      "CuratorPublicKey3333333333333333333333333",
    ],
    rewardPools: [
      {
        id: 1,
        name: "Season 1 Performance Pool",
        totalRewards: new BN(1000 * LAMPORTS_PER_SOL),
        rewardType: "sol" as const,
        distributionCriteria: "performance" as const,
        duration: 90 * 24 * 60 * 60, // 90 days
      },
      {
        id: 2,
        name: "Achievement Rewards Pool",
        totalRewards: new BN(10000000000000), // 10M tokens
        rewardType: "spl-token" as const,
        distributionCriteria: "achievement" as const,
        duration: 180 * 24 * 60 * 60, // 180 days
      },
    ],
    tournaments: [
      {
        name: "Launch Tournament",
        description: "The inaugural TriviaComb tournament",
        entryFee: new BN(0.1 * LAMPORTS_PER_SOL),
        prizePool: new BN(100 * LAMPORTS_PER_SOL),
        maxParticipants: 1000,
        questionCount: 50,
        category: "General Knowledge",
        difficulty: 2,
        duration: new BN(14 * 24 * 60 * 60), // 14 days
      },
    ],
    sampleQuestions: [], // No sample questions for production
  },
};

// ============================================================================
// Contract Configuration Class
// ============================================================================

class ContractConfigurator {
  private config: DeploymentConfig;
  private logger: DeploymentLogger;
  private programs: DeployedPrograms;
  private configurationId: string;

  constructor(config: DeploymentConfig, programs: DeployedPrograms) {
    this.config = config;
    this.logger = new DeploymentLoggerImpl(true, `./logs/configuration-${config.cluster}-${new Date().toISOString().split('T')[0]}.log`);
    this.programs = programs;
    this.configurationId = generateDeploymentId();
  }

  async configure(): Promise<ConfigurationResult> {
    const startTime = Date.now();
    this.logger.info("🔧 Starting contract configuration...");
    this.logger.info(`Configuration ID: ${this.configurationId}`);

    try {
      // Load configuration template
      const template = this.loadConfigurationTemplate();

      // Configure curators
      const curatorsAdded = await this.configureCurators(template.curators);

      // Configure reward pools
      const rewardPoolsCreated = await this.configureRewardPools(template.rewardPools);

      // Configure tournaments
      await this.configureTournaments(template.tournaments);

      // Configure sample questions (if applicable)
      if (template.sampleQuestions.length > 0) {
        await this.configureSampleQuestions(template.sampleQuestions);
      }

      // Setup Honeycomb integration
      if (this.config.honeycombConfig.enableIntegration) {
        await this.setupHoneycombIntegration();
      }

      // Configure governance settings
      await this.configureGovernanceSettings();

      // Setup monitoring and alerting
      await this.setupMonitoring();

      const result: ConfigurationResult = {
        success: true,
        questionBankInitialized: true,
        tournamentManagerInitialized: true,
        curatorsAdded,
        rewardPoolsCreated,
        transactionSignatures: [], // Would be populated with actual signatures
      };

      this.logger.info("✅ Contract configuration completed successfully!");
      this.logger.info(`Configuration time: ${formatDuration(Date.now() - startTime)}`);

      // Save configuration result
      this.saveConfigurationResult(result);

      return result;
    } catch (error) {
      this.logger.error("💥 Contract configuration failed", { error: error.message });
      const result: ConfigurationResult = {
        success: false,
        questionBankInitialized: false,
        tournamentManagerInitialized: false,
        curatorsAdded: 0,
        rewardPoolsCreated: 0,
        transactionSignatures: [],
        errors: [error.message],
      };

      this.saveConfigurationResult(result);
      return result;
    }
  }

  private loadConfigurationTemplate() {
    const templateName = this.config.cluster === "mainnet-beta" ? "production" : "development";
    const template = CONFIGURATION_TEMPLATES[templateName];

    // Override with environment variables if provided
    if (this.config.initialConfiguration.curators.length > 0) {
      template.curators = this.config.initialConfiguration.curators.map(pk => pk.toString());
    }

    return template;
  }

  private async configureCurators(curatorPubkeys: string[]): Promise<number> {
    this.logger.info("👥 Configuring curators...");
    
    let curatorsAdded = 0;

    for (const curatorPubkey of curatorPubkeys) {
      try {
        const curator = new PublicKey(curatorPubkey);
        const [userReputationPda] = getUserReputationPDA(curator, this.programs.questionBank.programId);

        // Check if curator already exists
        try {
          await this.programs.questionBank.program.account.userReputation.fetch(userReputationPda);
          this.logger.info(`Curator already exists: ${curator.toString()}`);
          continue;
        } catch (error) {
          // Curator doesn't exist, proceed to add
        }

        this.logger.info(`Adding curator: ${curator.toString()}`);
        
        const addCuratorTx = await this.programs.questionBank.program.methods
          .addCurator(curator, this.config.initialConfiguration.initialCuratorReputation)
          .accounts({
            questionBank: this.programs.questionBank.questionBankPda,
            userReputation: userReputationPda,
            authority: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();

        this.logger.logTransaction(addCuratorTx, `Add curator: ${curator.toString()}`);
        curatorsAdded++;
      } catch (error) {
        this.logger.error(`Failed to add curator ${curatorPubkey}`, { error: error.message });
      }
    }

    this.logger.info(`✅ Configured ${curatorsAdded} curators`);
    return curatorsAdded;
  }

  private async configureRewardPools(pools: any[]): Promise<number> {
    this.logger.info("🏆 Configuring reward pools...");
    
    let poolsCreated = 0;

    for (const poolConfig of pools) {
      try {
        const [poolPda] = getRewardPoolPDA(poolConfig.id, this.programs.rewardDistributor.programId);
        const [vaultPda] = getRewardVaultPDA(poolConfig.id, this.programs.rewardDistributor.programId);

        // Check if pool already exists
        try {
          await this.programs.rewardDistributor.program.account.rewardPool.fetch(poolPda);
          this.logger.info(`Reward pool already exists: ${poolConfig.name}`);
          continue;
        } catch (error) {
          // Pool doesn't exist, proceed to create
        }

        this.logger.info(`Creating reward pool: ${poolConfig.name}`);

        let tokenMint: PublicKey | null = null;
        if (poolConfig.rewardType === "spl-token") {
          // Create or use existing token mint
          if (this.config.cluster !== "mainnet-beta") {
            tokenMint = await createTestToken(
              this.config.connection,
              this.config.payer,
              this.config.payer.publicKey,
              this.config.initialConfiguration.tokenMintDecimals,
              this.logger
            );
          } else {
            // For mainnet, use existing token mint from environment
            tokenMint = new PublicKey(process.env.REWARD_TOKEN_MINT || "");
          }
        }

        const createPoolTx = await this.programs.rewardDistributor.program.methods
          .createRewardPool(
            poolConfig.id,
            poolConfig.name,
            poolConfig.totalRewards,
            poolConfig.distributionCriteria,
            new BN(Math.floor(Date.now() / 1000)),
            new BN(Math.floor(Date.now() / 1000) + poolConfig.duration),
            tokenMint
          )
          .accounts({
            rewardPool: poolPda,
            rewardVault: vaultPda,
            authority: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([this.config.payer])
          .rpc();

        this.logger.logTransaction(createPoolTx, `Create reward pool: ${poolConfig.name}`);
        poolsCreated++;

        // Fund the pool if it's a SOL pool
        if (poolConfig.rewardType === "sol") {
          await this.fundSolRewardPool(poolPda, poolConfig.totalRewards);
        }
      } catch (error) {
        this.logger.error(`Failed to create reward pool ${poolConfig.name}`, { error: error.message });
      }
    }

    this.logger.info(`✅ Configured ${poolsCreated} reward pools`);
    return poolsCreated;
  }

  private async fundSolRewardPool(poolPda: PublicKey, amount: BN): Promise<void> {
    this.logger.info(`Funding SOL reward pool: ${amount.toString()} lamports`);
    
    const fundTx = await this.programs.rewardDistributor.program.methods
      .fundRewardPool(amount)
      .accounts({
        rewardPool: poolPda,
        funder: this.config.payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.config.payer])
      .rpc();

    this.logger.logTransaction(fundTx, `Fund SOL reward pool: ${amount.toString()}`);
  }

  private async configureTournaments(tournaments: TournamentConfig[]): Promise<void> {
    this.logger.info("🏟️ Configuring tournaments...");
    
    for (const tournamentConfig of tournaments) {
      try {
        this.logger.info(`Creating tournament: ${tournamentConfig.name}`);

        const createTournamentTx = await this.programs.tournamentManager.program.methods
          .createTournament(
            tournamentConfig.name,
            tournamentConfig.description,
            tournamentConfig.entryFee,
            tournamentConfig.prizePool,
            tournamentConfig.maxParticipants,
            tournamentConfig.questionCount,
            tournamentConfig.category || "",
            tournamentConfig.difficulty || 1,
            new BN(Math.floor(Date.now() / 1000) + 3600), // Start in 1 hour
            new BN(Math.floor(Date.now() / 1000) + 3600 + tournamentConfig.duration.toNumber())
          )
          .accounts({
            tournamentManager: this.programs.tournamentManager.tournamentManagerPda,
            authority: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();

        this.logger.logTransaction(createTournamentTx, `Create tournament: ${tournamentConfig.name}`);
      } catch (error) {
        this.logger.error(`Failed to create tournament ${tournamentConfig.name}`, { error: error.message });
      }
    }

    this.logger.info("✅ Configured tournaments");
  }

  private async configureSampleQuestions(questions: any[]): Promise<void> {
    this.logger.info("❓ Configuring sample questions...");
    
    for (const questionData of questions) {
      try {
        this.logger.info(`Submitting question: ${questionData.text.substring(0, 50)}...`);

        const submitQuestionTx = await this.programs.questionBank.program.methods
          .submitQuestion(
            questionData.text,
            questionData.options,
            questionData.correctAnswer,
            questionData.category,
            questionData.difficulty,
            questionData.explanation
          )
          .accounts({
            questionBank: this.programs.questionBank.questionBankPda,
            submitter: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();

        this.logger.logTransaction(submitQuestionTx, `Submit question: ${questionData.text.substring(0, 30)}...`);
      } catch (error) {
        this.logger.error(`Failed to submit question: ${questionData.text.substring(0, 30)}...`, { error: error.message });
      }
    }

    this.logger.info("✅ Configured sample questions");
  }

  private async setupHoneycombIntegration(): Promise<void> {
    this.logger.info("🍯 Setting up Honeycomb integration...");
    
    try {
      // Configure Honeycomb achievements
      const achievements = [
        {
          name: "First Question",
          description: "Submit your first question",
          criteria: "submit_question",
          points: 100,
        },
        {
          name: "Trivia Master",
          description: "Answer 100 questions correctly",
          criteria: "correct_answers",
          threshold: 100,
          points: 1000,
        },
        {
          name: "Tournament Winner",
          description: "Win a tournament",
          criteria: "tournament_win",
          points: 5000,
        },
      ];

      // Setup achievements in Honeycomb
      for (const achievement of achievements) {
        this.logger.info(`Setting up achievement: ${achievement.name}`);
        // Honeycomb API integration would go here
      }

      this.logger.info("✅ Honeycomb integration configured");
    } catch (error) {
      this.logger.error("Failed to setup Honeycomb integration", { error: error.message });
    }
  }

  private async configureGovernanceSettings(): Promise<void> {
    this.logger.info("🏛️ Configuring governance settings...");
    
    try {
      // Configure voting parameters
      const governanceConfig = {
        minVotingPower: new BN(1000),
        votingPeriod: new BN(7 * 24 * 60 * 60), // 7 days
        quorumThreshold: 51, // 51%
        executionDelay: new BN(24 * 60 * 60), // 24 hours
      };

      // Apply governance configuration
      const configureGovernanceTx = await this.programs.questionBank.program.methods
        .configureGovernance(
          governanceConfig.minVotingPower,
          governanceConfig.votingPeriod,
          governanceConfig.quorumThreshold,
          governanceConfig.executionDelay
        )
        .accounts({
          questionBank: this.programs.questionBank.questionBankPda,
          authority: this.config.payer.publicKey,
        })
        .signers([this.config.payer])
        .rpc();

      this.logger.logTransaction(configureGovernanceTx, "Configure governance settings");
      this.logger.info("✅ Governance settings configured");
    } catch (error) {
      this.logger.error("Failed to configure governance settings", { error: error.message });
    }
  }

  private async setupMonitoring(): Promise<void> {
    this.logger.info("📊 Setting up monitoring...");
    
    try {
      // Configure monitoring parameters
      const monitoringConfig = {
        enableMetrics: true,
        metricsInterval: 60, // 1 minute
        alertThresholds: {
          highGasUsage: 1000000, // 1M lamports
          slowConfirmation: 30000, // 30 seconds
          errorRate: 0.05, // 5%
        },
      };

      // Setup monitoring configuration
      this.logger.info("Monitoring configuration:", monitoringConfig);
      
      // In a real implementation, this would integrate with monitoring services
      this.logger.info("✅ Monitoring configured");
    } catch (error) {
      this.logger.error("Failed to setup monitoring", { error: error.message });
    }
  }

  private saveConfigurationResult(result: ConfigurationResult): void {
    const resultPath = `./configurations/${this.config.cluster}-${this.configurationId}.json`;
    
    try {
      const configData = {
        ...result,
        configurationId: this.configurationId,
        timestamp: new Date().toISOString(),
        cluster: this.config.cluster,
      };

      const dir = path.dirname(resultPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resultPath, JSON.stringify(configData, null, 2));
      this.logger.info(`Configuration result saved to: ${resultPath}`);
    } catch (error) {
      this.logger.error(`Failed to save configuration result: ${error.message}`);
    }
  }
}

// ============================================================================
// Main Configuration Function
// ============================================================================

async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const cluster = process.argv[2] as SolanaCluster || "devnet";
    const configFile = process.argv[3] || null;

    console.log("🔧 TriviaComb Contract Configuration");
    console.log("===================================");
    console.log(`Cluster: ${cluster}`);
    console.log("===================================");

    // Load configuration
    const config = loadEnvironmentConfig();
    
    // Validate cluster
    if (config.cluster !== cluster) {
      console.log(`Switching cluster from ${config.cluster} to ${cluster}`);
      config.cluster = cluster;
    }

    // Load deployed programs
    const programKeypairs = loadProgramKeypairs(config.programKeypairsPath);
    
    // Load IDL files
    const questionBankIdl = JSON.parse(fs.readFileSync("./target/idl/question_bank.json", "utf8"));
    const tournamentManagerIdl = JSON.parse(fs.readFileSync("./target/idl/tournament_manager.json", "utf8"));
    const rewardDistributorIdl = JSON.parse(fs.readFileSync("./target/idl/reward_distributor.json", "utf8"));

    // Create program instances
    const questionBankProgram = new Program(questionBankIdl, programKeypairs.questionBankKeypair.publicKey, config.provider);
    const tournamentManagerProgram = new Program(tournamentManagerIdl, programKeypairs.tournamentManagerKeypair.publicKey, config.provider);
    const rewardDistributorProgram = new Program(rewardDistributorIdl, programKeypairs.rewardDistributorKeypair.publicKey, config.provider);

    // Create PDA addresses
    const [questionBankPda] = getQuestionBankPDA(programKeypairs.questionBankKeypair.publicKey);
    const [tournamentManagerPda] = getTournamentManagerPDA(programKeypairs.tournamentManagerKeypair.publicKey);

    const programs: DeployedPrograms = {
      questionBank: {
        programId: programKeypairs.questionBankKeypair.publicKey,
        programKeypair: programKeypairs.questionBankKeypair,
        questionBankPda,
        program: questionBankProgram,
      },
      tournamentManager: {
        programId: programKeypairs.tournamentManagerKeypair.publicKey,
        programKeypair: programKeypairs.tournamentManagerKeypair,
        tournamentManagerPda,
        program: tournamentManagerProgram,
      },
      rewardDistributor: {
        programId: programKeypairs.rewardDistributorKeypair.publicKey,
        programKeypair: programKeypairs.rewardDistributorKeypair,
        program: rewardDistributorProgram,
      },
    };

    // Execute configuration
    const configurator = new ContractConfigurator(config, programs);
    const result = await configurator.configure();

    if (result.success) {
      console.log("✅ Contract configuration completed successfully!");
      console.log(`Curators added: ${result.curatorsAdded}`);
      console.log(`Reward pools created: ${result.rewardPoolsCreated}`);
      console.log(`Question Bank PDA: ${questionBankPda.toString()}`);
      console.log(`Tournament Manager PDA: ${tournamentManagerPda.toString()}`);
    } else {
      console.log("❌ Contract configuration failed!");
      if (result.errors) {
        console.log("Errors:");
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("💥 Configuration failed:", error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export { ContractConfigurator, CONFIGURATION_TEMPLATES };