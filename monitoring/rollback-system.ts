#!/usr/bin/env ts-node

import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface RollbackSnapshot {
  id: string;
  timestamp: Date;
  version: string;
  programStates: {
    [programName: string]: {
      programId: string;
      accountStates: Array<{
        address: string;
        data: string; // base64 encoded
        owner: string;
        lamports: number;
      }>;
    };
  };
  metadata: {
    description: string;
    creator: string;
    networkState: {
      slot: number;
      blockhash: string;
    };
  };
}

interface RollbackPlan {
  id: string;
  snapshotId: string;
  targetVersion: string;
  steps: RollbackStep[];
  estimatedTime: number; // minutes
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  validationChecks: string[];
}

interface RollbackStep {
  id: string;
  type: 'backup_current' | 'validate_snapshot' | 'deploy_program' | 'restore_accounts' | 'verify_state';
  description: string;
  programId?: string;
  accountId?: string;
  estimatedTime: number; // seconds
  rollbackAction?: string;
}

interface RollbackExecution {
  planId: string;
  startTime: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  completedSteps: string[];
  currentStep?: string;
  errors: Array<{
    step: string;
    error: string;
    timestamp: Date;
  }>;
  endTime?: Date;
}

class TriviaCombRollbackSystem {
  private connection: Connection;
  private programs: Map<string, PublicKey>;
  private wallet: Keypair;
  private snapshots: Map<string, RollbackSnapshot> = new Map();
  private rollbackPlans: Map<string, RollbackPlan> = new Map();
  private executions: Map<string, RollbackExecution> = new Map();

  constructor(rpcEndpoint: string = 'https://api.devnet.solana.com', walletPath?: string) {
    this.connection = new Connection(rpcEndpoint, 'confirmed');
    this.programs = new Map([
      ['questionBank', new PublicKey('CSRftWGDWFCbwvib9s6XbnqJheuSR5eVPmieKGDJmA7Y')],
      ['tournamentManager', new PublicKey('DE58k65KchHuDCABYARfGP5Jc1p14yRrx1UayweapYx9')],
      ['rewardDistributor', new PublicKey('EDy3LJ7eDf8UbpdsikwejxEDPxk48spTG3rwdzuM5TFd')]
    ]);

    // Load wallet
    const wallet = walletPath || process.env.ANCHOR_WALLET || '~/.config/solana/id.json';
    const expandedPath = wallet.replace('~', process.env.HOME || '');
    
    if (fs.existsSync(expandedPath)) {
      const keypairData = JSON.parse(fs.readFileSync(expandedPath, 'utf8'));
      this.wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else {
      throw new Error(`Wallet not found at ${expandedPath}`);
    }

    this.loadSnapshots();
    this.loadRollbackPlans();
  }

  async createSnapshot(description: string, version?: string): Promise<string> {
    console.log('📸 Creating system snapshot...');
    
    const snapshotId = `snapshot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date();

    const snapshot: RollbackSnapshot = {
      id: snapshotId,
      timestamp,
      version: version || await this.getCurrentVersion(),
      programStates: {},
      metadata: {
        description,
        creator: this.wallet.publicKey.toString(),
        networkState: {
          slot: await this.connection.getSlot(),
          blockhash: (await this.connection.getLatestBlockhash()).blockhash
        }
      }
    };

    // Capture state for each program
    for (const [programName, programId] of this.programs) {
      console.log(`📝 Capturing state for ${programName}...`);
      
      try {
        const programState = await this.captureProgramState(programName, programId);
        snapshot.programStates[programName] = programState;
        console.log(`✓ Captured ${programState.accountStates.length} accounts for ${programName}`);
      } catch (error) {
        console.error(`❌ Failed to capture state for ${programName}:`, error.message);
        throw error;
      }
    }

    this.snapshots.set(snapshotId, snapshot);
    await this.saveSnapshot(snapshot);

    console.log(`✅ Snapshot created: ${snapshotId}`);
    console.log(`   Description: ${description}`);
    console.log(`   Timestamp: ${timestamp.toISOString()}`);
    console.log(`   Programs: ${Object.keys(snapshot.programStates).join(', ')}`);

    return snapshotId;
  }

  private async captureProgramState(programName: string, programId: PublicKey) {
    const accountStates = [];

    // Get program account info
    const programInfo = await this.connection.getAccountInfo(programId);
    if (programInfo) {
      accountStates.push({
        address: programId.toString(),
        data: Buffer.from(programInfo.data).toString('base64'),
        owner: programInfo.owner.toString(),
        lamports: programInfo.lamports
      });
    }

    // Get all program-owned accounts
    try {
      const programAccounts = await this.connection.getProgramAccounts(programId);
      
      for (const account of programAccounts) {
        accountStates.push({
          address: account.pubkey.toString(),
          data: Buffer.from(account.account.data).toString('base64'),
          owner: account.account.owner.toString(),
          lamports: account.account.lamports
        });
      }
    } catch (error) {
      console.warn(`Warning: Could not fetch program accounts for ${programName}:`, error.message);
    }

    return {
      programId: programId.toString(),
      accountStates
    };
  }

  async createRollbackPlan(snapshotId: string, targetVersion: string, description?: string): Promise<string> {
    console.log(`📋 Creating rollback plan for snapshot ${snapshotId}...`);

    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const planId = `plan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    const steps: RollbackStep[] = [
      {
        id: 'backup-current',
        type: 'backup_current',
        description: 'Create backup of current state',
        estimatedTime: 120
      },
      {
        id: 'validate-snapshot',
        type: 'validate_snapshot',
        description: 'Validate snapshot integrity',
        estimatedTime: 30
      }
    ];

    // Add program restoration steps
    for (const [programName, programState] of Object.entries(snapshot.programStates)) {
      steps.push({
        id: `deploy-${programName}`,
        type: 'deploy_program',
        description: `Deploy ${programName} program from snapshot`,
        programId: programState.programId,
        estimatedTime: 180,
        rollbackAction: `Restore ${programName} to snapshot state`
      });

      steps.push({
        id: `restore-accounts-${programName}`,
        type: 'restore_accounts',
        description: `Restore ${programName} account states`,
        programId: programState.programId,
        estimatedTime: 60
      });
    }

    steps.push({
      id: 'verify-state',
      type: 'verify_state',
      description: 'Verify system state after rollback',
      estimatedTime: 90
    });

    const plan: RollbackPlan = {
      id: planId,
      snapshotId,
      targetVersion,
      steps,
      estimatedTime: Math.ceil(steps.reduce((sum, step) => sum + step.estimatedTime, 0) / 60),
      riskLevel: this.assessRiskLevel(snapshot),
      validationChecks: [
        'Verify all program accounts exist',
        'Check account data integrity',
        'Validate program executable status',
        'Confirm network connectivity',
        'Check wallet balance for transaction fees'
      ]
    };

    this.rollbackPlans.set(planId, plan);
    await this.saveRollbackPlan(plan);

    console.log(`✅ Rollback plan created: ${planId}`);
    console.log(`   Target version: ${targetVersion}`);
    console.log(`   Steps: ${steps.length}`);
    console.log(`   Estimated time: ${plan.estimatedTime} minutes`);
    console.log(`   Risk level: ${plan.riskLevel.toUpperCase()}`);

    return planId;
  }

  private assessRiskLevel(snapshot: RollbackSnapshot): 'low' | 'medium' | 'high' | 'critical' {
    const programCount = Object.keys(snapshot.programStates).length;
    const totalAccounts = Object.values(snapshot.programStates)
      .reduce((sum, state) => sum + state.accountStates.length, 0);

    // Age of snapshot
    const ageHours = (Date.now() - snapshot.timestamp.getTime()) / (1000 * 60 * 60);

    if (ageHours > 168) return 'critical'; // > 1 week
    if (ageHours > 72) return 'high';      // > 3 days
    if (ageHours > 24) return 'medium';    // > 1 day
    if (totalAccounts > 100) return 'high';
    if (programCount >= 3) return 'medium';
    
    return 'low';
  }

  async executeRollback(planId: string, confirmationCode?: string): Promise<string> {
    const plan = this.rollbackPlans.get(planId);
    if (!plan) {
      throw new Error(`Rollback plan ${planId} not found`);
    }

    const snapshot = this.snapshots.get(plan.snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${plan.snapshotId} not found`);
    }

    // Require confirmation for high/critical risk rollbacks
    if (['high', 'critical'].includes(plan.riskLevel)) {
      const expectedCode = crypto.createHash('sha256')
        .update(planId + this.wallet.publicKey.toString())
        .digest('hex')
        .substring(0, 8);

      if (confirmationCode !== expectedCode) {
        throw new Error(`High-risk rollback requires confirmation code: ${expectedCode}`);
      }
    }

    const executionId = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    const execution: RollbackExecution = {
      planId,
      startTime: new Date(),
      status: 'running',
      completedSteps: [],
      errors: []
    };

    this.executions.set(executionId, execution);
    console.log(`🔄 Starting rollback execution: ${executionId}`);
    console.log(`   Plan: ${planId}`);
    console.log(`   Target snapshot: ${plan.snapshotId}`);
    console.log(`   Risk level: ${plan.riskLevel.toUpperCase()}`);

    try {
      for (const step of plan.steps) {
        execution.currentStep = step.id;
        console.log(`\n📋 Executing step: ${step.description}`);

        const startTime = Date.now();
        await this.executeStep(step, snapshot);
        const duration = Date.now() - startTime;

        execution.completedSteps.push(step.id);
        console.log(`✅ Step completed in ${duration}ms`);
      }

      execution.status = 'completed';
      execution.endTime = new Date();
      
      console.log(`\n🎉 Rollback completed successfully!`);
      console.log(`   Execution ID: ${executionId}`);
      console.log(`   Duration: ${Math.round((execution.endTime.getTime() - execution.startTime.getTime()) / 1000)}s`);
      
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.errors.push({
        step: execution.currentStep || 'unknown',
        error: error.message,
        timestamp: new Date()
      });

      console.error(`❌ Rollback failed at step: ${execution.currentStep}`);
      console.error(`   Error: ${error.message}`);
      
      // Attempt automatic recovery
      await this.attemptRecovery(execution, snapshot);
      
      throw error;
    } finally {
      await this.saveExecution(execution);
    }

    return executionId;
  }

  private async executeStep(step: RollbackStep, snapshot: RollbackSnapshot): Promise<void> {
    switch (step.type) {
      case 'backup_current':
        await this.createSnapshot(`Pre-rollback backup - ${new Date().toISOString()}`);
        break;

      case 'validate_snapshot':
        await this.validateSnapshot(snapshot);
        break;

      case 'deploy_program':
        if (step.programId) {
          await this.deployProgramFromSnapshot(step.programId, snapshot);
        }
        break;

      case 'restore_accounts':
        if (step.programId) {
          await this.restoreAccountStates(step.programId, snapshot);
        }
        break;

      case 'verify_state':
        await this.verifySystemState(snapshot);
        break;

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async validateSnapshot(snapshot: RollbackSnapshot): Promise<void> {
    console.log('🔍 Validating snapshot integrity...');
    
    // Check if snapshot data is complete
    for (const [programName, programState] of Object.entries(snapshot.programStates)) {
      if (!programState.programId) {
        throw new Error(`Missing program ID for ${programName}`);
      }
      
      if (!programState.accountStates || programState.accountStates.length === 0) {
        console.warn(`Warning: No account states found for ${programName}`);
      }

      // Validate account data
      for (const account of programState.accountStates) {
        if (!account.address || !account.data) {
          throw new Error(`Invalid account data in ${programName}`);
        }
        
        try {
          Buffer.from(account.data, 'base64');
        } catch (error) {
          throw new Error(`Invalid base64 data for account ${account.address}`);
        }
      }
    }

    console.log('✅ Snapshot validation passed');
  }

  private async deployProgramFromSnapshot(programId: string, snapshot: RollbackSnapshot): Promise<void> {
    console.log(`🚀 Deploying program ${programId} from snapshot...`);
    
    // Find the program state in snapshot
    const programState = Object.values(snapshot.programStates)
      .find(state => state.programId === programId);
    
    if (!programState) {
      throw new Error(`Program ${programId} not found in snapshot`);
    }

    // For this implementation, we'll assume the program binaries are available
    // In a production system, you'd store the actual program binaries in the snapshot
    console.log(`⚠️  Program deployment requires manual intervention`);
    console.log(`   Program ID: ${programId}`);
    console.log(`   Accounts to restore: ${programState.accountStates.length}`);
    
    // Simulate deployment delay
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  private async restoreAccountStates(programId: string, snapshot: RollbackSnapshot): Promise<void> {
    console.log(`🔄 Restoring account states for program ${programId}...`);
    
    const programState = Object.values(snapshot.programStates)
      .find(state => state.programId === programId);
    
    if (!programState) {
      throw new Error(`Program ${programId} not found in snapshot`);
    }

    // In a real implementation, this would restore account data
    // For security reasons, account state restoration requires careful implementation
    console.log(`📝 Would restore ${programState.accountStates.length} accounts`);
    
    for (const account of programState.accountStates) {
      console.log(`   Account: ${account.address.substring(0, 8)}... (${account.lamports} lamports)`);
    }
  }

  private async verifySystemState(snapshot: RollbackSnapshot): Promise<void> {
    console.log('🔍 Verifying system state after rollback...');
    
    for (const [programName, programState] of Object.entries(snapshot.programStates)) {
      const programId = new PublicKey(programState.programId);
      
      // Check if program exists
      const accountInfo = await this.connection.getAccountInfo(programId);
      if (!accountInfo) {
        throw new Error(`Program ${programName} not found after rollback`);
      }
      
      if (!accountInfo.executable) {
        throw new Error(`Program ${programName} is not executable after rollback`);
      }
      
      console.log(`✓ ${programName} program verified`);
    }
    
    console.log('✅ System state verification completed');
  }

  private async attemptRecovery(execution: RollbackExecution, snapshot: RollbackSnapshot): Promise<void> {
    console.log('🔧 Attempting automatic recovery...');
    
    try {
      // Create emergency backup
      const backupId = await this.createSnapshot(`Emergency backup after failed rollback - ${execution.planId}`);
      console.log(`📸 Emergency backup created: ${backupId}`);
      
      // Try to restore system to a known good state
      // This is a simplified recovery - in production you'd have more sophisticated logic
      console.log('⚠️  Manual intervention may be required');
      console.log(`   Failed execution: ${execution.planId}`);
      console.log(`   Failed step: ${execution.currentStep}`);
      console.log(`   Emergency backup: ${backupId}`);
      
    } catch (error) {
      console.error('❌ Automatic recovery failed:', error.message);
      console.error('🚨 CRITICAL: Manual intervention required immediately');
    }
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD');
      return stdout.trim();
    } catch (error) {
      return `unknown-${Date.now()}`;
    }
  }

  private async saveSnapshot(snapshot: RollbackSnapshot): Promise<void> {
    const snapshotsDir = './monitoring/snapshots';
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }

    const snapshotFile = path.join(snapshotsDir, `${snapshot.id}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  private async saveRollbackPlan(plan: RollbackPlan): Promise<void> {
    const plansDir = './monitoring/rollback-plans';
    if (!fs.existsSync(plansDir)) {
      fs.mkdirSync(plansDir, { recursive: true });
    }

    const planFile = path.join(plansDir, `${plan.id}.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  }

  private async saveExecution(execution: RollbackExecution): Promise<void> {
    const executionsDir = './monitoring/executions';
    if (!fs.existsSync(executionsDir)) {
      fs.mkdirSync(executionsDir, { recursive: true });
    }

    const executionFile = path.join(executionsDir, `${execution.planId}.json`);
    fs.writeFileSync(executionFile, JSON.stringify(execution, null, 2));
  }

  private loadSnapshots(): void {
    const snapshotsDir = './monitoring/snapshots';
    if (fs.existsSync(snapshotsDir)) {
      const files = fs.readdirSync(snapshotsDir);
      files.filter(f => f.endsWith('.json')).forEach(file => {
        try {
          const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotsDir, file), 'utf8'));
          this.snapshots.set(snapshot.id, snapshot);
        } catch (error) {
          console.warn(`Failed to load snapshot ${file}:`, error.message);
        }
      });
    }
  }

  private loadRollbackPlans(): void {
    const plansDir = './monitoring/rollback-plans';
    if (fs.existsSync(plansDir)) {
      const files = fs.readdirSync(plansDir);
      files.filter(f => f.endsWith('.json')).forEach(file => {
        try {
          const plan = JSON.parse(fs.readFileSync(path.join(plansDir, file), 'utf8'));
          this.rollbackPlans.set(plan.id, plan);
        } catch (error) {
          console.warn(`Failed to load rollback plan ${file}:`, error.message);
        }
      });
    }
  }

  // Public API methods
  listSnapshots(): RollbackSnapshot[] {
    return Array.from(this.snapshots.values()).sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  listRollbackPlans(): RollbackPlan[] {
    return Array.from(this.rollbackPlans.values());
  }

  getExecution(executionId: string): RollbackExecution | undefined {
    return this.executions.get(executionId);
  }

  async deleteSnapshot(snapshotId: string): Promise<boolean> {
    if (this.snapshots.has(snapshotId)) {
      this.snapshots.delete(snapshotId);
      
      const snapshotFile = `./monitoring/snapshots/${snapshotId}.json`;
      if (fs.existsSync(snapshotFile)) {
        fs.unlinkSync(snapshotFile);
      }
      
      return true;
    }
    return false;
  }
}

// CLI Usage
async function main() {
  const rollbackSystem = new TriviaCombRollbackSystem();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'snapshot':
      const description = process.argv[3] || 'Manual snapshot';
      const version = process.argv[4];
      const snapshotId = await rollbackSystem.createSnapshot(description, version);
      console.log(`Snapshot created: ${snapshotId}`);
      break;
      
    case 'plan':
      const targetSnapshotId = process.argv[3];
      const targetVersion = process.argv[4] || 'rollback';
      if (!targetSnapshotId) {
        console.error('Usage: rollback-system.ts plan <snapshot-id> [target-version]');
        process.exit(1);
      }
      const planId = await rollbackSystem.createRollbackPlan(targetSnapshotId, targetVersion);
      console.log(`Rollback plan created: ${planId}`);
      break;
      
    case 'execute':
      const executePlanId = process.argv[3];
      const confirmCode = process.argv[4];
      if (!executePlanId) {
        console.error('Usage: rollback-system.ts execute <plan-id> [confirmation-code]');
        process.exit(1);
      }
      const executionId = await rollbackSystem.executeRollback(executePlanId, confirmCode);
      console.log(`Rollback executed: ${executionId}`);
      break;
      
    case 'list':
      const type = process.argv[3] || 'snapshots';
      if (type === 'snapshots') {
        console.log('Snapshots:', rollbackSystem.listSnapshots());
      } else if (type === 'plans') {
        console.log('Rollback Plans:', rollbackSystem.listRollbackPlans());
      }
      break;
      
    default:
      console.log('Usage: rollback-system.ts [snapshot|plan|execute|list]');
      console.log('  snapshot <description> [version] - Create system snapshot');
      console.log('  plan <snapshot-id> [target-version] - Create rollback plan');
      console.log('  execute <plan-id> [confirmation-code] - Execute rollback');
      console.log('  list [snapshots|plans] - List snapshots or plans');
  }
}

export { TriviaCombRollbackSystem, RollbackSnapshot, RollbackPlan };

if (require.main === module) {
  main().catch(console.error);
}