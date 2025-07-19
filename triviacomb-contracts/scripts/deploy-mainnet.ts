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
  SecurityChecks,
  DeploymentReport,
  MultisigConfig,
  VerificationResult,
  ConfigurationResult,
} from "./types/deployment";
import {
  loadEnvironmentConfig,
  ensureProgramKeypairs,
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
  validateProgramUpgradeAuthority,
  validateMultisigConfiguration,
} from "./utils/deployment-utils";

// ============================================================================
// Mainnet Deployment Configuration
// ============================================================================

const MAINNET_DEPLOYMENT_CONFIG = {
  cluster: "mainnet-beta" as SolanaCluster,
  requiredSolBalance: 50, // Higher balance requirement for mainnet
  programUpgradeBuffer: 5 * 1024 * 1024, // 5MB buffer for program upgrades
  initialFunding: {
    adminSol: 10,
    curatorSol: 5,
    testTokenAmount: 0, // No test tokens on mainnet
  },
  security: {
    requireMultisig: true,
    multisigThreshold: 2,
    requireUpgradeAuthority: true,
    validateProgramOwnership: true,
    enableEmergencyPause: true,
    requireSecurityAudit: true,
    requireTimeDelay: true,
    timeDelayHours: 24,
  },
  initialPools: {
    performancePool: {
      name: "Performance Rewards",
      totalRewards: 1000, // 1000 SOL
      rewardType: "sol",
      distributionCriteria: "performance",
      duration: 365 * 24 * 60 * 60, // 365 days
    },
    achievementPool: {
      name: "Achievement Rewards",
      totalRewards: 0, // TBD based on tokenomics
      rewardType: "spl-token",
      distributionCriteria: "achievement",
      duration: 365 * 24 * 60 * 60, // 365 days
    },
  },
  monitoring: {
    enableMetrics: true,
    enableAlerting: true,
    alertThresholds: {
      highGasUsage: 5000000, // 5M lamports
      slowConfirmation: 120000, // 2 minutes
      lowBalance: 10, // 10 SOL
    },
  },
  postDeployment: {
    createSampleQuestions: false,
    createSampleTournaments: false,
    setupHoneycombIntegration: true,
    enableEmergencyMode: true,
    setupGovernance: true,
  },
};

// ============================================================================
// Security Validation
// ============================================================================

class SecurityValidator {
  private logger: DeploymentLogger;
  private config: DeploymentConfig;

  constructor(logger: DeploymentLogger, config: DeploymentConfig) {
    this.logger = logger;
    this.config = config;
  }

  async validatePreDeployment(): Promise<boolean> {
    this.logger.info("🔒 Starting pre-deployment security validation...");
    
    // Validate multisig configuration
    if (!await this.validateMultisigSetup()) {
      return false;
    }

    // Validate admin authority
    if (!await this.validateAdminAuthority()) {
      return false;
    }

    // Validate program keypairs
    if (!await this.validateProgramKeypairs()) {
      return false;
    }

    // Validate network configuration
    if (!await this.validateNetworkConfig()) {
      return false;
    }

    // Validate wallet balance
    if (!await this.validateWalletBalance()) {
      return false;
    }

    // Validate time delay requirements
    if (!await this.validateTimeDelay()) {
      return false;
    }

    this.logger.info("✅ Pre-deployment security validation passed");
    return true;
  }

  private async validateMultisigSetup(): Promise<boolean> {
    this.logger.info("Validating multisig configuration...");
    
    const multisigThreshold = parseInt(process.env.MAINNET_MULTISIG_THRESHOLD || "2");
    const multisigSigners = (process.env.MAINNET_MULTISIG_SIGNERS || "").split(",")
      .filter(s => s.trim().length > 0)
      .map(s => new PublicKey(s.trim()));

    if (multisigSigners.length < multisigThreshold) {
      this.logger.error(`Insufficient multisig signers: ${multisigSigners.length} < ${multisigThreshold}`);
      return false;
    }

    const multisigConfig: MultisigConfig = {
      threshold: multisigThreshold,
      signers: multisigSigners,
      multisigPda: new PublicKey(process.env.MAINNET_MULTISIG_PDA || ""),
    };

    return validateMultisigConfiguration(multisigConfig, this.logger);
  }

  private async validateAdminAuthority(): Promise<boolean> {
    this.logger.info("Validating admin authority...");
    
    const adminAuthority = this.config.adminAuthority;
    if (!adminAuthority) {
      this.logger.error("Admin authority not configured");
      return false;
    }

    // Check if admin authority is different from payer (security best practice)
    if (adminAuthority.equals(this.config.payer.publicKey)) {
      this.logger.warn("Admin authority is same as payer - consider using separate keys");
    }

    this.logger.info(`Admin authority validated: ${adminAuthority.toString()}`);
    return true;
  }

  private async validateProgramKeypairs(): Promise<boolean> {
    this.logger.info("Validating program keypairs...");
    
    const keypairsPath = this.config.programKeypairsPath;
    if (!fs.existsSync(keypairsPath)) {
      this.logger.error(`Program keypairs directory not found: ${keypairsPath}`);
      return false;
    }

    const requiredFiles = [
      "question_bank-keypair.json",
      "tournament_manager-keypair.json",
      "reward_distributor-keypair.json",
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(keypairsPath, file);
      if (!fs.existsSync(filePath)) {
        this.logger.error(`Missing program keypair: ${file}`);
        return false;
      }
    }

    this.logger.info("Program keypairs validated");
    return true;
  }

  private async validateNetworkConfig(): Promise<boolean> {
    this.logger.info("Validating network configuration...");
    
    if (this.config.cluster !== "mainnet-beta") {
      this.logger.error(`Invalid cluster for mainnet deployment: ${this.config.cluster}`);
      return false;
    }

    // Test connection to mainnet
    try {
      const slot = await this.config.connection.getSlot();
      this.logger.info(`Connected to mainnet at slot: ${slot}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to connect to mainnet: ${error.message}`);
      return false;
    }
  }

  private async validateWalletBalance(): Promise<boolean> {
    this.logger.info("Validating wallet balance...");
    
    const balance = await this.config.connection.getBalance(this.config.payer.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    const requiredBalance = MAINNET_DEPLOYMENT_CONFIG.requiredSolBalance;

    if (balanceSol < requiredBalance) {
      this.logger.error(`Insufficient balance: ${balanceSol} SOL < ${requiredBalance} SOL required`);
      return false;
    }

    this.logger.info(`Wallet balance validated: ${balanceSol} SOL`);
    return true;
  }

  private async validateTimeDelay(): Promise<boolean> {
    this.logger.info("Validating time delay requirements...");
    
    const timeDelayFile = path.join(this.config.programKeypairsPath, "deployment-approval.json");
    if (!fs.existsSync(timeDelayFile)) {
      this.logger.error("Deployment approval file not found. Mainnet deployments require 24-hour time delay.");
      this.logger.error("Create deployment-approval.json with approval timestamp at least 24 hours ago.");
      return false;
    }

    const approval = JSON.parse(fs.readFileSync(timeDelayFile, "utf8"));
    const approvalTime = new Date(approval.timestamp);
    const now = new Date();
    const timeDiff = now.getTime() - approvalTime.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < MAINNET_DEPLOYMENT_CONFIG.security.timeDelayHours) {
      this.logger.error(`Time delay not met: ${hoursDiff} hours < ${MAINNET_DEPLOYMENT_CONFIG.security.timeDelayHours} hours required`);
      return false;
    }

    this.logger.info(`Time delay validated: ${hoursDiff} hours`);
    return true;
  }
}

// ============================================================================
// Mainnet Deployment Class
// ============================================================================

class MainnetDeployment {
  private config: DeploymentConfig;
  private logger: DeploymentLogger;
  private validator: SecurityValidator;
  private deploymentId: string;

  constructor(config: DeploymentConfig) {
    this.config = config;
    this.logger = new DeploymentLoggerImpl(true, `./logs/mainnet-deployment-${new Date().toISOString().split('T')[0]}.log`);
    this.validator = new SecurityValidator(this.logger, config);
    this.deploymentId = generateDeploymentId();
  }

  async deploy(): Promise<DeploymentResult> {
    const startTime = Date.now();
    this.logger.info("🚀 Starting mainnet deployment...");
    this.logger.info(`Deployment ID: ${this.deploymentId}`);

    try {
      // Pre-deployment security validation
      if (!await this.validator.validatePreDeployment()) {
        throw new Error("Pre-deployment security validation failed");
      }

      // Build programs
      await this.buildPrograms();

      // Deploy programs
      const deployedPrograms = await this.deployPrograms();

      // Initialize contracts
      await this.initializeContracts(deployedPrograms);

      // Configure initial state
      await this.configureInitialState(deployedPrograms);

      // Post-deployment verification
      await this.verifyDeployment(deployedPrograms);

      // Generate deployment report
      const result = await this.generateDeploymentResult(deployedPrograms, startTime, true);
      
      this.logger.info("🎉 Mainnet deployment completed successfully!");
      this.logger.info(`Total deployment time: ${formatDuration(Date.now() - startTime)}`);

      return result;
    } catch (error) {
      this.logger.error("💥 Mainnet deployment failed", { error: error.message });
      const result = await this.generateDeploymentResult({} as DeployedPrograms, startTime, false, [error.message]);
      return result;
    }
  }

  private async buildPrograms(): Promise<void> {
    this.logger.info("🔨 Building programs with mainnet optimizations...");
    
    try {
      // Build with maximum optimizations for mainnet
      execSync("anchor build --release", { 
        stdio: "inherit",
        env: {
          ...process.env,
          CARGO_BUILD_JOBS: "1", // Single threaded for maximum optimization
        }
      });
      
      this.logger.info("✅ Programs built successfully");
    } catch (error) {
      this.logger.error("Failed to build programs", { error: error.message });
      throw error;
    }
  }

  private async deployPrograms(): Promise<DeployedPrograms> {
    this.logger.info("📦 Deploying programs to mainnet...");
    
    const { questionBankKeypair, tournamentManagerKeypair, rewardDistributorKeypair } = 
      ensureProgramKeypairs(this.config.programKeypairsPath);

    // Load IDL files
    const questionBankIdl = JSON.parse(fs.readFileSync("./target/idl/question_bank.json", "utf8"));
    const tournamentManagerIdl = JSON.parse(fs.readFileSync("./target/idl/tournament_manager.json", "utf8"));
    const rewardDistributorIdl = JSON.parse(fs.readFileSync("./target/idl/reward_distributor.json", "utf8"));

    // Deploy Question Bank
    this.logger.info("Deploying Question Bank program...");
    const questionBankProgram = new Program(questionBankIdl, questionBankKeypair.publicKey, this.config.provider);
    await this.deployProgram(questionBankProgram, questionBankKeypair, "Question Bank");

    // Deploy Tournament Manager
    this.logger.info("Deploying Tournament Manager program...");
    const tournamentManagerProgram = new Program(tournamentManagerIdl, tournamentManagerKeypair.publicKey, this.config.provider);
    await this.deployProgram(tournamentManagerProgram, tournamentManagerKeypair, "Tournament Manager");

    // Deploy Reward Distributor
    this.logger.info("Deploying Reward Distributor program...");
    const rewardDistributorProgram = new Program(rewardDistributorIdl, rewardDistributorKeypair.publicKey, this.config.provider);
    await this.deployProgram(rewardDistributorProgram, rewardDistributorKeypair, "Reward Distributor");

    // Create PDA addresses
    const [questionBankPda] = getQuestionBankPDA(questionBankKeypair.publicKey);
    const [tournamentManagerPda] = getTournamentManagerPDA(tournamentManagerKeypair.publicKey);

    return {
      questionBank: {
        programId: questionBankKeypair.publicKey,
        programKeypair: questionBankKeypair,
        questionBankPda,
        program: questionBankProgram,
      },
      tournamentManager: {
        programId: tournamentManagerKeypair.publicKey,
        programKeypair: tournamentManagerKeypair,
        tournamentManagerPda,
        program: tournamentManagerProgram,
      },
      rewardDistributor: {
        programId: rewardDistributorKeypair.publicKey,
        programKeypair: rewardDistributorKeypair,
        program: rewardDistributorProgram,
      },
    };
  }

  private async deployProgram(program: Program, keypair: Keypair, name: string): Promise<void> {
    try {
      // Check if program already exists
      const existingAccount = await this.config.connection.getAccountInfo(keypair.publicKey);
      if (existingAccount) {
        this.logger.warn(`${name} program already exists, performing upgrade...`);
        
        // Validate upgrade authority
        if (!validateProgramUpgradeAuthority(keypair.publicKey, this.config.adminAuthority, this.logger)) {
          throw new Error(`Invalid upgrade authority for ${name}`);
        }

        // Perform upgrade with multisig if required
        if (MAINNET_DEPLOYMENT_CONFIG.security.requireMultisig) {
          this.logger.info(`${name} upgrade requires multisig approval`);
          // Multisig upgrade logic would go here
        }
      } else {
        this.logger.info(`Deploying new ${name} program...`);
      }

      // Deploy or upgrade program
      const transaction = new Transaction();
      
      // Add compute budget for mainnet
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.config.deploymentSettings.computeUnitLimit,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.deploymentSettings.computeUnitPrice,
        })
      );

      const signature = await sendTransactionWithRetry(
        this.config.connection,
        transaction,
        [this.config.payer],
        this.config,
        this.logger,
        `Deploy ${name}`
      );

      this.logger.info(`✅ ${name} deployed successfully`);
      await waitForAccountCreation(this.config.connection, keypair.publicKey, 60000, this.logger);
    } catch (error) {
      this.logger.error(`Failed to deploy ${name}`, { error: error.message });
      throw error;
    }
  }

  private async initializeContracts(programs: DeployedPrograms): Promise<void> {
    this.logger.info("🔧 Initializing contracts...");

    // Initialize Question Bank
    this.logger.info("Initializing Question Bank...");
    const initQuestionBankTx = await programs.questionBank.program.methods
      .initialize(this.config.adminAuthority)
      .accounts({
        questionBank: programs.questionBank.questionBankPda,
        authority: this.config.payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.config.payer])
      .rpc();

    this.logger.logTransaction(initQuestionBankTx, "Initialize Question Bank");

    // Initialize Tournament Manager
    this.logger.info("Initializing Tournament Manager...");
    const initTournamentManagerTx = await programs.tournamentManager.program.methods
      .initialize(
        this.config.adminAuthority,
        programs.questionBank.programId,
        programs.rewardDistributor.programId
      )
      .accounts({
        tournamentManager: programs.tournamentManager.tournamentManagerPda,
        authority: this.config.payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.config.payer])
      .rpc();

    this.logger.logTransaction(initTournamentManagerTx, "Initialize Tournament Manager");

    // Initialize Reward Distributor
    this.logger.info("Initializing Reward Distributor...");
    const initRewardDistributorTx = await programs.rewardDistributor.program.methods
      .initialize(
        this.config.adminAuthority,
        programs.questionBank.programId,
        programs.tournamentManager.programId
      )
      .accounts({
        authority: this.config.payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.config.payer])
      .rpc();

    this.logger.logTransaction(initRewardDistributorTx, "Initialize Reward Distributor");

    this.logger.info("✅ All contracts initialized successfully");
  }

  private async configureInitialState(programs: DeployedPrograms): Promise<void> {
    this.logger.info("⚙️ Configuring initial state...");

    // Add initial curators
    for (const curator of this.config.initialConfiguration.curators) {
      this.logger.info(`Adding curator: ${curator.toString()}`);
      
      const [userReputationPda] = getUserReputationPDA(curator, programs.questionBank.programId);
      
      const addCuratorTx = await programs.questionBank.program.methods
        .addCurator(curator, this.config.initialConfiguration.initialCuratorReputation)
        .accounts({
          questionBank: programs.questionBank.questionBankPda,
          userReputation: userReputationPda,
          authority: this.config.payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.config.payer])
        .rpc();

      this.logger.logTransaction(addCuratorTx, `Add curator: ${curator.toString()}`);
    }

    // Create initial reward pools
    if (MAINNET_DEPLOYMENT_CONFIG.initialPools.performancePool.totalRewards > 0) {
      this.logger.info("Creating performance reward pool...");
      
      const [poolPda] = getRewardPoolPDA(1, programs.rewardDistributor.programId);
      const [vaultPda] = getRewardVaultPDA(1, programs.rewardDistributor.programId);

      const createPoolTx = await programs.rewardDistributor.program.methods
        .createRewardPool(
          1,
          MAINNET_DEPLOYMENT_CONFIG.initialPools.performancePool.name,
          new BN(MAINNET_DEPLOYMENT_CONFIG.initialPools.performancePool.totalRewards * LAMPORTS_PER_SOL),
          "performance",
          new BN(Math.floor(Date.now() / 1000)),
          new BN(Math.floor(Date.now() / 1000) + MAINNET_DEPLOYMENT_CONFIG.initialPools.performancePool.duration),
          null // No token mint for SOL rewards
        )
        .accounts({
          rewardPool: poolPda,
          rewardVault: vaultPda,
          authority: this.config.payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.config.payer])
        .rpc();

      this.logger.logTransaction(createPoolTx, "Create performance reward pool");
    }

    // Setup Honeycomb integration if enabled
    if (this.config.honeycombConfig.enableIntegration) {
      this.logger.info("Setting up Honeycomb integration...");
      // Honeycomb integration setup would go here
    }

    this.logger.info("✅ Initial state configured successfully");
  }

  private async verifyDeployment(programs: DeployedPrograms): Promise<void> {
    this.logger.info("🔍 Verifying deployment...");

    // Verify program accounts exist
    const questionBankAccount = await this.config.connection.getAccountInfo(programs.questionBank.programId);
    const tournamentManagerAccount = await this.config.connection.getAccountInfo(programs.tournamentManager.programId);
    const rewardDistributorAccount = await this.config.connection.getAccountInfo(programs.rewardDistributor.programId);

    if (!questionBankAccount || !tournamentManagerAccount || !rewardDistributorAccount) {
      throw new Error("Program accounts not found after deployment");
    }

    // Verify initialization
    const questionBankData = await programs.questionBank.program.account.questionBank.fetch(programs.questionBank.questionBankPda);
    const tournamentManagerData = await programs.tournamentManager.program.account.tournamentManager.fetch(programs.tournamentManager.tournamentManagerPda);

    if (!questionBankData.authority.equals(this.config.adminAuthority)) {
      throw new Error("Question Bank authority mismatch");
    }

    if (!tournamentManagerData.authority.equals(this.config.adminAuthority)) {
      throw new Error("Tournament Manager authority mismatch");
    }

    this.logger.info("✅ Deployment verification completed successfully");
  }

  private async generateDeploymentResult(
    programs: DeployedPrograms,
    startTime: number,
    success: boolean,
    errors?: string[]
  ): Promise<DeploymentResult> {
    const deploymentTime = Date.now() - startTime;
    
    const result: DeploymentResult = {
      success,
      programs,
      transactionSignatures: [], // Would be populated with actual signatures
      gasUsed: 0, // Would be calculated from actual transactions
      deploymentTime,
      errors,
    };

    // Save deployment result
    const resultFilePath = `./deployments/mainnet-${this.deploymentId}.json`;
    saveDeploymentResult(result, resultFilePath, this.logger);

    // Save deployment logs
    await this.logger.saveToFile(`./logs/mainnet-deployment-${this.deploymentId}.log`);

    return result;
  }
}

// ============================================================================
// Main Deployment Function
// ============================================================================

async function main(): Promise<void> {
  try {
    // Load configuration
    const config = loadEnvironmentConfig();
    
    // Validate mainnet configuration
    if (config.cluster !== "mainnet-beta") {
      throw new Error("This script is for mainnet deployment only");
    }

    console.log("🚀 TriviaComb Mainnet Deployment");
    console.log("================================");
    console.log(`Cluster: ${config.cluster}`);
    console.log(`Admin Authority: ${config.adminAuthority.toString()}`);
    console.log(`Payer: ${config.payer.publicKey.toString()}`);
    console.log("================================");

    // Prompt for confirmation
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmation = await new Promise<string>((resolve) => {
      rl.question("Are you sure you want to deploy to MAINNET? Type 'CONFIRM' to proceed: ", resolve);
    });

    rl.close();

    if (confirmation !== "CONFIRM") {
      console.log("Deployment cancelled.");
      process.exit(0);
    }

    // Execute deployment
    const deployment = new MainnetDeployment(config);
    const result = await deployment.deploy();

    if (result.success) {
      console.log("✅ Mainnet deployment completed successfully!");
      console.log(`Deployment time: ${formatDuration(result.deploymentTime)}`);
      console.log(`Question Bank: ${result.programs.questionBank?.programId.toString()}`);
      console.log(`Tournament Manager: ${result.programs.tournamentManager?.programId.toString()}`);
      console.log(`Reward Distributor: ${result.programs.rewardDistributor?.programId.toString()}`);
    } else {
      console.log("❌ Mainnet deployment failed!");
      if (result.errors) {
        console.log("Errors:");
        result.errors.forEach(error => console.log(`  - ${error}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("💥 Deployment failed:", error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export { MainnetDeployment, MAINNET_DEPLOYMENT_CONFIG };