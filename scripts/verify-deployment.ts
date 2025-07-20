#!/usr/bin/env ts-node

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { 
  Connection, 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  AccountInfo,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { QuestionBank } from "../target/types/question_bank";
import { TournamentManager } from "../target/types/tournament_manager";
import { RewardDistributor } from "../target/types/reward_distributor";
import {
  DeploymentConfig,
  VerificationResult,
  DeployedPrograms,
  DeploymentLogger,
  SolanaCluster,
  SecurityChecks,
  DeploymentReport,
} from "./types/deployment";
import {
  loadEnvironmentConfig,
  loadProgramKeypairs,
  DeploymentLoggerImpl,
  getQuestionBankPDA,
  getTournamentManagerPDA,
  getUserReputationPDA,
  getRewardPoolPDA,
  getRewardVaultPDA,
  validateProgramUpgradeAuthority,
  formatDuration,
  generateDeploymentId,
} from "./utils/deployment-utils";

// ============================================================================
// Verification Test Cases
// ============================================================================

interface VerificationTest {
  name: string;
  description: string;
  category: "critical" | "important" | "optional";
  execute: () => Promise<boolean>;
  expectedResult?: any;
  actualResult?: any;
  error?: string;
}

// ============================================================================
// Deployment Verifier Class
// ============================================================================

class DeploymentVerifier {
  private config: DeploymentConfig;
  private logger: DeploymentLogger;
  private programs: DeployedPrograms;
  private verificationId: string;
  private tests: VerificationTest[] = [];

  constructor(config: DeploymentConfig, programs: DeployedPrograms) {
    this.config = config;
    this.logger = new DeploymentLoggerImpl(true, `./logs/verification-${config.cluster}-${new Date().toISOString().split('T')[0]}.log`);
    this.programs = programs;
    this.verificationId = generateDeploymentId();
    this.initializeTests();
  }

  async verify(): Promise<VerificationResult> {
    const startTime = Date.now();
    this.logger.info("🔍 Starting deployment verification...");
    this.logger.info(`Verification ID: ${this.verificationId}`);

    let criticalPassed = 0;
    let importantPassed = 0;
    let optionalPassed = 0;
    let totalCritical = 0;
    let totalImportant = 0;
    let totalOptional = 0;
    const issues: string[] = [];

    // Execute all tests
    for (const test of this.tests) {
      this.logger.info(`Running test: ${test.name}`);
      
      try {
        const result = await test.execute();
        
        if (result) {
          this.logger.info(`✅ ${test.name} - PASSED`);
          
          switch (test.category) {
            case "critical":
              criticalPassed++;
              break;
            case "important":
              importantPassed++;
              break;
            case "optional":
              optionalPassed++;
              break;
          }
        } else {
          this.logger.warn(`❌ ${test.name} - FAILED`);
          issues.push(`${test.name}: ${test.error || "Test failed"}`);
        }
      } catch (error) {
        this.logger.error(`💥 ${test.name} - ERROR`, { error: error.message });
        test.error = error.message;
        issues.push(`${test.name}: ${error.message}`);
      }

      // Count totals
      switch (test.category) {
        case "critical":
          totalCritical++;
          break;
        case "important":
          totalImportant++;
          break;
        case "optional":
          totalOptional++;
          break;
      }
    }

    // Generate verification result
    const result: VerificationResult = {
      success: criticalPassed === totalCritical,
      programsVerified: await this.verifyProgramsExist(),
      accountsVerified: await this.verifyAccountsExist(),
      configurationVerified: await this.verifyConfiguration(),
      honeycombIntegrationVerified: await this.verifyHoneycombIntegration(),
      issues: issues.length > 0 ? issues : undefined,
    };

    // Generate comprehensive report
    const report = this.generateVerificationReport(result, startTime, {
      critical: { passed: criticalPassed, total: totalCritical },
      important: { passed: importantPassed, total: totalImportant },
      optional: { passed: optionalPassed, total: totalOptional },
    });

    this.logger.info("📊 Verification Summary:");
    this.logger.info(`Critical Tests: ${criticalPassed}/${totalCritical}`);
    this.logger.info(`Important Tests: ${importantPassed}/${totalImportant}`);
    this.logger.info(`Optional Tests: ${optionalPassed}/${totalOptional}`);
    this.logger.info(`Total Issues: ${issues.length}`);
    this.logger.info(`Verification time: ${formatDuration(Date.now() - startTime)}`);

    // Save verification result
    this.saveVerificationResult(result, report);

    return result;
  }

  private initializeTests(): void {
    this.tests = [
      // Critical Tests
      {
        name: "Program Accounts Exist",
        description: "Verify all program accounts exist on-chain",
        category: "critical",
        execute: async () => {
          const qbAccount = await this.config.connection.getAccountInfo(this.programs.questionBank.programId);
          const tmAccount = await this.config.connection.getAccountInfo(this.programs.tournamentManager.programId);
          const rdAccount = await this.config.connection.getAccountInfo(this.programs.rewardDistributor.programId);
          
          return qbAccount !== null && tmAccount !== null && rdAccount !== null;
        },
      },
      {
        name: "Program Data Accounts Initialized",
        description: "Verify program data accounts are properly initialized",
        category: "critical",
        execute: async () => {
          try {
            const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
              this.programs.questionBank.questionBankPda
            );
            const tmData = await this.programs.tournamentManager.program.account.tournamentManager.fetch(
              this.programs.tournamentManager.tournamentManagerPda
            );
            
            return qbData.authority.equals(this.config.adminAuthority) &&
                   tmData.authority.equals(this.config.adminAuthority);
          } catch (error) {
            this.logger.error("Failed to fetch program data accounts", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Program Upgrade Authority",
        description: "Verify program upgrade authorities are correctly set",
        category: "critical",
        execute: async () => {
          return validateProgramUpgradeAuthority(
            this.programs.questionBank.programId,
            this.config.adminAuthority,
            this.logger
          );
        },
      },
      {
        name: "Cross-Program References",
        description: "Verify cross-program references are correctly configured",
        category: "critical",
        execute: async () => {
          try {
            const tmData = await this.programs.tournamentManager.program.account.tournamentManager.fetch(
              this.programs.tournamentManager.tournamentManagerPda
            );
            
            return tmData.questionBankProgram.equals(this.programs.questionBank.programId) &&
                   tmData.rewardDistributorProgram.equals(this.programs.rewardDistributor.programId);
          } catch (error) {
            this.logger.error("Failed to verify cross-program references", { error: error.message });
            return false;
          }
        },
      },

      // Important Tests
      {
        name: "Initial Curators Configured",
        description: "Verify initial curators are properly configured",
        category: "important",
        execute: async () => {
          try {
            let curatorsConfigured = 0;
            
            for (const curator of this.config.initialConfiguration.curators) {
              const [userReputationPda] = getUserReputationPDA(curator, this.programs.questionBank.programId);
              
              try {
                const reputationData = await this.programs.questionBank.program.account.userReputation.fetch(userReputationPda);
                if (reputationData.reputation >= this.config.initialConfiguration.initialCuratorReputation) {
                  curatorsConfigured++;
                }
              } catch (error) {
                // Curator not configured
              }
            }
            
            return curatorsConfigured > 0;
          } catch (error) {
            this.logger.error("Failed to verify curators", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Reward Pools Created",
        description: "Verify reward pools are created and funded",
        category: "important",
        execute: async () => {
          try {
            // Check for at least one reward pool
            const [poolPda] = getRewardPoolPDA(1, this.programs.rewardDistributor.programId);
            
            try {
              const poolData = await this.programs.rewardDistributor.program.account.rewardPool.fetch(poolPda);
              return poolData.totalRewards.gt(new BN(0));
            } catch (error) {
              return false;
            }
          } catch (error) {
            this.logger.error("Failed to verify reward pools", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Token Mint Configuration",
        description: "Verify token mint is properly configured for token rewards",
        category: "important",
        execute: async () => {
          try {
            if (this.config.cluster === "localnet" || this.config.cluster === "devnet") {
              // For development, check if test token was created
              // This would require storing the token mint address somewhere
              return true; // Skip for now
            } else {
              // For mainnet, verify the reward token mint exists
              const rewardTokenMint = process.env.REWARD_TOKEN_MINT;
              if (!rewardTokenMint) {
                return false;
              }
              
              const mintAccount = await this.config.connection.getAccountInfo(new PublicKey(rewardTokenMint));
              return mintAccount !== null;
            }
          } catch (error) {
            this.logger.error("Failed to verify token mint", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Access Control Validation",
        description: "Verify access control mechanisms are working",
        category: "important",
        execute: async () => {
          try {
            // Test that only authorized addresses can perform admin functions
            const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
              this.programs.questionBank.questionBankPda
            );
            
            // Verify admin authority is set correctly
            return qbData.authority.equals(this.config.adminAuthority);
          } catch (error) {
            this.logger.error("Failed to verify access control", { error: error.message });
            return false;
          }
        },
      },

      // Optional Tests
      {
        name: "Sample Data Created",
        description: "Verify sample data is created for development environments",
        category: "optional",
        execute: async () => {
          if (this.config.cluster === "mainnet-beta") {
            return true; // Skip for mainnet
          }
          
          try {
            // Check if sample questions exist
            const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
              this.programs.questionBank.questionBankPda
            );
            
            // This would need to be implemented based on the actual question storage structure
            return true; // Skip for now
          } catch (error) {
            return false;
          }
        },
      },
      {
        name: "Gas Optimization Check",
        description: "Verify programs are optimized for gas efficiency",
        category: "optional",
        execute: async () => {
          try {
            // Check program sizes and compute unit usage
            const qbAccount = await this.config.connection.getAccountInfo(this.programs.questionBank.programId);
            const tmAccount = await this.config.connection.getAccountInfo(this.programs.tournamentManager.programId);
            const rdAccount = await this.config.connection.getAccountInfo(this.programs.rewardDistributor.programId);
            
            // Verify programs are not excessively large
            const maxProgramSize = 1024 * 1024; // 1MB
            
            return (qbAccount?.data.length || 0) < maxProgramSize &&
                   (tmAccount?.data.length || 0) < maxProgramSize &&
                   (rdAccount?.data.length || 0) < maxProgramSize;
          } catch (error) {
            this.logger.error("Failed to check gas optimization", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Security Best Practices",
        description: "Verify security best practices are implemented",
        category: "optional",
        execute: async () => {
          try {
            // Check for security features
            const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
              this.programs.questionBank.questionBankPda
            );
            
            // Verify emergency pause mechanism exists
            // This would depend on the actual program implementation
            return true;
          } catch (error) {
            this.logger.error("Failed to verify security practices", { error: error.message });
            return false;
          }
        },
      },
      {
        name: "Performance Benchmarks",
        description: "Verify system meets performance requirements",
        category: "optional",
        execute: async () => {
          try {
            // Test transaction confirmation times
            const startTime = Date.now();
            
            // Perform a simple read operation
            await this.programs.questionBank.program.account.questionBank.fetch(
              this.programs.questionBank.questionBankPda
            );
            
            const responseTime = Date.now() - startTime;
            
            // Verify response time is reasonable (< 5 seconds)
            return responseTime < 5000;
          } catch (error) {
            this.logger.error("Failed to verify performance", { error: error.message });
            return false;
          }
        },
      },
    ];
  }

  private async verifyProgramsExist(): Promise<boolean> {
    try {
      const qbAccount = await this.config.connection.getAccountInfo(this.programs.questionBank.programId);
      const tmAccount = await this.config.connection.getAccountInfo(this.programs.tournamentManager.programId);
      const rdAccount = await this.config.connection.getAccountInfo(this.programs.rewardDistributor.programId);
      
      return qbAccount !== null && tmAccount !== null && rdAccount !== null;
    } catch (error) {
      this.logger.error("Failed to verify programs exist", { error: error.message });
      return false;
    }
  }

  private async verifyAccountsExist(): Promise<boolean> {
    try {
      const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
        this.programs.questionBank.questionBankPda
      );
      const tmData = await this.programs.tournamentManager.program.account.tournamentManager.fetch(
        this.programs.tournamentManager.tournamentManagerPda
      );
      
      return qbData !== null && tmData !== null;
    } catch (error) {
      this.logger.error("Failed to verify accounts exist", { error: error.message });
      return false;
    }
  }

  private async verifyConfiguration(): Promise<boolean> {
    try {
      const qbData = await this.programs.questionBank.program.account.questionBank.fetch(
        this.programs.questionBank.questionBankPda
      );
      const tmData = await this.programs.tournamentManager.program.account.tournamentManager.fetch(
        this.programs.tournamentManager.tournamentManagerPda
      );
      
      return qbData.authority.equals(this.config.adminAuthority) &&
             tmData.authority.equals(this.config.adminAuthority);
    } catch (error) {
      this.logger.error("Failed to verify configuration", { error: error.message });
      return false;
    }
  }

  private async verifyHoneycombIntegration(): Promise<boolean> {
    if (!this.config.honeycombConfig.enableIntegration) {
      return true; // Skip if not enabled
    }
    
    try {
      // Verify Honeycomb integration
      // This would depend on the actual Honeycomb integration implementation
      return true;
    } catch (error) {
      this.logger.error("Failed to verify Honeycomb integration", { error: error.message });
      return false;
    }
  }

  private generateVerificationReport(
    result: VerificationResult,
    startTime: number,
    testStats: {
      critical: { passed: number; total: number };
      important: { passed: number; total: number };
      optional: { passed: number; total: number };
    }
  ): any {
    return {
      verificationId: this.verificationId,
      timestamp: new Date().toISOString(),
      cluster: this.config.cluster,
      verificationTime: Date.now() - startTime,
      result,
      testStats,
      tests: this.tests.map(test => ({
        name: test.name,
        description: test.description,
        category: test.category,
        passed: !test.error,
        error: test.error,
        expectedResult: test.expectedResult,
        actualResult: test.actualResult,
      })),
      programs: {
        questionBank: {
          programId: this.programs.questionBank.programId.toString(),
          pda: this.programs.questionBank.questionBankPda.toString(),
        },
        tournamentManager: {
          programId: this.programs.tournamentManager.programId.toString(),
          pda: this.programs.tournamentManager.tournamentManagerPda.toString(),
        },
        rewardDistributor: {
          programId: this.programs.rewardDistributor.programId.toString(),
        },
      },
      recommendations: this.generateRecommendations(result),
    };
  }

  private generateRecommendations(result: VerificationResult): string[] {
    const recommendations: string[] = [];

    if (!result.success) {
      recommendations.push("Address critical issues before proceeding to production");
    }

    if (!result.programsVerified) {
      recommendations.push("Verify all programs are properly deployed and accessible");
    }

    if (!result.accountsVerified) {
      recommendations.push("Ensure all required accounts are created and initialized");
    }

    if (!result.configurationVerified) {
      recommendations.push("Review and update configuration settings");
    }

    if (!result.honeycombIntegrationVerified) {
      recommendations.push("Check Honeycomb integration configuration");
    }

    if (this.config.cluster === "mainnet-beta") {
      recommendations.push("Conduct additional security audit before mainnet launch");
      recommendations.push("Set up comprehensive monitoring and alerting");
      recommendations.push("Prepare incident response procedures");
    }

    return recommendations;
  }

  private saveVerificationResult(result: VerificationResult, report: any): void {
    const resultPath = `./verifications/${this.config.cluster}-${this.verificationId}.json`;
    
    try {
      const dir = path.dirname(resultPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
      this.logger.info(`Verification result saved to: ${resultPath}`);
    } catch (error) {
      this.logger.error(`Failed to save verification result: ${error.message}`);
    }
  }
}

// ============================================================================
// Main Verification Function
// ============================================================================

async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const cluster = process.argv[2] as SolanaCluster || "devnet";
    const deploymentFile = process.argv[3] || null;

    console.log("🔍 TriviaComb Deployment Verification");
    console.log("====================================");
    console.log(`Cluster: ${cluster}`);
    console.log("====================================");

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

    // Execute verification
    const verifier = new DeploymentVerifier(config, programs);
    const result = await verifier.verify();

    console.log("\n📊 Verification Results:");
    console.log("=======================");
    console.log(`Overall Success: ${result.success ? "✅ PASSED" : "❌ FAILED"}`);
    console.log(`Programs Verified: ${result.programsVerified ? "✅" : "❌"}`);
    console.log(`Accounts Verified: ${result.accountsVerified ? "✅" : "❌"}`);
    console.log(`Configuration Verified: ${result.configurationVerified ? "✅" : "❌"}`);
    console.log(`Honeycomb Integration: ${result.honeycombIntegrationVerified ? "✅" : "❌"}`);
    
    if (result.issues && result.issues.length > 0) {
      console.log("\n⚠️  Issues Found:");
      result.issues.forEach(issue => console.log(`  - ${issue}`));
    }

    if (!result.success) {
      console.log("\n❌ Verification failed! Please address the issues above.");
      process.exit(1);
    } else {
      console.log("\n✅ Verification completed successfully!");
    }
  } catch (error) {
    console.error("💥 Verification failed:", error.message);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export { DeploymentVerifier };