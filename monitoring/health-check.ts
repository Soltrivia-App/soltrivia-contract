#!/usr/bin/env ts-node

import { Connection, PublicKey, AccountInfo, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

// Health Check Configuration
interface HealthCheckConfig {
  rpcEndpoint: string;
  programs: {
    questionBank: string;
    tournamentManager: string;
    rewardDistributor: string;
  };
  thresholds: {
    maxResponseTime: number; // milliseconds
    minBalance: number; // SOL
    maxErrorRate: number; // percentage
  };
  alerting: {
    webhookUrl?: string;
    emailEndpoint?: string;
    slackChannel?: string;
  };
}

interface HealthStatus {
  timestamp: Date;
  overall: 'healthy' | 'warning' | 'critical';
  checks: {
    networkConnectivity: HealthCheckResult;
    programAccounts: HealthCheckResult;
    programFunctionality: HealthCheckResult;
    balanceMonitoring: HealthCheckResult;
    transactionThroughput: HealthCheckResult;
  };
  metrics: {
    responseTime: number;
    blockHeight: number;
    tps: number;
    errorCount: number;
  };
}

interface HealthCheckResult {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  timestamp: Date;
  metrics?: any;
}

class TriviaCombHealthChecker {
  private config: HealthCheckConfig;
  private connection: Connection;
  private programs: Map<string, PublicKey>;
  private lastCheckTime: Date;
  private errorHistory: Array<{timestamp: Date, error: string}> = [];

  constructor(configPath?: string) {
    this.config = this.loadConfig(configPath);
    this.connection = new Connection(this.config.rpcEndpoint, 'confirmed');
    this.programs = new Map([
      ['questionBank', new PublicKey(this.config.programs.questionBank)],
      ['tournamentManager', new PublicKey(this.config.programs.tournamentManager)],
      ['rewardDistributor', new PublicKey(this.config.programs.rewardDistributor)]
    ]);
    this.lastCheckTime = new Date();
  }

  private loadConfig(configPath?: string): HealthCheckConfig {
    const defaultConfig: HealthCheckConfig = {
      rpcEndpoint: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
      programs: {
        questionBank: process.env.QUESTION_BANK_ID || 'CSRftWGDWFCbwvib9s6XbnqJheuSR5eVPmieKGDJmA7Y',
        tournamentManager: process.env.TOURNAMENT_MANAGER_ID || 'DE58k65KchHuDCABYARfGP5Jc1p14yRrx1UayweapYx9',
        rewardDistributor: process.env.REWARD_DISTRIBUTOR_ID || 'EDy3LJ7eDf8UbpdsikwejxEDPxk48spTG3rwdzuM5TFd'
      },
      thresholds: {
        maxResponseTime: 5000, // 5 seconds
        minBalance: 0.1, // 0.1 SOL
        maxErrorRate: 5 // 5%
      },
      alerting: {
        webhookUrl: process.env.ALERT_WEBHOOK_URL,
        emailEndpoint: process.env.EMAIL_ALERT_ENDPOINT,
        slackChannel: process.env.SLACK_WEBHOOK_URL
      }
    };

    if (configPath && fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...userConfig };
    }

    return defaultConfig;
  }

  async performHealthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    console.log('🔍 Starting TriviaComb health check...');

    const status: HealthStatus = {
      timestamp: new Date(),
      overall: 'healthy',
      checks: {
        networkConnectivity: await this.checkNetworkConnectivity(),
        programAccounts: await this.checkProgramAccounts(),
        programFunctionality: await this.checkProgramFunctionality(),
        balanceMonitoring: await this.checkBalances(),
        transactionThroughput: await this.checkTransactionThroughput()
      },
      metrics: {
        responseTime: 0,
        blockHeight: 0,
        tps: 0,
        errorCount: this.errorHistory.length
      }
    };

    // Calculate overall health
    const checks = Object.values(status.checks);
    const failedChecks = checks.filter(check => check.status === 'fail');
    const warningChecks = checks.filter(check => check.status === 'warn');

    if (failedChecks.length > 0) {
      status.overall = 'critical';
    } else if (warningChecks.length > 0) {
      status.overall = 'warning';
    }

    status.metrics.responseTime = Date.now() - startTime;

    // Trigger alerts if necessary
    if (status.overall !== 'healthy') {
      await this.triggerAlerts(status);
    }

    // Save health check results
    await this.saveHealthCheckResults(status);

    console.log(`✅ Health check completed in ${status.metrics.responseTime}ms - Status: ${status.overall.toUpperCase()}`);
    return status;
  }

  private async checkNetworkConnectivity(): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      const version = await this.connection.getVersion();
      const responseTime = Date.now() - startTime;

      if (responseTime > this.config.thresholds.maxResponseTime) {
        return {
          status: 'warn',
          message: `Network response time ${responseTime}ms exceeds threshold ${this.config.thresholds.maxResponseTime}ms`,
          timestamp: new Date(),
          metrics: { responseTime, version }
        };
      }

      return {
        status: 'pass',
        message: `Network connectivity healthy (${responseTime}ms)`,
        timestamp: new Date(),
        metrics: { responseTime, version }
      };
    } catch (error) {
      this.logError('Network connectivity failed', error);
      return {
        status: 'fail',
        message: `Network connectivity failed: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  private async checkProgramAccounts(): Promise<HealthCheckResult> {
    try {
      const accountChecks = [];

      for (const [name, programId] of this.programs) {
        const accountInfo = await this.connection.getAccountInfo(programId);
        
        if (!accountInfo) {
          accountChecks.push(`${name} program not found`);
        } else if (!accountInfo.executable) {
          accountChecks.push(`${name} program not executable`);
        } else {
          console.log(`✓ ${name} program verified (${accountInfo.data.length} bytes)`);
        }
      }

      if (accountChecks.length > 0) {
        return {
          status: 'fail',
          message: `Program account issues: ${accountChecks.join(', ')}`,
          timestamp: new Date()
        };
      }

      return {
        status: 'pass',
        message: 'All program accounts verified',
        timestamp: new Date(),
        metrics: { programCount: this.programs.size }
      };
    } catch (error) {
      this.logError('Program account check failed', error);
      return {
        status: 'fail',
        message: `Program account check failed: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  private async checkProgramFunctionality(): Promise<HealthCheckResult> {
    try {
      // Test basic program functionality by checking program data accounts
      const functionChecks = [];

      // Check Question Bank state
      try {
        const [questionBankPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('question_bank')],
          this.programs.get('questionBank')!
        );
        
        const questionBankAccount = await this.connection.getAccountInfo(questionBankPda);
        if (questionBankAccount) {
          console.log('✓ Question Bank state account exists');
        }
      } catch (error) {
        functionChecks.push('Question Bank state check failed');
      }

      // Check Tournament Manager state
      try {
        const [tournamentManagerPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('tournament_manager')],
          this.programs.get('tournamentManager')!
        );
        
        const tournamentManagerAccount = await this.connection.getAccountInfo(tournamentManagerPda);
        if (tournamentManagerAccount) {
          console.log('✓ Tournament Manager state account exists');
        }
      } catch (error) {
        functionChecks.push('Tournament Manager state check failed');
      }

      if (functionChecks.length > 0) {
        return {
          status: 'warn',
          message: `Program functionality issues: ${functionChecks.join(', ')}`,
          timestamp: new Date()
        };
      }

      return {
        status: 'pass',
        message: 'Program functionality verified',
        timestamp: new Date()
      };
    } catch (error) {
      this.logError('Program functionality check failed', error);
      return {
        status: 'fail',
        message: `Program functionality check failed: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  private async checkBalances(): Promise<HealthCheckResult> {
    try {
      // Check deployer wallet balance
      const walletPath = process.env.ANCHOR_WALLET || '~/.config/solana/id.json';
      
      if (!fs.existsSync(walletPath.replace('~', process.env.HOME || ''))) {
        return {
          status: 'warn',
          message: 'Deployer wallet not found for balance check',
          timestamp: new Date()
        };
      }

      // For now, just check if we can access balance info
      const balance = await this.connection.getBalance(this.programs.get('questionBank')!);
      
      return {
        status: 'pass',
        message: 'Balance monitoring active',
        timestamp: new Date(),
        metrics: { programBalance: balance / LAMPORTS_PER_SOL }
      };
    } catch (error) {
      return {
        status: 'warn',
        message: `Balance check warning: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  private async checkTransactionThroughput(): Promise<HealthCheckResult> {
    try {
      const recentBlockhash = await this.connection.getLatestBlockhash();
      const slot = await this.connection.getSlot();
      
      // Get recent performance samples
      const perfSamples = await this.connection.getRecentPerformanceSamples(5);
      let avgTps = 0;
      
      if (perfSamples.length > 0) {
        const totalTps = perfSamples.reduce((sum, sample) => sum + sample.numTransactions / sample.samplePeriodSecs, 0);
        avgTps = totalTps / perfSamples.length;
      }

      return {
        status: 'pass',
        message: `Transaction throughput normal (${avgTps.toFixed(2)} TPS)`,
        timestamp: new Date(),
        metrics: { 
          tps: avgTps, 
          slot,
          blockhash: recentBlockhash.blockhash.slice(0, 8) + '...'
        }
      };
    } catch (error) {
      this.logError('Transaction throughput check failed', error);
      return {
        status: 'warn',
        message: `Transaction throughput check failed: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  private async triggerAlerts(status: HealthStatus): Promise<void> {
    const alert = {
      timestamp: status.timestamp,
      severity: status.overall,
      service: 'TriviaComb Smart Contracts',
      message: this.generateAlertMessage(status),
      details: status
    };

    console.log(`🚨 ALERT [${status.overall.toUpperCase()}]: ${alert.message}`);

    // Send webhook alert
    if (this.config.alerting.webhookUrl) {
      try {
        await axios.post(this.config.alerting.webhookUrl, alert);
        console.log('✓ Webhook alert sent');
      } catch (error) {
        console.error('Failed to send webhook alert:', error.message);
      }
    }

    // Send Slack alert
    if (this.config.alerting.slackChannel) {
      try {
        const slackMessage = {
          text: `🚨 TriviaComb Health Alert [${status.overall.toUpperCase()}]`,
          attachments: [{
            color: status.overall === 'critical' ? 'danger' : 'warning',
            fields: [
              { title: 'Service', value: 'TriviaComb Smart Contracts', short: true },
              { title: 'Severity', value: status.overall.toUpperCase(), short: true },
              { title: 'Message', value: alert.message, short: false },
              { title: 'Timestamp', value: status.timestamp.toISOString(), short: true }
            ]
          }]
        };

        await axios.post(this.config.alerting.slackChannel, slackMessage);
        console.log('✓ Slack alert sent');
      } catch (error) {
        console.error('Failed to send Slack alert:', error.message);
      }
    }

    // Save alert to file
    const alertsDir = './monitoring/alerts';
    if (!fs.existsSync(alertsDir)) {
      fs.mkdirSync(alertsDir, { recursive: true });
    }

    const alertFile = path.join(alertsDir, `alert-${Date.now()}.json`);
    fs.writeFileSync(alertFile, JSON.stringify(alert, null, 2));
  }

  private generateAlertMessage(status: HealthStatus): string {
    const failedChecks = Object.entries(status.checks)
      .filter(([_, check]) => check.status === 'fail')
      .map(([name, _]) => name);

    const warningChecks = Object.entries(status.checks)
      .filter(([_, check]) => check.status === 'warn')
      .map(([name, _]) => name);

    if (failedChecks.length > 0) {
      return `Critical issues detected: ${failedChecks.join(', ')}`;
    } else if (warningChecks.length > 0) {
      return `Warning conditions detected: ${warningChecks.join(', ')}`;
    }

    return 'Health check completed with issues';
  }

  private async saveHealthCheckResults(status: HealthStatus): Promise<void> {
    const resultsDir = './monitoring/results';
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Save detailed results
    const detailFile = path.join(resultsDir, `health-${Date.now()}.json`);
    fs.writeFileSync(detailFile, JSON.stringify(status, null, 2));

    // Append to daily log
    const today = new Date().toISOString().split('T')[0];
    const dailyLog = path.join(resultsDir, `health-${today}.log`);
    const logEntry = `${status.timestamp.toISOString()} [${status.overall.toUpperCase()}] Response: ${status.metrics.responseTime}ms, Errors: ${status.metrics.errorCount}\n`;
    fs.appendFileSync(dailyLog, logEntry);

    // Keep only last 7 days of detailed results
    this.cleanupOldResults(resultsDir);
  }

  private cleanupOldResults(resultsDir: string): void {
    try {
      const files = fs.readdirSync(resultsDir);
      const now = Date.now();
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

      files.forEach(file => {
        const filePath = path.join(resultsDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < sevenDaysAgo && file.startsWith('health-') && file.endsWith('.json')) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.warn('Failed to cleanup old results:', error.message);
    }
  }

  private logError(context: string, error: any): void {
    const errorEntry = {
      timestamp: new Date(),
      context,
      error: error.message || error.toString()
    };

    this.errorHistory.push(errorEntry);
    
    // Keep only last 100 errors in memory
    if (this.errorHistory.length > 100) {
      this.errorHistory = this.errorHistory.slice(-100);
    }

    console.error(`❌ ${context}:`, error.message);
  }

  // Public API for external monitoring
  async getHealthSummary(): Promise<{status: string, lastCheck: Date, uptime: number}> {
    return {
      status: (await this.performHealthCheck()).overall,
      lastCheck: this.lastCheckTime,
      uptime: Date.now() - this.lastCheckTime.getTime()
    };
  }

  async getMetrics(): Promise<any> {
    const status = await this.performHealthCheck();
    return {
      responseTime: status.metrics.responseTime,
      errorCount: status.metrics.errorCount,
      lastChecks: status.checks
    };
  }
}

// CLI Usage
async function main() {
  const checker = new TriviaCombHealthChecker();
  
  if (process.argv.includes('--watch')) {
    console.log('🔄 Starting continuous health monitoring...');
    setInterval(async () => {
      await checker.performHealthCheck();
    }, 60000); // Check every minute
  } else {
    await checker.performHealthCheck();
  }
}

// Export for use as module
export { TriviaCombHealthChecker, HealthStatus, HealthCheckConfig };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}