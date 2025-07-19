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
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { QuestionBank } from "../target/types/question_bank";
import { TournamentManager } from "../target/types/tournament_manager";
import { RewardDistributor } from "../target/types/reward_distributor";
import {
  DeploymentConfig,
  DeploymentResult,
  DeployedPrograms,
  DeploymentLogger,
  SolanaCluster,
} from "./types/deployment";
import {
  loadEnvironmentConfig,
  ensureProgramKeypairs,
  DeploymentLoggerImpl,
  sendTransactionWithRetry,
  airdropSol,
  waitForAccountCreation,
  getQuestionBankPDA,
  getTournamentManagerPDA,
  getUserReputationPDA,
  createTestToken,
  createTokenAccountAndMint,
  formatDuration,
  generateDeploymentId,
  saveDeploymentResult,
} from "./utils/deployment-utils";

// ============================================================================
// Local Deployment Configuration
// ============================================================================

const LOCAL_DEPLOYMENT_CONFIG = {
  cluster: "localnet" as SolanaCluster,
  validatorConfig: {
    resetLedger: true,
    quiet: false,
    ledgerPath: "./ledger",
    logLevel: "info",
    rpcPort: 8899,
    gossipPort: 8001,
    dynamicPortRange: "8002-8020",
    limitLedgerSize: 100000000,
    accountsPath: "./accounts",
    snapshotsPath: "./snapshots",
  },
  initialFunding: {
    adminSol: 100,
    curatorSol: 10,
    testUserSol: 5,
    testTokenAmount: 1000000000000, // 1M tokens with 6 decimals
  },
  initialPools: {
    performancePool: {
      name: "Performance Rewards",
      totalRewards: 50,
      rewardType: "sol",
      distributionCriteria: "performance",
    },
    achievementPool: {
      name: "Achievement Rewards",
      totalRewards: 1000000000000, // 1M tokens
      rewardType: "spl-token",
      distributionCriteria: "achievement",
    },
    stakingPool: {
      name: "Staking Rewards",
      totalRewards: 365,
      rewardType: "sol",
      distributionCriteria: "staking",
    },
  },
  sampleData: {
    createSampleQuestions: true,
    createSampleTournaments: true,
    createSampleRewardPools: true,
    questionCount: 20,
    tournamentCount: 3,
  },
};

// ============================================================================
// Local Validator Management
// ============================================================================

class LocalValidatorManager {
  private config: typeof LOCAL_DEPLOYMENT_CONFIG.validatorConfig;
  private logger: DeploymentLogger;
  private validatorProcess: any = null;

  constructor(config: typeof LOCAL_DEPLOYMENT_CONFIG.validatorConfig, logger: DeploymentLogger) {
    this.config = config;
    this.logger = logger;
  }

  async startValidator(): Promise<void> {
    this.logger.info("Starting local Solana validator...");
    
    try {
      // Stop any existing validator
      this.stopValidator();
      
      // Clean up previous state if requested
      if (this.config.resetLedger) {
        this.cleanupLedger();
      }
      
      // Build the validator command
      const validatorCmd = this.buildValidatorCommand();
      
      this.logger.info("Starting validator with command:", { command: validatorCmd });
      
      // Start the validator process
      const { spawn } = require("child_process");
      this.validatorProcess = spawn("solana-test-validator", validatorCmd.split(" "), {
        stdio: this.config.quiet ? "pipe" : "inherit",
        detached: false,
      });
      
      // Handle validator process events
      this.validatorProcess.on("error", (error: any) => {
        this.logger.error("Validator process error:", { error: error.message });
      });
      
      this.validatorProcess.on("exit", (code: number) => {
        if (code !== 0) {
          this.logger.error(`Validator exited with code ${code}`);
        } else {
          this.logger.info("Validator stopped");
        }
      });
      
      // Wait for validator to be ready
      await this.waitForValidatorReady();
      
      this.logger.info("Local validator started successfully");
      
    } catch (error) {
      this.logger.error("Failed to start local validator", { error: error.message });
      throw error;
    }
  }

  private buildValidatorCommand(): string {
    const parts = [
      `--rpc-port ${this.config.rpcPort}`,
      `--gossip-port ${this.config.gossipPort}`,
      `--dynamic-port-range ${this.config.dynamicPortRange}`,
      `--limit-ledger-size ${this.config.limitLedgerSize}`,
      `--ledger ${this.config.ledgerPath}`,
      `--accounts ${this.config.accountsPath}`,
      `--snapshots ${this.config.snapshotsPath}`,
      `--log-level ${this.config.logLevel}`,
    ];
    
    if (this.config.resetLedger) {
      parts.push("--reset");
    }
    
    if (this.config.quiet) {
      parts.push("--quiet");
    }
    
    return parts.join(" ");
  }

  private async waitForValidatorReady(): Promise<void> {
    const connection = new Connection(`http://localhost:${this.config.rpcPort}`, "confirmed");
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const version = await connection.getVersion();
        this.logger.info("Validator ready", { version });
        return;
      } catch (error) {
        attempts++;
        this.logger.debug(`Waiting for validator... (${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    throw new Error("Validator failed to start within timeout");
  }

  private cleanupLedger(): void {
    this.logger.info("Cleaning up previous ledger state...");
    
    const pathsToClean = [
      this.config.ledgerPath,
      this.config.accountsPath,
      this.config.snapshotsPath,
    ];
    
    for (const dirPath of pathsToClean) {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.debug(`Cleaned up: ${dirPath}`);
      }
    }
  }

  stopValidator(): void {
    if (this.validatorProcess) {
      this.logger.info("Stopping local validator...");
      this.validatorProcess.kill("SIGTERM");
      this.validatorProcess = null;
    }
    
    // Also try to kill any running test validator processes
    try {
      execSync("pkill -f solana-test-validator", { stdio: "ignore" });
    } catch (error) {
      // Ignore errors - process might not be running
    }
  }
}

// ============================================================================
// Local Deployment Class
// ============================================================================

class LocalDeployment {
  private config: DeploymentConfig;
  private logger: DeploymentLogger;
  private validatorManager: LocalValidatorManager;
  private deploymentStartTime: Date;
  private deployedPrograms: DeployedPrograms | null = null;
  private testTokenMint: PublicKey | null = null;

  constructor() {
    // Override cluster to localnet
    process.env.SOLANA_CLUSTER = "localnet";
    
    this.config = loadEnvironmentConfig();
    this.logger = new DeploymentLoggerImpl(true, "./logs/deploy-local.log");
    this.validatorManager = new LocalValidatorManager(
      LOCAL_DEPLOYMENT_CONFIG.validatorConfig,
      this.logger
    );
    this.deploymentStartTime = new Date();
  }

  async deploy(): Promise<DeploymentResult> {
    this.logger.info("🚀 Starting TriviaComb Local Deployment");
    this.logger.info("Configuration:", {
      cluster: this.config.cluster,
      adminAuthority: this.config.adminAuthority.toString(),
      programKeypairsPath: this.config.programKeypairsPath,
    });

    try {
      // Step 1: Start local validator
      await this.validatorManager.startValidator();
      
      // Step 2: Prepare deployment environment
      await this.prepareEnvironment();
      
      // Step 3: Build programs
      await this.buildPrograms();
      
      // Step 4: Deploy programs
      await this.deployPrograms();
      
      // Step 5: Initialize contracts
      await this.initializeContracts();
      
      // Step 6: Configure initial state
      await this.configureInitialState();
      
      // Step 7: Create sample data
      await this.createSampleData();
      
      // Step 8: Final verification
      await this.verifyDeployment();
      
      const deploymentTime = Date.now() - this.deploymentStartTime.getTime();
      
      const result: DeploymentResult = {
        success: true,
        programs: this.deployedPrograms!,
        transactionSignatures: [], // Will be populated with actual signatures
        gasUsed: 0, // Will be calculated from actual transactions
        deploymentTime,
        errors: [],
      };
      
      this.logger.info("✅ Local deployment completed successfully", {
        duration: formatDuration(deploymentTime),
        programs: Object.keys(this.deployedPrograms!),
      });
      
      // Save deployment result
      const resultPath = `./deployments/local-${Date.now()}.json`;
      saveDeploymentResult(result, resultPath, this.logger);
      
      return result;
      
    } catch (error) {
      this.logger.error("❌ Local deployment failed", { error: error.message });
      
      const deploymentTime = Date.now() - this.deploymentStartTime.getTime();
      const result: DeploymentResult = {
        success: false,
        programs: {} as DeployedPrograms,
        transactionSignatures: [],
        gasUsed: 0,
        deploymentTime,
        errors: [error.message],
      };
      
      return result;
    }
  }

  private async prepareEnvironment(): Promise<void> {
    this.logger.info("📋 Preparing deployment environment...");
    
    // Ensure program keypairs exist
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    
    this.logger.info("Program keypairs prepared:", {
      questionBank: keypairs.questionBankKeypair.publicKey.toString(),
      tournamentManager: keypairs.tournamentManagerKeypair.publicKey.toString(),
      rewardDistributor: keypairs.rewardDistributorKeypair.publicKey.toString(),
    });
    
    // Fund admin account
    await airdropSol(
      this.config.connection,
      this.config.adminAuthority,
      LOCAL_DEPLOYMENT_CONFIG.initialFunding.adminSol,
      this.logger
    );
    
    // Fund curator accounts
    for (const curator of this.config.initialConfiguration.curators) {
      await airdropSol(
        this.config.connection,
        curator,
        LOCAL_DEPLOYMENT_CONFIG.initialFunding.curatorSol,
        this.logger
      );
    }
    
    // Create test token
    this.testTokenMint = await createTestToken(
      this.config.connection,
      this.config.payer,
      this.config.adminAuthority,
      this.config.initialConfiguration.tokenMintDecimals,
      this.logger
    );
    
    // Create token accounts for admin and curators
    await createTokenAccountAndMint(
      this.config.connection,
      this.config.payer,
      this.testTokenMint,
      this.config.adminAuthority,
      LOCAL_DEPLOYMENT_CONFIG.initialFunding.testTokenAmount,
      this.logger
    );
    
    for (const curator of this.config.initialConfiguration.curators) {
      await createTokenAccountAndMint(
        this.config.connection,
        this.config.payer,
        this.testTokenMint,
        curator,
        LOCAL_DEPLOYMENT_CONFIG.initialFunding.testTokenAmount / 10, // 10% of admin amount
        this.logger
      );
    }
    
    this.logger.info("✅ Environment prepared successfully");
  }

  private async buildPrograms(): Promise<void> {
    this.logger.info("🔨 Building programs...");
    
    try {
      // Build with optimizations for local deployment
      const buildCmd = "anchor build";
      this.logger.info("Executing build command:", { command: buildCmd });
      
      const buildOutput = execSync(buildCmd, { 
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      
      this.logger.info("Build completed", { output: buildOutput });
      
      // Verify build artifacts exist
      const targetDir = path.join(process.cwd(), "target", "deploy");
      const requiredFiles = [
        "question_bank.so",
        "tournament_manager.so",
        "reward_distributor.so",
      ];
      
      for (const file of requiredFiles) {
        const filePath = path.join(targetDir, file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Build artifact not found: ${file}`);
        }
      }
      
      this.logger.info("✅ Programs built successfully");
      
    } catch (error) {
      this.logger.error("❌ Build failed", { error: error.message });
      throw error;
    }
  }

  private async deployPrograms(): Promise<void> {
    this.logger.info("🚀 Deploying programs...");
    
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    
    try {
      // Deploy Question Bank
      await this.deployProgram(
        "question_bank",
        keypairs.questionBankKeypair,
        "./target/deploy/question_bank.so"
      );
      
      // Deploy Tournament Manager
      await this.deployProgram(
        "tournament_manager",
        keypairs.tournamentManagerKeypair,
        "./target/deploy/tournament_manager.so"
      );
      
      // Deploy Reward Distributor
      await this.deployProgram(
        "reward_distributor",
        keypairs.rewardDistributorKeypair,
        "./target/deploy/reward_distributor.so"
      );
      
      // Load deployed programs
      await this.loadDeployedPrograms();
      
      this.logger.info("✅ All programs deployed successfully");
      
    } catch (error) {
      this.logger.error("❌ Program deployment failed", { error: error.message });
      throw error;
    }
  }

  private async deployProgram(
    name: string,
    keypair: Keypair,
    binaryPath: string
  ): Promise<void> {
    this.logger.info(`Deploying ${name}...`, { programId: keypair.publicKey.toString() });
    
    try {
      // Deploy using solana CLI
      const deployCmd = `solana program deploy ${binaryPath} --program-id ${this.config.programKeypairsPath}/${name}-keypair.json --url ${this.config.connection.rpcEndpoint}`;
      
      this.logger.info("Executing deploy command:", { command: deployCmd });
      
      const deployOutput = execSync(deployCmd, { 
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      
      this.logger.info(`${name} deployed successfully`, { output: deployOutput });
      
      // Wait for account creation
      await waitForAccountCreation(
        this.config.connection,
        keypair.publicKey,
        30000,
        this.logger
      );
      
    } catch (error) {
      this.logger.error(`Failed to deploy ${name}`, { error: error.message });
      throw error;
    }
  }

  private async loadDeployedPrograms(): Promise<void> {
    this.logger.info("📥 Loading deployed programs...");
    
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    
    // Load Question Bank program
    const questionBankProgram = anchor.workspace.QuestionBank as Program<QuestionBank>;
    const [questionBankPda] = getQuestionBankPDA(keypairs.questionBankKeypair.publicKey);
    
    // Load Tournament Manager program
    const tournamentManagerProgram = anchor.workspace.TournamentManager as Program<TournamentManager>;
    const [tournamentManagerPda] = getTournamentManagerPDA(keypairs.tournamentManagerKeypair.publicKey);
    
    // Load Reward Distributor program
    const rewardDistributorProgram = anchor.workspace.RewardDistributor as Program<RewardDistributor>;
    
    this.deployedPrograms = {
      questionBank: {
        programId: keypairs.questionBankKeypair.publicKey,
        programKeypair: keypairs.questionBankKeypair,
        questionBankPda,
        program: questionBankProgram,
      },
      tournamentManager: {
        programId: keypairs.tournamentManagerKeypair.publicKey,
        programKeypair: keypairs.tournamentManagerKeypair,
        tournamentManagerPda,
        program: tournamentManagerProgram,
      },
      rewardDistributor: {
        programId: keypairs.rewardDistributorKeypair.publicKey,
        programKeypair: keypairs.rewardDistributorKeypair,
        program: rewardDistributorProgram,
      },
    };
    
    this.logger.info("✅ Programs loaded successfully");
  }

  private async initializeContracts(): Promise<void> {
    this.logger.info("🔧 Initializing contracts...");
    
    if (!this.deployedPrograms) {
      throw new Error("Programs not deployed");
    }
    
    // Initialize Question Bank
    await this.initializeQuestionBank();
    
    // Initialize Tournament Manager
    await this.initializeTournamentManager();
    
    // Initialize user reputations for admin and curators
    await this.initializeUserReputations();
    
    this.logger.info("✅ Contracts initialized successfully");
  }

  private async initializeQuestionBank(): Promise<void> {
    this.logger.info("Initializing Question Bank...");
    
    const { questionBank } = this.deployedPrograms!;
    
    try {
      const tx = await questionBank.program.methods
        .initializeQuestionBank(this.config.adminAuthority)
        .accounts({
          questionBank: questionBank.questionBankPda,
          payer: this.config.payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.config.payer])
        .rpc();
      
      this.logger.logTransaction(tx, "Question Bank initialized");
      
    } catch (error) {
      this.logger.error("Failed to initialize Question Bank", { error: error.message });
      throw error;
    }
  }

  private async initializeTournamentManager(): Promise<void> {
    this.logger.info("Initializing Tournament Manager...");
    
    const { tournamentManager } = this.deployedPrograms!;
    
    try {
      const tx = await tournamentManager.program.methods
        .initialize()
        .accounts({
          tournamentManager: tournamentManager.tournamentManagerPda,
          authority: this.config.adminAuthority,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.config.payer])
        .rpc();
      
      this.logger.logTransaction(tx, "Tournament Manager initialized");
      
    } catch (error) {
      this.logger.error("Failed to initialize Tournament Manager", { error: error.message });
      throw error;
    }
  }

  private async initializeUserReputations(): Promise<void> {
    this.logger.info("Initializing user reputations...");
    
    const { questionBank } = this.deployedPrograms!;
    const usersToInitialize = [this.config.adminAuthority, ...this.config.initialConfiguration.curators];
    
    for (const user of usersToInitialize) {
      try {
        const [userReputationPda] = getUserReputationPDA(user, questionBank.programId);
        
        const tx = await questionBank.program.methods
          .initializeUserReputation()
          .accounts({
            userReputation: userReputationPda,
            user: user,
            payer: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();
        
        this.logger.logTransaction(tx, `User reputation initialized for ${user.toString()}`);
        
      } catch (error) {
        this.logger.error(`Failed to initialize reputation for ${user.toString()}`, { error: error.message });
        throw error;
      }
    }
  }

  private async configureInitialState(): Promise<void> {
    this.logger.info("🔧 Configuring initial state...");
    
    // Add curators
    await this.addCurators();
    
    // Create initial reward pools
    await this.createInitialRewardPools();
    
    this.logger.info("✅ Initial state configured successfully");
  }

  private async addCurators(): Promise<void> {
    this.logger.info("Adding curators...");
    
    const { questionBank } = this.deployedPrograms!;
    
    for (const curator of this.config.initialConfiguration.curators) {
      try {
        const tx = await questionBank.program.methods
          .addCurator(curator)
          .accounts({
            questionBank: questionBank.questionBankPda,
            authority: this.config.adminAuthority,
          })
          .signers([this.config.payer])
          .rpc();
        
        this.logger.logTransaction(tx, `Curator added: ${curator.toString()}`);
        
      } catch (error) {
        this.logger.error(`Failed to add curator: ${curator.toString()}`, { error: error.message });
        throw error;
      }
    }
  }

  private async createInitialRewardPools(): Promise<void> {
    this.logger.info("Creating initial reward pools...");
    
    const { rewardDistributor } = this.deployedPrograms!;
    const pools = LOCAL_DEPLOYMENT_CONFIG.initialPools;
    
    let poolId = 1;
    
    // Create SOL performance pool
    await this.createRewardPool(poolId++, {
      name: pools.performancePool.name,
      totalRewards: new BN(pools.performancePool.totalRewards * LAMPORTS_PER_SOL),
      rewardType: { sol: {} },
      tokenMint: null,
      distributionCriteria: { performanceBased: {} },
      startTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60), // 30 days
    });
    
    // Create token achievement pool
    await this.createRewardPool(poolId++, {
      name: pools.achievementPool.name,
      totalRewards: new BN(pools.achievementPool.totalRewards),
      rewardType: { splToken: {} },
      tokenMint: this.testTokenMint,
      distributionCriteria: { achievementBased: {} },
      startTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60), // 60 days
    });
    
    // Create SOL staking pool
    await this.createRewardPool(poolId++, {
      name: pools.stakingPool.name,
      totalRewards: new BN(pools.stakingPool.totalRewards * LAMPORTS_PER_SOL),
      rewardType: { sol: {} },
      tokenMint: null,
      distributionCriteria: { stakingRewards: {} },
      startTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60), // 365 days
    });
  }

  private async createRewardPool(poolId: number, config: any): Promise<void> {
    this.logger.info(`Creating reward pool ${poolId}: ${config.name}...`);
    
    const { rewardDistributor } = this.deployedPrograms!;
    
    try {
      const poolData = {
        id: new BN(poolId),
        name: config.name,
        totalRewards: config.totalRewards,
        rewardType: config.rewardType,
        tokenMint: config.tokenMint,
        distributionCriteria: config.distributionCriteria,
        startTime: config.startTime,
        endTime: config.endTime,
      };
      
      const [rewardPoolPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), poolId.toString().padStart(8, '0')],
        rewardDistributor.programId
      );
      
      const [rewardVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), poolId.toString().padStart(8, '0')],
        rewardDistributor.programId
      );
      
      const initialFunding = config.rewardType.sol 
        ? config.totalRewards.div(new BN(10)) // 10% initial funding
        : config.totalRewards.div(new BN(100)); // 1% initial funding for tokens
      
      const tx = await rewardDistributor.program.methods
        .createRewardPool(poolData, initialFunding)
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: this.config.adminAuthority,
          authorityTokenAccount: config.tokenMint ? null : null, // Will be handled properly in real implementation
          rewardVaultToken: config.tokenMint ? null : null,
          tokenMint: config.tokenMint,
          tokenProgram: config.tokenMint ? TOKEN_PROGRAM_ID : null,
          associatedTokenProgram: config.tokenMint ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.config.payer])
        .rpc();
      
      this.logger.logTransaction(tx, `Reward pool ${poolId} created: ${config.name}`);
      
    } catch (error) {
      this.logger.error(`Failed to create reward pool ${poolId}`, { error: error.message });
      throw error;
    }
  }

  private async createSampleData(): Promise<void> {
    if (!LOCAL_DEPLOYMENT_CONFIG.sampleData.createSampleQuestions) {
      return;
    }
    
    this.logger.info("🎯 Creating sample data...");
    
    // Create sample questions
    await this.createSampleQuestions();
    
    // Create sample tournaments
    await this.createSampleTournaments();
    
    this.logger.info("✅ Sample data created successfully");
  }

  private async createSampleQuestions(): Promise<void> {
    this.logger.info("Creating sample questions...");
    
    const { questionBank } = this.deployedPrograms!;
    const questionCount = LOCAL_DEPLOYMENT_CONFIG.sampleData.questionCount;
    
    const sampleQuestions = [
      {
        questionText: "What is the capital of France?",
        options: ["London", "Berlin", "Paris", "Madrid"],
        correctAnswer: 2,
        category: "Geography",
        difficulty: 1,
      },
      {
        questionText: "Which planet is known as the Red Planet?",
        options: ["Venus", "Mars", "Jupiter", "Saturn"],
        correctAnswer: 1,
        category: "Science",
        difficulty: 1,
      },
      {
        questionText: "Who painted the Mona Lisa?",
        options: ["Van Gogh", "Picasso", "Da Vinci", "Monet"],
        correctAnswer: 2,
        category: "Art",
        difficulty: 2,
      },
      {
        questionText: "What is the time complexity of binary search?",
        options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
        correctAnswer: 1,
        category: "Computer Science",
        difficulty: 3,
      },
      {
        questionText: "Which year did World War II end?",
        options: ["1944", "1945", "1946", "1947"],
        correctAnswer: 1,
        category: "History",
        difficulty: 2,
      },
    ];
    
    for (let i = 0; i < Math.min(questionCount, sampleQuestions.length); i++) {
      const question = sampleQuestions[i];
      
      try {
        const questionBank_account = await questionBank.program.account.questionBank.fetch(
          questionBank.questionBankPda
        );
        
        const questionId = questionBank_account.totalQuestions.toNumber();
        const [questionPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("question"), new BN(questionId).toArrayLike(Buffer, "le", 8)],
          questionBank.programId
        );
        
        const [userReputationPda] = getUserReputationPDA(
          this.config.adminAuthority,
          questionBank.programId
        );
        
        const tx = await questionBank.program.methods
          .submitQuestion({
            questionText: question.questionText,
            options: question.options,
            correctAnswer: question.correctAnswer,
            category: question.category,
            difficulty: question.difficulty,
          })
          .accounts({
            question: questionPda,
            questionBank: questionBank.questionBankPda,
            userReputation: userReputationPda,
            submitter: this.config.adminAuthority,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();
        
        this.logger.logTransaction(tx, `Sample question ${i + 1} submitted: ${question.questionText}`);
        
      } catch (error) {
        this.logger.error(`Failed to create sample question ${i + 1}`, { error: error.message });
        // Continue with other questions
      }
    }
  }

  private async createSampleTournaments(): Promise<void> {
    this.logger.info("Creating sample tournaments...");
    
    const { tournamentManager } = this.deployedPrograms!;
    const tournamentCount = LOCAL_DEPLOYMENT_CONFIG.sampleData.tournamentCount;
    
    const sampleTournaments = [
      {
        name: "Daily Trivia Challenge",
        description: "Test your knowledge across various topics",
        entryFee: new BN(0.1 * LAMPORTS_PER_SOL),
        prizePool: new BN(5 * LAMPORTS_PER_SOL),
        maxParticipants: 50,
        questionCount: 10,
        category: "Mixed",
        difficulty: null,
        duration: new BN(30 * 60), // 30 minutes
      },
      {
        name: "Science Specialists",
        description: "Advanced science questions for experts",
        entryFee: new BN(0.5 * LAMPORTS_PER_SOL),
        prizePool: new BN(20 * LAMPORTS_PER_SOL),
        maxParticipants: 25,
        questionCount: 15,
        category: "Science",
        difficulty: 3,
        duration: new BN(45 * 60), // 45 minutes
      },
      {
        name: "Geography Masters",
        description: "Explore the world through trivia",
        entryFee: new BN(0.2 * LAMPORTS_PER_SOL),
        prizePool: new BN(8 * LAMPORTS_PER_SOL),
        maxParticipants: 30,
        questionCount: 12,
        category: "Geography",
        difficulty: 2,
        duration: new BN(25 * 60), // 25 minutes
      },
    ];
    
    for (let i = 0; i < Math.min(tournamentCount, sampleTournaments.length); i++) {
      const tournament = sampleTournaments[i];
      
      try {
        const tournamentManager_account = await tournamentManager.program.account.tournamentManagerState.fetch(
          tournamentManager.tournamentManagerPda
        );
        
        const tournamentId = tournamentManager_account.tournamentCount.toNumber();
        const [tournamentPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("tournament"), new BN(tournamentId).toArrayLike(Buffer, "le", 8)],
          tournamentManager.programId
        );
        
        const startTime = Math.floor(Date.now() / 1000) + (i + 1) * 3600; // Stagger start times
        
        const tx = await tournamentManager.program.methods
          .createTournament(
            tournament.name,
            tournament.description,
            tournament.entryFee,
            tournament.prizePool,
            tournament.maxParticipants,
            new BN(startTime),
            tournament.duration,
            tournament.questionCount,
            tournament.category,
            tournament.difficulty
          )
          .accounts({
            tournament: tournamentPda,
            tournamentManager: tournamentManager.tournamentManagerPda,
            organizer: this.config.adminAuthority,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.config.payer])
          .rpc();
        
        this.logger.logTransaction(tx, `Sample tournament ${i + 1} created: ${tournament.name}`);
        
      } catch (error) {
        this.logger.error(`Failed to create sample tournament ${i + 1}`, { error: error.message });
        // Continue with other tournaments
      }
    }
  }

  private async verifyDeployment(): Promise<void> {
    this.logger.info("🔍 Verifying deployment...");
    
    if (!this.deployedPrograms) {
      throw new Error("No programs deployed");
    }
    
    // Verify Question Bank
    const questionBank_account = await this.deployedPrograms.questionBank.program.account.questionBank.fetch(
      this.deployedPrograms.questionBank.questionBankPda
    );
    
    if (!questionBank_account.authority.equals(this.config.adminAuthority)) {
      throw new Error("Question Bank authority mismatch");
    }
    
    // Verify Tournament Manager
    const tournamentManager_account = await this.deployedPrograms.tournamentManager.program.account.tournamentManagerState.fetch(
      this.deployedPrograms.tournamentManager.tournamentManagerPda
    );
    
    if (!tournamentManager_account.authority.equals(this.config.adminAuthority)) {
      throw new Error("Tournament Manager authority mismatch");
    }
    
    this.logger.info("✅ Deployment verification completed successfully");
  }

  async cleanup(): Promise<void> {
    this.logger.info("🧹 Cleaning up local deployment...");
    
    // Stop local validator
    this.validatorManager.stopValidator();
    
    this.logger.info("✅ Cleanup completed");
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  const deployment = new LocalDeployment();
  
  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Received SIGINT, cleaning up...");
    await deployment.cleanup();
    process.exit(0);
  });
  
  process.on("SIGTERM", async () => {
    console.log("\n🛑 Received SIGTERM, cleaning up...");
    await deployment.cleanup();
    process.exit(0);
  });
  
  try {
    const result = await deployment.deploy();
    
    if (result.success) {
      console.log("\n🎉 Local deployment completed successfully!");
      console.log("📋 Deployment Summary:");
      console.log(`  Duration: ${formatDuration(result.deploymentTime)}`);
      console.log(`  Programs: ${Object.keys(result.programs).length}`);
      console.log(`  Gas Used: ${result.gasUsed} lamports`);
      console.log("\n🔗 Program IDs:");
      for (const [name, program] of Object.entries(result.programs)) {
        console.log(`  ${name}: ${program.programId.toString()}`);
      }
      console.log("\n🌐 Local RPC: http://localhost:8899");
      console.log("💡 Keep this terminal open to maintain the local validator");
      console.log("💡 Use Ctrl+C to stop the validator and cleanup");
      
      // Keep the process running
      await new Promise(() => {});
    } else {
      console.error("\n❌ Local deployment failed!");
      console.error("Errors:", result.errors);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Deployment crashed:", error.message);
    await deployment.cleanup();
    process.exit(1);
  }
}

// Execute if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { LocalDeployment };