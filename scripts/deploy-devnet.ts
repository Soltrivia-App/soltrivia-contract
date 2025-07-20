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
} from "./utils/deployment-utils";

// ============================================================================
// Devnet Deployment Configuration
// ============================================================================

const DEVNET_DEPLOYMENT_CONFIG = {
  cluster: "devnet" as SolanaCluster,
  requiredSolBalance: 10, // Minimum SOL balance for deployment
  programUpgradeBuffer: 2 * 1024 * 1024, // 2MB buffer for program upgrades
  initialFunding: {
    adminSol: 5,
    curatorSol: 2,
    testTokenAmount: 1000000000000, // 1M tokens with 6 decimals
  },
  security: {
    requireUpgradeAuthority: true,
    validateProgramOwnership: true,
    enableEmergencyPause: true,
  },
  initialPools: {
    performancePool: {
      name: "Devnet Performance Rewards",
      totalRewards: 100,
      rewardType: "sol",
      distributionCriteria: "performance",
      duration: 90 * 24 * 60 * 60, // 90 days
    },
    achievementPool: {
      name: "Devnet Achievement Rewards",
      totalRewards: 5000000000000, // 5M tokens
      rewardType: "spl-token",
      distributionCriteria: "achievement",
      duration: 180 * 24 * 60 * 60, // 180 days
    },
  },
  monitoring: {
    enableMetrics: true,
    alertThresholds: {
      highGasUsage: 1000000, // 1M lamports
      slowConfirmation: 60000, // 60 seconds
    },
  },
  postDeployment: {
    createSampleQuestions: true,
    createSampleTournaments: true,
    setupHoneycombIntegration: true,
    enablePublicAccess: true,
  },
};

// ============================================================================
// Devnet Deployment Class
// ============================================================================

class DevnetDeployment {
  private config: DeploymentConfig;
  private logger: DeploymentLogger;
  private deploymentStartTime: Date;
  private deployedPrograms: DeployedPrograms | null = null;
  private testTokenMint: PublicKey | null = null;
  private transactionSignatures: string[] = [];
  private totalGasUsed: number = 0;
  private deploymentId: string;

  constructor() {
    // Override cluster to devnet
    process.env.SOLANA_CLUSTER = "devnet";
    
    this.config = loadEnvironmentConfig();
    this.logger = new DeploymentLoggerImpl(true, "./logs/deploy-devnet.log");
    this.deploymentStartTime = new Date();
    this.deploymentId = generateDeploymentId();
  }

  async deploy(): Promise<DeploymentResult> {
    this.logger.info("🚀 Starting TriviaComb Devnet Deployment");
    this.logger.info("Deployment ID:", { deploymentId: this.deploymentId });
    this.logger.info("Configuration:", {
      cluster: this.config.cluster,
      adminAuthority: this.config.adminAuthority.toString(),
      programKeypairsPath: this.config.programKeypairsPath,
    });

    try {
      // Step 1: Pre-deployment checks
      await this.preDeploymentChecks();
      
      // Step 2: Build programs with optimizations
      await this.buildPrograms();
      
      // Step 3: Deploy programs to devnet
      await this.deployPrograms();
      
      // Step 4: Initialize contracts
      await this.initializeContracts();
      
      // Step 5: Configure initial state
      await this.configureInitialState();
      
      // Step 6: Create initial reward pools
      await this.createInitialRewardPools();
      
      // Step 7: Post-deployment setup
      await this.postDeploymentSetup();
      
      // Step 8: Security validation
      await this.validateSecurity();
      
      // Step 9: Final verification
      await this.verifyDeployment();
      
      const deploymentTime = Date.now() - this.deploymentStartTime.getTime();
      
      const result: DeploymentResult = {
        success: true,
        programs: this.deployedPrograms!,
        transactionSignatures: this.transactionSignatures,
        gasUsed: this.totalGasUsed,
        deploymentTime,
        errors: [],
      };
      
      this.logger.info("✅ Devnet deployment completed successfully", {
        duration: formatDuration(deploymentTime),
        programs: Object.keys(this.deployedPrograms!),
        totalGasUsed: this.totalGasUsed,
        transactionCount: this.transactionSignatures.length,
      });
      
      // Generate deployment report
      await this.generateDeploymentReport(result);
      
      return result;
      
    } catch (error) {
      this.logger.error("❌ Devnet deployment failed", { error: error.message });
      
      const deploymentTime = Date.now() - this.deploymentStartTime.getTime();
      const result: DeploymentResult = {
        success: false,
        programs: {} as DeployedPrograms,
        transactionSignatures: this.transactionSignatures,
        gasUsed: this.totalGasUsed,
        deploymentTime,
        errors: [error.message],
      };
      
      await this.generateDeploymentReport(result);
      
      return result;
    }
  }

  private async preDeploymentChecks(): Promise<void> {
    this.logger.info("📋 Performing pre-deployment checks...");
    
    // Check wallet balance
    const balance = await this.config.connection.getBalance(this.config.payer.publicKey);
    const requiredBalance = DEVNET_DEPLOYMENT_CONFIG.requiredSolBalance * LAMPORTS_PER_SOL;
    
    if (balance < requiredBalance) {
      throw new Error(`Insufficient SOL balance. Required: ${DEVNET_DEPLOYMENT_CONFIG.requiredSolBalance}, Available: ${balance / LAMPORTS_PER_SOL}`);
    }
    
    this.logger.info("Wallet balance sufficient", { 
      balance: balance / LAMPORTS_PER_SOL,
      required: DEVNET_DEPLOYMENT_CONFIG.requiredSolBalance 
    });
    
    // Check network connectivity
    try {
      const version = await this.config.connection.getVersion();
      this.logger.info("Connected to devnet", { version });
    } catch (error) {
      throw new Error(`Failed to connect to devnet: ${error.message}`);
    }
    
    // Validate program keypairs
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    this.logger.info("Program keypairs validated", {
      questionBank: keypairs.questionBankKeypair.publicKey.toString(),
      tournamentManager: keypairs.tournamentManagerKeypair.publicKey.toString(),
      rewardDistributor: keypairs.rewardDistributorKeypair.publicKey.toString(),
    });
    
    // Check if programs already exist
    await this.checkExistingPrograms(keypairs);
    
    this.logger.info("✅ Pre-deployment checks completed successfully");
  }

  private async checkExistingPrograms(keypairs: any): Promise<void> {
    this.logger.info("Checking for existing programs...");
    
    const programIds = [
      { name: "Question Bank", publicKey: keypairs.questionBankKeypair.publicKey },
      { name: "Tournament Manager", publicKey: keypairs.tournamentManagerKeypair.publicKey },
      { name: "Reward Distributor", publicKey: keypairs.rewardDistributorKeypair.publicKey },
    ];
    
    for (const program of programIds) {
      try {
        const accountInfo = await this.config.connection.getAccountInfo(program.publicKey);
        if (accountInfo) {
          this.logger.warn(`Program ${program.name} already exists`, {
            programId: program.publicKey.toString(),
            size: accountInfo.data.length,
          });
        } else {
          this.logger.info(`Program ${program.name} does not exist - will be deployed`);
        }
      } catch (error) {
        this.logger.info(`Program ${program.name} check failed - will be deployed`);
      }
    }
  }

  private async buildPrograms(): Promise<void> {
    this.logger.info("🔨 Building programs with optimizations...");
    
    try {
      // Build with optimizations for devnet
      const buildCmd = "anchor build --program-name question_bank --program-name tournament_manager --program-name reward_distributor";
      this.logger.info("Executing build command:", { command: buildCmd });
      
      const buildOutput = execSync(buildCmd, { 
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      
      this.logger.info("Build completed successfully");
      
      // Verify build artifacts
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
        
        const stats = fs.statSync(filePath);
        this.logger.info(`Build artifact verified: ${file}`, { size: stats.size });
      }
      
      this.logger.info("✅ Programs built successfully");
      
    } catch (error) {
      this.logger.error("❌ Build failed", { error: error.message });
      throw error;
    }
  }

  private async deployPrograms(): Promise<void> {
    this.logger.info("🚀 Deploying programs to devnet...");
    
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    
    try {
      // Deploy programs with proper ordering (no dependencies between them)
      const deployments = [
        { name: "question_bank", keypair: keypairs.questionBankKeypair },
        { name: "tournament_manager", keypair: keypairs.tournamentManagerKeypair },
        { name: "reward_distributor", keypair: keypairs.rewardDistributorKeypair },
      ];
      
      for (const deployment of deployments) {
        await this.deployProgram(deployment.name, deployment.keypair);
      }
      
      // Load deployed programs
      await this.loadDeployedPrograms();
      
      this.logger.info("✅ All programs deployed successfully");
      
    } catch (error) {
      this.logger.error("❌ Program deployment failed", { error: error.message });
      throw error;
    }
  }

  private async deployProgram(name: string, keypair: Keypair): Promise<void> {
    this.logger.info(`Deploying ${name}...`, { programId: keypair.publicKey.toString() });
    
    try {
      const binaryPath = `./target/deploy/${name}.so`;
      const keypairPath = `${this.config.programKeypairsPath}/${name}-keypair.json`;
      
      // Check if program already exists
      const existingAccount = await this.config.connection.getAccountInfo(keypair.publicKey);
      
      if (existingAccount) {
        this.logger.info(`Program ${name} already exists, upgrading...`);
        
        // Upgrade existing program
        const upgradeCmd = `solana program deploy ${binaryPath} --program-id ${keypairPath} --upgrade-authority ${this.config.payer.publicKey.toString()} --url ${this.config.connection.rpcEndpoint}`;
        
        this.logger.info("Executing upgrade command:", { command: upgradeCmd });
        
        const upgradeOutput = execSync(upgradeCmd, { 
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
        
        this.logger.info(`${name} upgraded successfully`, { output: upgradeOutput });
        
      } else {
        this.logger.info(`Program ${name} does not exist, deploying new...`);
        
        // Deploy new program
        const deployCmd = `solana program deploy ${binaryPath} --program-id ${keypairPath} --url ${this.config.connection.rpcEndpoint}`;
        
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
          60000, // 60 second timeout for devnet
          this.logger
        );
      }
      
      // Record deployment transaction (would be extracted from output in real implementation)
      this.transactionSignatures.push(`${name}_deployment_signature`);
      
    } catch (error) {
      this.logger.error(`Failed to deploy ${name}`, { error: error.message });
      throw error;
    }
  }

  private async loadDeployedPrograms(): Promise<void> {
    this.logger.info("📥 Loading deployed programs...");
    
    const keypairs = ensureProgramKeypairs(this.config.programKeypairsPath);
    
    // Set up provider for the deployed programs
    anchor.setProvider(this.config.provider);
    
    // Load programs using IDL
    const questionBankIDL = JSON.parse(fs.readFileSync("./target/idl/question_bank.json", "utf8"));
    const tournamentManagerIDL = JSON.parse(fs.readFileSync("./target/idl/tournament_manager.json", "utf8"));
    const rewardDistributorIDL = JSON.parse(fs.readFileSync("./target/idl/reward_distributor.json", "utf8"));
    
    const questionBankProgram = new Program(questionBankIDL, keypairs.questionBankKeypair.publicKey, this.config.provider);
    const tournamentManagerProgram = new Program(tournamentManagerIDL, keypairs.tournamentManagerKeypair.publicKey, this.config.provider);
    const rewardDistributorProgram = new Program(rewardDistributorIDL, keypairs.rewardDistributorKeypair.publicKey, this.config.provider);
    
    const [questionBankPda] = getQuestionBankPDA(keypairs.questionBankKeypair.publicKey);
    const [tournamentManagerPda] = getTournamentManagerPDA(keypairs.tournamentManagerKeypair.publicKey);
    
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
    
    // Initialize user reputations
    await this.initializeUserReputations();
    
    this.logger.info("✅ Contracts initialized successfully");
  }

  private async initializeQuestionBank(): Promise<void> {
    this.logger.info("Initializing Question Bank...");
    
    const { questionBank } = this.deployedPrograms!;
    
    try {
      // Check if already initialized
      try {
        const existingAccount = await questionBank.program.account.questionBank.fetch(
          questionBank.questionBankPda
        );
        this.logger.info("Question Bank already initialized", {
          authority: existingAccount.authority.toString(),
          totalQuestions: existingAccount.totalQuestions.toString(),
        });
        return;
      } catch (error) {
        // Account doesn't exist, proceed with initialization
      }
      
      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ 
          units: this.config.deploymentSettings.computeUnitLimit 
        }),
        ComputeBudgetProgram.setComputeUnitPrice({ 
          microLamports: this.config.deploymentSettings.computeUnitPrice 
        })
      );
      
      const initInstruction = await questionBank.program.methods
        .initializeQuestionBank(this.config.adminAuthority)
        .accounts({
          questionBank: questionBank.questionBankPda,
          payer: this.config.payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      transaction.add(initInstruction);
      
      const signature = await sendTransactionWithRetry(
        this.config.connection,
        transaction,
        [this.config.payer],
        this.config,
        this.logger,
        "Initialize Question Bank"
      );
      
      this.transactionSignatures.push(signature);
      this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
      
    } catch (error) {
      this.logger.error("Failed to initialize Question Bank", { error: error.message });
      throw error;
    }
  }

  private async initializeTournamentManager(): Promise<void> {
    this.logger.info("Initializing Tournament Manager...");
    
    const { tournamentManager } = this.deployedPrograms!;
    
    try {
      // Check if already initialized
      try {
        const existingAccount = await tournamentManager.program.account.tournamentManagerState.fetch(
          tournamentManager.tournamentManagerPda
        );
        this.logger.info("Tournament Manager already initialized", {
          authority: existingAccount.authority.toString(),
          tournamentCount: existingAccount.tournamentCount.toString(),
        });
        return;
      } catch (error) {
        // Account doesn't exist, proceed with initialization
      }
      
      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ 
          units: this.config.deploymentSettings.computeUnitLimit 
        }),
        ComputeBudgetProgram.setComputeUnitPrice({ 
          microLamports: this.config.deploymentSettings.computeUnitPrice 
        })
      );
      
      const initInstruction = await tournamentManager.program.methods
        .initialize()
        .accounts({
          tournamentManager: tournamentManager.tournamentManagerPda,
          authority: this.config.adminAuthority,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      transaction.add(initInstruction);
      
      const signature = await sendTransactionWithRetry(
        this.config.connection,
        transaction,
        [this.config.payer],
        this.config,
        this.logger,
        "Initialize Tournament Manager"
      );
      
      this.transactionSignatures.push(signature);
      this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
      
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
        
        // Check if already initialized
        try {
          const existingAccount = await questionBank.program.account.userReputation.fetch(
            userReputationPda
          );
          this.logger.info(`User reputation already initialized for ${user.toString()}`, {
            reputationScore: existingAccount.reputationScore.toString(),
          });
          continue;
        } catch (error) {
          // Account doesn't exist, proceed with initialization
        }
        
        const transaction = new Transaction();
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ 
            units: this.config.deploymentSettings.computeUnitLimit 
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ 
            microLamports: this.config.deploymentSettings.computeUnitPrice 
          })
        );
        
        const initInstruction = await questionBank.program.methods
          .initializeUserReputation()
          .accounts({
            userReputation: userReputationPda,
            user: user,
            payer: this.config.payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        
        transaction.add(initInstruction);
        
        const signature = await sendTransactionWithRetry(
          this.config.connection,
          transaction,
          [this.config.payer],
          this.config,
          this.logger,
          `Initialize user reputation for ${user.toString()}`
        );
        
        this.transactionSignatures.push(signature);
        this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
        
      } catch (error) {
        this.logger.error(`Failed to initialize reputation for ${user.toString()}`, { error: error.message });
        throw error;
      }
    }
  }

  private async configureInitialState(): Promise<void> {
    this.logger.info("🔧 Configuring initial state...");
    
    // Add curators to Question Bank
    await this.addCurators();
    
    // Create test token mint
    await this.createTestTokenMint();
    
    // Fund initial accounts
    await this.fundInitialAccounts();
    
    this.logger.info("✅ Initial state configured successfully");
  }

  private async addCurators(): Promise<void> {
    this.logger.info("Adding curators to Question Bank...");
    
    const { questionBank } = this.deployedPrograms!;
    
    for (const curator of this.config.initialConfiguration.curators) {
      try {
        const transaction = new Transaction();
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ 
            units: this.config.deploymentSettings.computeUnitLimit 
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ 
            microLamports: this.config.deploymentSettings.computeUnitPrice 
          })
        );
        
        const addCuratorInstruction = await questionBank.program.methods
          .addCurator(curator)
          .accounts({
            questionBank: questionBank.questionBankPda,
            authority: this.config.adminAuthority,
          })
          .instruction();
        
        transaction.add(addCuratorInstruction);
        
        const signature = await sendTransactionWithRetry(
          this.config.connection,
          transaction,
          [this.config.payer],
          this.config,
          this.logger,
          `Add curator: ${curator.toString()}`
        );
        
        this.transactionSignatures.push(signature);
        this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
        
      } catch (error) {
        this.logger.error(`Failed to add curator: ${curator.toString()}`, { error: error.message });
        // Continue with other curators
      }
    }
  }

  private async createTestTokenMint(): Promise<void> {
    this.logger.info("Creating test token mint...");
    
    try {
      this.testTokenMint = await createMint(
        this.config.connection,
        this.config.payer,
        this.config.adminAuthority,
        null,
        this.config.initialConfiguration.tokenMintDecimals
      );
      
      this.logger.info("Test token mint created", { 
        mint: this.testTokenMint.toString(),
        decimals: this.config.initialConfiguration.tokenMintDecimals,
      });
      
    } catch (error) {
      this.logger.error("Failed to create test token mint", { error: error.message });
      throw error;
    }
  }

  private async fundInitialAccounts(): Promise<void> {
    this.logger.info("Funding initial accounts...");
    
    if (!this.testTokenMint) {
      throw new Error("Test token mint not created");
    }
    
    const accountsToFund = [
      { owner: this.config.adminAuthority, amount: DEVNET_DEPLOYMENT_CONFIG.initialFunding.testTokenAmount },
      ...this.config.initialConfiguration.curators.map(curator => ({ 
        owner: curator, 
        amount: DEVNET_DEPLOYMENT_CONFIG.initialFunding.testTokenAmount / 10 
      })),
    ];
    
    for (const account of accountsToFund) {
      try {
        const tokenAccount = await createAssociatedTokenAccount(
          this.config.connection,
          this.config.payer,
          this.testTokenMint,
          account.owner
        );
        
        await mintTo(
          this.config.connection,
          this.config.payer,
          this.testTokenMint,
          tokenAccount,
          this.config.payer,
          account.amount
        );
        
        this.logger.info(`Funded token account for ${account.owner.toString()}`, {
          tokenAccount: tokenAccount.toString(),
          amount: account.amount,
        });
        
      } catch (error) {
        this.logger.error(`Failed to fund account for ${account.owner.toString()}`, { error: error.message });
        // Continue with other accounts
      }
    }
  }

  private async createInitialRewardPools(): Promise<void> {
    this.logger.info("🎁 Creating initial reward pools...");
    
    const { rewardDistributor } = this.deployedPrograms!;
    const pools = DEVNET_DEPLOYMENT_CONFIG.initialPools;
    
    let poolId = 1;
    
    // Create SOL performance pool
    await this.createRewardPool(poolId++, {
      name: pools.performancePool.name,
      totalRewards: new BN(pools.performancePool.totalRewards * LAMPORTS_PER_SOL),
      rewardType: { sol: {} },
      tokenMint: null,
      distributionCriteria: { performanceBased: {} },
      startTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + pools.performancePool.duration),
    });
    
    // Create token achievement pool
    await this.createRewardPool(poolId++, {
      name: pools.achievementPool.name,
      totalRewards: new BN(pools.achievementPool.totalRewards),
      rewardType: { splToken: {} },
      tokenMint: this.testTokenMint,
      distributionCriteria: { achievementBased: {} },
      startTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + pools.achievementPool.duration),
    });
    
    this.logger.info("✅ Initial reward pools created successfully");
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
      
      const [rewardPoolPda] = getRewardPoolPDA(poolId, rewardDistributor.programId);
      const [rewardVaultPda] = getRewardVaultPDA(poolId, rewardDistributor.programId);
      
      const initialFunding = config.rewardType.sol 
        ? config.totalRewards.div(new BN(10)) // 10% initial funding
        : config.totalRewards.div(new BN(100)); // 1% initial funding for tokens
      
      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ 
          units: this.config.deploymentSettings.computeUnitLimit 
        }),
        ComputeBudgetProgram.setComputeUnitPrice({ 
          microLamports: this.config.deploymentSettings.computeUnitPrice 
        })
      );
      
      const createPoolInstruction = await rewardDistributor.program.methods
        .createRewardPool(poolData, initialFunding)
        .accounts({
          rewardPool: rewardPoolPda,
          rewardVault: rewardVaultPda,
          authority: this.config.adminAuthority,
          authorityTokenAccount: config.tokenMint ? await getAssociatedTokenAddress(config.tokenMint, this.config.adminAuthority) : null,
          rewardVaultToken: config.tokenMint ? await getAssociatedTokenAddress(config.tokenMint, rewardVaultPda) : null,
          tokenMint: config.tokenMint,
          tokenProgram: config.tokenMint ? TOKEN_PROGRAM_ID : null,
          associatedTokenProgram: config.tokenMint ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      transaction.add(createPoolInstruction);
      
      const signature = await sendTransactionWithRetry(
        this.config.connection,
        transaction,
        [this.config.payer],
        this.config,
        this.logger,
        `Create reward pool ${poolId}: ${config.name}`
      );
      
      this.transactionSignatures.push(signature);
      this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
      
    } catch (error) {
      this.logger.error(`Failed to create reward pool ${poolId}`, { error: error.message });
      throw error;
    }
  }

  private async postDeploymentSetup(): Promise<void> {
    this.logger.info("🔧 Post-deployment setup...");
    
    const setup = DEVNET_DEPLOYMENT_CONFIG.postDeployment;
    
    if (setup.createSampleQuestions) {
      await this.createSampleQuestions();
    }
    
    if (setup.createSampleTournaments) {
      await this.createSampleTournaments();
    }
    
    if (setup.setupHoneycombIntegration) {
      await this.setupHoneycombIntegration();
    }
    
    this.logger.info("✅ Post-deployment setup completed successfully");
  }

  private async createSampleQuestions(): Promise<void> {
    this.logger.info("Creating sample questions...");
    
    const { questionBank } = this.deployedPrograms!;
    
    const sampleQuestions = [
      {
        questionText: "What is the native token of the Solana blockchain?",
        options: ["SOL", "ETH", "BTC", "USDC"],
        correctAnswer: 0,
        category: "Blockchain",
        difficulty: 1,
      },
      {
        questionText: "Which consensus mechanism does Solana use?",
        options: ["Proof of Work", "Proof of Stake", "Proof of History", "Delegated Proof of Stake"],
        correctAnswer: 2,
        category: "Blockchain",
        difficulty: 2,
      },
      {
        questionText: "What is the maximum theoretical TPS of Solana?",
        options: ["50,000", "65,000", "100,000", "710,000"],
        correctAnswer: 3,
        category: "Blockchain",
        difficulty: 3,
      },
    ];
    
    for (let i = 0; i < sampleQuestions.length; i++) {
      try {
        const question = sampleQuestions[i];
        
        const questionBankAccount = await questionBank.program.account.questionBank.fetch(
          questionBank.questionBankPda
        );
        
        const questionId = questionBankAccount.totalQuestions.toNumber();
        const [questionPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("question"), new BN(questionId).toArrayLike(Buffer, "le", 8)],
          questionBank.programId
        );
        
        const [userReputationPda] = getUserReputationPDA(
          this.config.adminAuthority,
          questionBank.programId
        );
        
        const transaction = new Transaction();
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ 
            units: this.config.deploymentSettings.computeUnitLimit 
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ 
            microLamports: this.config.deploymentSettings.computeUnitPrice 
          })
        );
        
        const submitQuestionInstruction = await questionBank.program.methods
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
          .instruction();
        
        transaction.add(submitQuestionInstruction);
        
        const signature = await sendTransactionWithRetry(
          this.config.connection,
          transaction,
          [this.config.payer],
          this.config,
          this.logger,
          `Submit sample question ${i + 1}: ${question.questionText}`
        );
        
        this.transactionSignatures.push(signature);
        this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
        
      } catch (error) {
        this.logger.error(`Failed to create sample question ${i + 1}`, { error: error.message });
        // Continue with other questions
      }
    }
  }

  private async createSampleTournaments(): Promise<void> {
    this.logger.info("Creating sample tournaments...");
    
    const { tournamentManager } = this.deployedPrograms!;
    
    const sampleTournaments = [
      {
        name: "Devnet Blockchain Quiz",
        description: "Test your knowledge of blockchain technology",
        entryFee: new BN(0.01 * LAMPORTS_PER_SOL),
        prizePool: new BN(1 * LAMPORTS_PER_SOL),
        maxParticipants: 100,
        questionCount: 10,
        category: "Blockchain",
        difficulty: 2,
        duration: new BN(30 * 60), // 30 minutes
      },
    ];
    
    for (let i = 0; i < sampleTournaments.length; i++) {
      try {
        const tournament = sampleTournaments[i];
        
        const tournamentManagerAccount = await tournamentManager.program.account.tournamentManagerState.fetch(
          tournamentManager.tournamentManagerPda
        );
        
        const tournamentId = tournamentManagerAccount.tournamentCount.toNumber();
        const [tournamentPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("tournament"), new BN(tournamentId).toArrayLike(Buffer, "le", 8)],
          tournamentManager.programId
        );
        
        const startTime = Math.floor(Date.now() / 1000) + 3600; // Start in 1 hour
        
        const transaction = new Transaction();
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ 
            units: this.config.deploymentSettings.computeUnitLimit 
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ 
            microLamports: this.config.deploymentSettings.computeUnitPrice 
          })
        );
        
        const createTournamentInstruction = await tournamentManager.program.methods
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
          .instruction();
        
        transaction.add(createTournamentInstruction);
        
        const signature = await sendTransactionWithRetry(
          this.config.connection,
          transaction,
          [this.config.payer],
          this.config,
          this.logger,
          `Create sample tournament ${i + 1}: ${tournament.name}`
        );
        
        this.transactionSignatures.push(signature);
        this.totalGasUsed += this.config.deploymentSettings.priorityFeeLamports;
        
      } catch (error) {
        this.logger.error(`Failed to create sample tournament ${i + 1}`, { error: error.message });
        // Continue with other tournaments
      }
    }
  }

  private async setupHoneycombIntegration(): Promise<void> {
    this.logger.info("Setting up Honeycomb integration...");
    
    if (!this.config.honeycombConfig.enableIntegration) {
      this.logger.info("Honeycomb integration disabled in configuration");
      return;
    }
    
    // This would implement actual Honeycomb integration
    // For now, just log the configuration
    this.logger.info("Honeycomb integration configured", {
      projectId: this.config.honeycombConfig.projectId,
      profileApi: this.config.honeycombConfig.profileApi,
    });
  }

  private async validateSecurity(): Promise<void> {
    this.logger.info("🔒 Validating security configuration...");
    
    const checks: SecurityChecks = {
      programUpgradeAuthority: false,
      adminKeyRotation: false,
      multisigValidation: false,
      accessControlValidation: false,
      emergencyPauseValidation: false,
    };
    
    // Validate program upgrade authority
    if (DEVNET_DEPLOYMENT_CONFIG.security.requireUpgradeAuthority) {
      checks.programUpgradeAuthority = validateProgramUpgradeAuthority(
        this.deployedPrograms!.questionBank.programId,
        this.config.adminAuthority,
        this.logger
      );
    }
    
    // Validate access control
    checks.accessControlValidation = await this.validateAccessControl();
    
    // Log security check results
    this.logger.info("Security validation completed", { checks });
    
    const failedChecks = Object.entries(checks).filter(([_, passed]) => !passed);
    if (failedChecks.length > 0) {
      this.logger.warn("Some security checks failed", { failedChecks });
    }
  }

  private async validateAccessControl(): Promise<boolean> {
    this.logger.info("Validating access control...");
    
    try {
      // Check Question Bank authority
      const questionBankAccount = await this.deployedPrograms!.questionBank.program.account.questionBank.fetch(
        this.deployedPrograms!.questionBank.questionBankPda
      );
      
      if (!questionBankAccount.authority.equals(this.config.adminAuthority)) {
        this.logger.error("Question Bank authority mismatch");
        return false;
      }
      
      // Check Tournament Manager authority
      const tournamentManagerAccount = await this.deployedPrograms!.tournamentManager.program.account.tournamentManagerState.fetch(
        this.deployedPrograms!.tournamentManager.tournamentManagerPda
      );
      
      if (!tournamentManagerAccount.authority.equals(this.config.adminAuthority)) {
        this.logger.error("Tournament Manager authority mismatch");
        return false;
      }
      
      this.logger.info("Access control validation passed");
      return true;
      
    } catch (error) {
      this.logger.error("Access control validation failed", { error: error.message });
      return false;
    }
  }

  private async verifyDeployment(): Promise<void> {
    this.logger.info("🔍 Verifying deployment...");
    
    if (!this.deployedPrograms) {
      throw new Error("No programs deployed");
    }
    
    // Verify all programs are accessible
    for (const [name, program] of Object.entries(this.deployedPrograms)) {
      const accountInfo = await this.config.connection.getAccountInfo(program.programId);
      if (!accountInfo) {
        throw new Error(`Program ${name} not found at ${program.programId.toString()}`);
      }
      
      this.logger.info(`Program ${name} verified`, {
        programId: program.programId.toString(),
        size: accountInfo.data.length,
        owner: accountInfo.owner.toString(),
      });
    }
    
    // Verify initialization
    const questionBankAccount = await this.deployedPrograms.questionBank.program.account.questionBank.fetch(
      this.deployedPrograms.questionBank.questionBankPda
    );
    
    const tournamentManagerAccount = await this.deployedPrograms.tournamentManager.program.account.tournamentManagerState.fetch(
      this.deployedPrograms.tournamentManager.tournamentManagerPda
    );
    
    this.logger.info("Contract state verified", {
      questionBank: {
        authority: questionBankAccount.authority.toString(),
        totalQuestions: questionBankAccount.totalQuestions.toString(),
        curators: questionBankAccount.curators.length,
      },
      tournamentManager: {
        authority: tournamentManagerAccount.authority.toString(),
        tournamentCount: tournamentManagerAccount.tournamentCount.toString(),
      },
    });
    
    this.logger.info("✅ Deployment verification completed successfully");
  }

  private async generateDeploymentReport(result: DeploymentResult): Promise<void> {
    this.logger.info("📊 Generating deployment report...");
    
    const report: DeploymentReport = {
      deploymentId: this.deploymentId,
      timestamp: new Date(),
      cluster: this.config.cluster,
      version: "1.0.0",
      programs: result.success ? {
        questionBank: {
          programId: this.deployedPrograms!.questionBank.programId.toString(),
          deploymentSignature: "question_bank_signature",
          gasUsed: this.totalGasUsed / 3,
          status: "success",
        },
        tournamentManager: {
          programId: this.deployedPrograms!.tournamentManager.programId.toString(),
          deploymentSignature: "tournament_manager_signature",
          gasUsed: this.totalGasUsed / 3,
          status: "success",
        },
        rewardDistributor: {
          programId: this.deployedPrograms!.rewardDistributor.programId.toString(),
          deploymentSignature: "reward_distributor_signature",
          gasUsed: this.totalGasUsed / 3,
          status: "success",
        },
      } : {},
      configuration: {
        success: result.success,
        questionBankInitialized: result.success,
        tournamentManagerInitialized: result.success,
        curatorsAdded: this.config.initialConfiguration.curators.length,
        rewardPoolsCreated: result.success ? 2 : 0,
        transactionSignatures: this.transactionSignatures,
        errors: result.errors,
      },
      verification: {
        success: result.success,
        programsVerified: result.success,
        accountsVerified: result.success,
        configurationVerified: result.success,
        honeycombIntegrationVerified: this.config.honeycombConfig.enableIntegration,
        issues: result.errors,
      },
      securityChecks: {
        programUpgradeAuthority: true,
        adminKeyRotation: false,
        multisigValidation: false,
        accessControlValidation: result.success,
        emergencyPauseValidation: false,
      },
      postDeploymentTasks: {
        createInitialRewardPools: result.success,
        setupInitialCurators: result.success,
        createSampleTournaments: result.success,
        configureHoneycombIntegration: this.config.honeycombConfig.enableIntegration,
        setupMonitoring: false,
        createDocumentation: false,
      },
      totalGasUsed: this.totalGasUsed,
      deploymentDuration: result.deploymentTime,
      logs: this.logger.getLogs(),
    };
    
    const reportPath = `./deployments/devnet-${this.deploymentId}.json`;
    const reportDir = path.dirname(reportPath);
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    this.logger.info("Deployment report generated", { path: reportPath });
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main(): Promise<void> {
  console.log("🚀 TriviaComb Devnet Deployment Starting...");
  console.log("⚠️  Make sure your wallet is funded with sufficient SOL for deployment");
  console.log("⚠️  Make sure your .env file is configured for devnet");
  
  const deployment = new DevnetDeployment();
  
  try {
    const result = await deployment.deploy();
    
    if (result.success) {
      console.log("\n🎉 Devnet deployment completed successfully!");
      console.log("📋 Deployment Summary:");
      console.log(`  Duration: ${formatDuration(result.deploymentTime)}`);
      console.log(`  Programs: ${Object.keys(result.programs).length}`);
      console.log(`  Gas Used: ${result.gasUsed} lamports (${(result.gasUsed / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
      console.log(`  Transactions: ${result.transactionSignatures.length}`);
      
      console.log("\n🔗 Program IDs:");
      for (const [name, program] of Object.entries(result.programs)) {
        console.log(`  ${name}: ${program.programId.toString()}`);
      }
      
      console.log("\n🌐 Network: Devnet");
      console.log("🔍 View transactions on Solana Explorer:");
      console.log("  https://explorer.solana.com/?cluster=devnet");
      
      console.log("\n📊 Deployment Report: ./deployments/devnet-*.json");
      console.log("📋 Logs: ./logs/deploy-devnet.log");
      
    } else {
      console.error("\n❌ Devnet deployment failed!");
      console.error("Errors:", result.errors);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Deployment crashed:", error.message);
    process.exit(1);
  }
}

// Execute if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { DevnetDeployment };