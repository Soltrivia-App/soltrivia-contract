#!/usr/bin/env ts-node

import { Connection, PublicKey, GetProgramAccountsFilter, AccountInfo } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import nodemailer from 'nodemailer';

interface AlertRule {
  id: string;
  name: string;
  description: string;
  type: 'account_change' | 'transaction_volume' | 'error_rate' | 'balance_threshold' | 'performance';
  conditions: {
    metric: string;
    operator: '>' | '<' | '==' | '!=' | '>=' | '<=';
    threshold: number | string;
    timeWindow?: number; // minutes
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldown: number; // minutes
  notifications: {
    email?: string[];
    slack?: string;
    webhook?: string;
    sms?: string[];
  };
}

interface Alert {
  id: string;
  ruleId: string;
  timestamp: Date;
  severity: string;
  title: string;
  message: string;
  metadata: any;
  acknowledged: boolean;
  resolvedAt?: Date;
}

interface MetricData {
  timestamp: Date;
  metric: string;
  value: number;
  metadata?: any;
}

class TriviaCombAlertSystem {
  private connection: Connection;
  private programs: Map<string, PublicKey>;
  private alertRules: AlertRule[] = [];
  private activeAlerts: Map<string, Alert> = new Map();
  private metrics: MetricData[] = [];
  private lastAlertTimes: Map<string, Date> = new Map();

  constructor(rpcEndpoint: string = 'https://api.devnet.solana.com') {
    this.connection = new Connection(rpcEndpoint, 'confirmed');
    this.programs = new Map([
      ['questionBank', new PublicKey('CSRftWGDWFCbwvib9s6XbnqJheuSR5eVPmieKGDJmA7Y')],
      ['tournamentManager', new PublicKey('DE58k65KchHuDCABYARfGP5Jc1p14yRrx1UayweapYx9')],
      ['rewardDistributor', new PublicKey('EDy3LJ7eDf8UbpdsikwejxEDPxk48spTG3rwdzuM5TFd')]
    ]);

    this.loadAlertRules();
    this.setupDefaultRules();
  }

  private setupDefaultRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-error-rate',
        name: 'High Error Rate',
        description: 'Transaction error rate exceeds threshold',
        type: 'error_rate',
        conditions: {
          metric: 'error_rate',
          operator: '>',
          threshold: 10, // 10%
          timeWindow: 5
        },
        severity: 'high',
        enabled: true,
        cooldown: 15,
        notifications: {
          email: [process.env.ADMIN_EMAIL].filter(Boolean),
          slack: process.env.SLACK_WEBHOOK_URL
        }
      },
      {
        id: 'program-account-missing',
        name: 'Program Account Missing',
        description: 'Critical program account not found',
        type: 'account_change',
        conditions: {
          metric: 'program_exists',
          operator: '==',
          threshold: 0
        },
        severity: 'critical',
        enabled: true,
        cooldown: 5,
        notifications: {
          email: [process.env.ADMIN_EMAIL].filter(Boolean),
          slack: process.env.SLACK_WEBHOOK_URL,
          webhook: process.env.EMERGENCY_WEBHOOK
        }
      },
      {
        id: 'low-balance-warning',
        name: 'Low Balance Warning',
        description: 'Deployer wallet balance is low',
        type: 'balance_threshold',
        conditions: {
          metric: 'wallet_balance',
          operator: '<',
          threshold: 0.5 // 0.5 SOL
        },
        severity: 'medium',
        enabled: true,
        cooldown: 60,
        notifications: {
          email: [process.env.ADMIN_EMAIL].filter(Boolean)
        }
      },
      {
        id: 'high-response-time',
        name: 'High Response Time',
        description: 'RPC response time is too high',
        type: 'performance',
        conditions: {
          metric: 'response_time',
          operator: '>',
          threshold: 5000, // 5 seconds
          timeWindow: 3
        },
        severity: 'medium',
        enabled: true,
        cooldown: 10,
        notifications: {
          slack: process.env.SLACK_WEBHOOK_URL
        }
      },
      {
        id: 'unusual-transaction-volume',
        name: 'Unusual Transaction Volume',
        description: 'Transaction volume significantly different from normal',
        type: 'transaction_volume',
        conditions: {
          metric: 'transaction_count',
          operator: '>',
          threshold: 1000, // transactions per hour
          timeWindow: 60
        },
        severity: 'low',
        enabled: true,
        cooldown: 30,
        notifications: {
          slack: process.env.SLACK_WEBHOOK_URL
        }
      }
    ];

    // Add default rules if they don't exist
    defaultRules.forEach(rule => {
      if (!this.alertRules.find(r => r.id === rule.id)) {
        this.alertRules.push(rule);
      }
    });

    this.saveAlertRules();
  }

  private loadAlertRules(): void {
    const rulesFile = './monitoring/alert-rules.json';
    if (fs.existsSync(rulesFile)) {
      try {
        this.alertRules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
      } catch (error) {
        console.error('Failed to load alert rules:', error);
      }
    }
  }

  private saveAlertRules(): void {
    const rulesFile = './monitoring/alert-rules.json';
    const rulesDir = path.dirname(rulesFile);
    
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
    
    fs.writeFileSync(rulesFile, JSON.stringify(this.alertRules, null, 2));
  }

  async collectMetrics(): Promise<void> {
    const timestamp = new Date();
    
    try {
      // Collect network metrics
      const startTime = Date.now();
      const version = await this.connection.getVersion();
      const responseTime = Date.now() - startTime;
      
      this.addMetric({
        timestamp,
        metric: 'response_time',
        value: responseTime
      });

      // Collect program account metrics
      for (const [name, programId] of this.programs) {
        const accountInfo = await this.connection.getAccountInfo(programId);
        this.addMetric({
          timestamp,
          metric: 'program_exists',
          value: accountInfo ? 1 : 0,
          metadata: { program: name, programId: programId.toString() }
        });

        if (accountInfo) {
          this.addMetric({
            timestamp,
            metric: 'program_data_size',
            value: accountInfo.data.length,
            metadata: { program: name }
          });
        }
      }

      // Collect transaction metrics
      const perfSamples = await this.connection.getRecentPerformanceSamples(1);
      if (perfSamples.length > 0) {
        const sample = perfSamples[0];
        const tps = sample.numTransactions / sample.samplePeriodSecs;
        
        this.addMetric({
          timestamp,
          metric: 'transactions_per_second',
          value: tps
        });

        this.addMetric({
          timestamp,
          metric: 'transaction_count',
          value: sample.numTransactions,
          metadata: { samplePeriod: sample.samplePeriodSecs }
        });
      }

      // Collect slot metrics
      const slot = await this.connection.getSlot();
      this.addMetric({
        timestamp,
        metric: 'current_slot',
        value: slot
      });

    } catch (error) {
      console.error('Failed to collect metrics:', error);
      this.addMetric({
        timestamp,
        metric: 'collection_error',
        value: 1,
        metadata: { error: error.message }
      });
    }

    // Check alert rules
    await this.evaluateAlertRules();
  }

  private addMetric(metric: MetricData): void {
    this.metrics.push(metric);
    
    // Keep only last 1000 metrics in memory
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    // Save metrics to file periodically
    this.saveMetricsToFile();
  }

  private saveMetricsToFile(): void {
    const metricsDir = './monitoring/metrics';
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const today = new Date().toISOString().split('T')[0];
    const metricsFile = path.join(metricsDir, `metrics-${today}.jsonl`);
    
    // Append new metrics to daily file
    const newMetrics = this.metrics.slice(-10); // Last 10 metrics
    newMetrics.forEach(metric => {
      fs.appendFileSync(metricsFile, JSON.stringify(metric) + '\n');
    });
  }

  private async evaluateAlertRules(): Promise<void> {
    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastAlert = this.lastAlertTimes.get(rule.id);
      if (lastAlert) {
        const cooldownMs = rule.cooldown * 60 * 1000;
        if (Date.now() - lastAlert.getTime() < cooldownMs) {
          continue;
        }
      }

      try {
        const shouldAlert = await this.evaluateRule(rule);
        if (shouldAlert) {
          await this.triggerAlert(rule);
        }
      } catch (error) {
        console.error(`Failed to evaluate rule ${rule.id}:`, error);
      }
    }
  }

  private async evaluateRule(rule: AlertRule): Promise<boolean> {
    const timeWindow = rule.conditions.timeWindow || 5; // default 5 minutes
    const cutoffTime = new Date(Date.now() - timeWindow * 60 * 1000);
    
    const relevantMetrics = this.metrics.filter(m => 
      m.metric === rule.conditions.metric && m.timestamp >= cutoffTime
    );

    if (relevantMetrics.length === 0) return false;

    let value: number;
    
    // Calculate aggregated value based on metric type
    switch (rule.type) {
      case 'error_rate':
        const totalMetrics = this.metrics.filter(m => m.timestamp >= cutoffTime);
        const errorMetrics = totalMetrics.filter(m => m.metric === 'collection_error');
        value = totalMetrics.length > 0 ? (errorMetrics.length / totalMetrics.length) * 100 : 0;
        break;
        
      case 'performance':
        value = relevantMetrics.reduce((sum, m) => sum + m.value, 0) / relevantMetrics.length;
        break;
        
      case 'account_change':
      case 'balance_threshold':
        value = relevantMetrics[relevantMetrics.length - 1]?.value || 0;
        break;
        
      case 'transaction_volume':
        value = relevantMetrics.reduce((sum, m) => sum + m.value, 0);
        break;
        
      default:
        value = relevantMetrics[relevantMetrics.length - 1]?.value || 0;
    }

    // Evaluate condition
    const threshold = Number(rule.conditions.threshold);
    
    switch (rule.conditions.operator) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default: return false;
    }
  }

  private async triggerAlert(rule: AlertRule): Promise<void> {
    const alert: Alert = {
      id: `alert-${Date.now()}-${rule.id}`,
      ruleId: rule.id,
      timestamp: new Date(),
      severity: rule.severity,
      title: rule.name,
      message: this.generateAlertMessage(rule),
      metadata: { rule },
      acknowledged: false
    };

    console.log(`🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.title}`);
    console.log(`   ${alert.message}`);

    this.activeAlerts.set(alert.id, alert);
    this.lastAlertTimes.set(rule.id, alert.timestamp);

    // Send notifications
    await this.sendNotifications(alert, rule);

    // Save alert
    this.saveAlert(alert);
  }

  private generateAlertMessage(rule: AlertRule): string {
    const recentMetrics = this.metrics
      .filter(m => m.metric === rule.conditions.metric)
      .slice(-5);
    
    const latestValue = recentMetrics[recentMetrics.length - 1]?.value || 'unknown';
    
    return `${rule.description}. Current value: ${latestValue}, Threshold: ${rule.conditions.threshold}`;
  }

  private async sendNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    // Email notifications
    if (rule.notifications.email && rule.notifications.email.length > 0) {
      await this.sendEmailAlert(alert, rule.notifications.email);
    }

    // Slack notifications
    if (rule.notifications.slack) {
      await this.sendSlackAlert(alert, rule.notifications.slack);
    }

    // Webhook notifications
    if (rule.notifications.webhook) {
      await this.sendWebhookAlert(alert, rule.notifications.webhook);
    }
  }

  private async sendEmailAlert(alert: Alert, emails: string[]): Promise<void> {
    try {
      const transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });

      const subject = `[${alert.severity.toUpperCase()}] TriviaComb Alert: ${alert.title}`;
      const html = `
        <h2>TriviaComb Smart Contract Alert</h2>
        <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
        <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
        <p><strong>Alert:</strong> ${alert.title}</p>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Alert ID:</strong> ${alert.id}</p>
        
        <hr>
        <p><em>This alert was generated by the TriviaComb monitoring system.</em></p>
      `;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@triviacomb.com',
        to: emails.join(', '),
        subject,
        html
      });

      console.log('✓ Email alert sent');
    } catch (error) {
      console.error('Failed to send email alert:', error);
    }
  }

  private async sendSlackAlert(alert: Alert, webhookUrl: string): Promise<void> {
    try {
      const color = {
        low: 'good',
        medium: 'warning',
        high: 'danger',
        critical: 'danger'
      }[alert.severity] || 'warning';

      const message = {
        text: `🚨 TriviaComb Alert [${alert.severity.toUpperCase()}]`,
        attachments: [{
          color,
          fields: [
            { title: 'Alert', value: alert.title, short: true },
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Message', value: alert.message, short: false },
            { title: 'Time', value: alert.timestamp.toISOString(), short: true },
            { title: 'Alert ID', value: alert.id, short: true }
          ]
        }]
      };

      await axios.post(webhookUrl, message);
      console.log('✓ Slack alert sent');
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }

  private async sendWebhookAlert(alert: Alert, webhookUrl: string): Promise<void> {
    try {
      await axios.post(webhookUrl, {
        type: 'triviacomb_alert',
        alert,
        timestamp: new Date().toISOString()
      });
      console.log('✓ Webhook alert sent');
    } catch (error) {
      console.error('Failed to send webhook alert:', error);
    }
  }

  private saveAlert(alert: Alert): void {
    const alertsDir = './monitoring/alerts';
    if (!fs.existsSync(alertsDir)) {
      fs.mkdirSync(alertsDir, { recursive: true });
    }

    const alertFile = path.join(alertsDir, `${alert.id}.json`);
    fs.writeFileSync(alertFile, JSON.stringify(alert, null, 2));

    // Also append to daily alert log
    const today = new Date().toISOString().split('T')[0];
    const dailyLog = path.join(alertsDir, `alerts-${today}.log`);
    const logEntry = `${alert.timestamp.toISOString()} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}\n`;
    fs.appendFileSync(dailyLog, logEntry);
  }

  // Management methods
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
    this.saveAlertRules();
  }

  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const ruleIndex = this.alertRules.findIndex(r => r.id === ruleId);
    if (ruleIndex >= 0) {
      this.alertRules[ruleIndex] = { ...this.alertRules[ruleIndex], ...updates };
      this.saveAlertRules();
      return true;
    }
    return false;
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.saveAlert(alert);
      return true;
    }
    return false;
  }

  resolveAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      this.saveAlert(alert);
      this.activeAlerts.delete(alertId);
      return true;
    }
    return false;
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertRules(): AlertRule[] {
    return this.alertRules;
  }

  async startMonitoring(intervalSeconds: number = 60): Promise<void> {
    console.log(`🔄 Starting TriviaComb alert monitoring (${intervalSeconds}s intervals)`);
    
    setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        console.error('Monitoring error:', error);
      }
    }, intervalSeconds * 1000);

    // Initial collection
    await this.collectMetrics();
  }
}

// CLI Usage
async function main() {
  const alertSystem = new TriviaCombAlertSystem();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'start':
      const interval = parseInt(process.argv[3]) || 60;
      await alertSystem.startMonitoring(interval);
      break;
      
    case 'check':
      await alertSystem.collectMetrics();
      break;
      
    case 'alerts':
      console.log('Active alerts:', alertSystem.getActiveAlerts());
      break;
      
    case 'rules':
      console.log('Alert rules:', alertSystem.getAlertRules());
      break;
      
    default:
      console.log('Usage: alert-system.ts [start|check|alerts|rules]');
      console.log('  start [interval] - Start continuous monitoring');
      console.log('  check - Run one-time metrics collection');
      console.log('  alerts - Show active alerts');
      console.log('  rules - Show alert rules');
  }
}

export { TriviaCombAlertSystem, AlertRule, Alert };

if (require.main === module) {
  main().catch(console.error);
}