// lib/utils/googleSheets.js - Enhanced Google Sheets Integration with Logs Sheet
import { GoogleAuth } from 'google-auth-library';
import { sheets } from '@googleapis/sheets';
import { Logger } from './logger.js';

export class GoogleSheetsLogger {
  constructor() {
    this.logger = new Logger();
    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    
    // Better private key handling
    let privateKey;
    try {
      privateKey = process.env.GOOGLE_PRIVATE_KEY;
      // Handle different private key formats
      if (privateKey) {
        // Replace literal \\n with actual newlines
        privateKey = privateKey.replace(/\\\\n/g, '\n');
        privateKey = privateKey.replace(/\\n/g, '\n');
        // Ensure proper format
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          throw new Error('Private key format is invalid');
        }
      }
    } catch (error) {
      this.logger.error('Private key parsing error', { error: error.message });
      privateKey = null;
    }

    if (!privateKey || !process.env.GOOGLE_CLIENT_EMAIL || !this.spreadsheetId) {
      this.logger.warning('Google Sheets integration disabled - missing credentials', {
        hasPrivateKey: !!privateKey,
        hasClientEmail: !!process.env.GOOGLE_CLIENT_EMAIL,
        hasSpreadsheetId: !!this.spreadsheetId
      });
      this.enabled = false;
      return;
    }

    try {
      this.auth = new GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: privateKey,
          type: 'service_account',
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheetsAPI = sheets({ version: 'v4', auth: this.auth });
      this.enabled = true;
      this.logger.info('Google Sheets integration initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Google Sheets', { 
        error: error.message,
        stack: error.stack
      });
      this.enabled = false;
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async logTrade(tradeData) {
    if (!this.enabled) {
      this.logger.info('Google Sheets logging skipped - integration disabled');
      return;
    }

    try {
      const values = [[
        tradeData.timestamp,
        tradeData.symbol,
        tradeData.side.toUpperCase(),
        tradeData.quantity,
        tradeData.price,
        tradeData.strategy,
        tradeData.orderId,
        tradeData.stopLoss || '',
        tradeData.takeProfit || '',
        'OPEN'
      ]];

      await this.sheetsAPI.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Trades!A:J',
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      this.logger.info('Trade logged to Google Sheets', { 
        symbol: tradeData.symbol,
        orderId: tradeData.orderId 
      });
    } catch (error) {
      this.logger.error('Failed to log trade to Google Sheets', { 
        error: error.message,
        tradeData: {
          symbol: tradeData.symbol,
          orderId: tradeData.orderId
        }
      });
      // Don't throw error - continue execution even if logging fails
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async logPerformance(performanceData) {
    if (!this.enabled) {
      this.logger.info('Google Sheets performance logging skipped - integration disabled');
      return;
    }

    try {
      const values = [[
        performanceData.timestamp,
        performanceData.totalEquity,
        performanceData.dailyPnL,
        performanceData.dailyReturn,
        performanceData.unrealizedPnL,
        performanceData.positionCount,
        performanceData.buyingPower
      ]];

      await this.sheetsAPI.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Performance!A:G',
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      this.logger.info('Performance logged to Google Sheets', {
        equity: performanceData.totalEquity,
        dailyPnL: performanceData.dailyPnL
      });
    } catch (error) {
      this.logger.error('Failed to log performance to Google Sheets', { 
        error: error.message,
        performanceData: {
          timestamp: performanceData.timestamp,
          totalEquity: performanceData.totalEquity
        }
      });
      // Don't throw error - continue execution even if logging fails
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async updateTradeStatus(orderId, status, exitPrice = null, pnl = null) {
    if (!this.enabled) {
      return;
    }

    try {
      // First, find the row with the matching order ID
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Trades!A:J'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) {
        this.logger.warning('No trades found in spreadsheet');
        return;
      }

      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][6] === orderId) { // Order ID is in column G (index 6)
          rowIndex = i + 1; // +1 because sheets are 1-indexed
          break;
        }
      }

      if (rowIndex > 0) {
        const updateData = [status];
        if (exitPrice !== null) updateData.push(exitPrice);
        if (pnl !== null) updateData.push(pnl);

        await this.sheetsAPI.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `Trades!J${rowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [updateData] }
        });

        this.logger.info('Trade status updated in Google Sheets', { 
          orderId, 
          status,
          rowIndex 
        });
      } else {
        this.logger.warning('Order ID not found in spreadsheet', { orderId });
      }
    } catch (error) {
      this.logger.error('Failed to update trade status in Google Sheets', { 
        error: error.message,
        orderId 
      });
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async initializeSheets() {
    if (!this.enabled) {
      this.logger.warning('Cannot initialize sheets - integration disabled');
      return;
    }

    try {
      // Create headers for Trades sheet
      const tradesHeaders = [
        'Timestamp', 'Symbol', 'Side', 'Quantity', 'Price', 
        'Strategy', 'Order ID', 'Stop Loss', 'Take Profit', 'Status'
      ];

      // Create headers for Performance sheet
      const performanceHeaders = [
        'Timestamp', 'Total Equity', 'Daily P&L', 'Daily Return %', 
        'Unrealized P&L', 'Position Count', 'Buying Power'
      ];

      // NEW: Create headers for Logs sheet
      const logsHeaders = [
        'Timestamp', 'Level', 'Context', 'Message', 'Data', 'Strategy', 'Symbol', 'Order ID'
      ];

      await this.sheetsAPI.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Trades!A1:J1',
        valueInputOption: 'RAW',
        requestBody: { values: [tradesHeaders] }
      });

      await this.sheetsAPI.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Performance!A1:G1',
        valueInputOption: 'RAW',
        requestBody: { values: [performanceHeaders] }
      });

      // NEW: Initialize Logs sheet
      await this.sheetsAPI.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Logs!A1:H1',
        valueInputOption: 'RAW',
        requestBody: { values: [logsHeaders] }
      });

      this.logger.info('Google Sheets initialized with headers including new Logs sheet');
    } catch (error) {
      this.logger.error('Failed to initialize Google Sheets', { 
        error: error.message,
        stack: error.stack 
      });
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async logSignalStrength({ timestamp, symbol, side, strategy, signalStrength, orderId }) {
    if (!this.enabled) {
      this.logger.info('Google Sheets signal strength logging skipped - integration disabled');
      return;
    }

    try {
      const values = [[
        timestamp,
        symbol,
        side ? side.toUpperCase() : '',
        strategy || '',
        signalStrength != null ? signalStrength : '',
        orderId || ''
      ]];

      await this.sheetsAPI.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'SignalStrength!A:F',
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      this.logger.info('Signal strength logged to Google Sheets', {
        symbol,
        strategy,
        signalStrength
      });
    } catch (error) {
      this.logger.error('Failed to log signal strength to Google Sheets', {
        error: error.message,
        symbol,
        strategy
      });
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async initializeSignalStrengthSheet() {
    if (!this.enabled) {
      this.logger.warning('Cannot initialize signal strength sheet - integration disabled');
      return;
    }

    try {
      const headers = [
        'Timestamp', 'Symbol', 'Side', 'Strategy', 'Signal Strength', 'Order ID'
      ];

      await this.sheetsAPI.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'SignalStrength!A1:F1',
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });

      this.logger.info('SignalStrength sheet initialized with headers');
    } catch (error) {
      this.logger.error('Failed to initialize SignalStrength sheet', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async getLastSignalStrength(symbol, side = null) {
    if (!this.enabled) return null;

    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'SignalStrength!A:F'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return null;

      // Find the last row for the symbol (and side if provided)
      for (let i = rows.length - 1; i > 0; i--) {
        if (rows[i][1] === symbol && (!side || rows[i][2] === side.toUpperCase())) {
          const strength = parseFloat(rows[i][4]);
          return isNaN(strength) ? null : strength;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get last signal strength from Google Sheets', {
        error: error.message,
        symbol,
        side
      });
      return null;
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  async testConnection() {
    if (!this.enabled) {
      return { success: false, error: 'Integration disabled - missing credentials' };
    }

    try {
      const response = await this.sheetsAPI.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'properties.title'
      });

      return { 
        success: true, 
        title: response.data.properties.title 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // NEW FUNCTIONALITY - Enhanced log entry function with structured data
  async logEntry(logEntry) {
    if (!this.enabled) {
      return;
    }

    try {
      const values = [[
        logEntry.timestamp,
        logEntry.level,
        logEntry.context,
        logEntry.message,
        JSON.stringify(logEntry.data),
        logEntry.strategy || '',
        logEntry.symbol || '',
        logEntry.orderId || ''
      ]];

      await this.sheetsAPI.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Logs!A:H',
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      this.logger.info('Log entry saved to Google Sheets', {
        level: logEntry.level,
        message: logEntry.message
      });
    } catch (error) {
      this.logger.error('Failed to log entry to Google Sheets', { 
        error: error.message,
        logEntry: {
          level: logEntry.level,
          message: logEntry.message
        }
      });
    }
  }

  // NEW FUNCTIONALITY - Batch log multiple entries for better performance
  async logBatchEntries(logEntries) {
    if (!this.enabled || !Array.isArray(logEntries) || logEntries.length === 0) {
      return;
    }

    try {
      const values = logEntries.map(logEntry => [
        logEntry.timestamp,
        logEntry.level,
        logEntry.context,
        logEntry.message,
        JSON.stringify(logEntry.data),
        logEntry.strategy || '',
        logEntry.symbol || '',
        logEntry.orderId || ''
      ]);

      await this.sheetsAPI.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Logs!A:H',
        valueInputOption: 'RAW',
        requestBody: { values }
      });

      this.logger.info('Batch log entries saved to Google Sheets', {
        count: logEntries.length
      });
    } catch (error) {
      this.logger.error('Failed to batch log to Google Sheets', { 
        error: error.message,
        count: logEntries.length
      });
    }
  }

  // NEW FUNCTIONALITY - Get recent logs from Google Sheets with filtering
  async getRecentLogs(limit = 100, level = null, strategy = null) {
    if (!this.enabled) {
      return [];
    }

    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Logs!A:H'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) {
        return [];
      }

      // Skip header row and parse logs
      let logs = rows.slice(1).map(row => ({
        timestamp: row[0],
        level: row[1],
        context: row[2],
        message: row[3],
        data: row[4] ? JSON.parse(row[4]) : {},
        strategy: row[5] || null,
        symbol: row[6] || null,
        orderId: row[7] || null
      }));

      // Apply filters
      if (level) {
        logs = logs.filter(log => log.level === level.toUpperCase());
      }
      if (strategy) {
        logs = logs.filter(log => log.strategy === strategy);
      }

      // Sort by timestamp descending and limit results
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return logs.slice(0, limit);

    } catch (error) {
      this.logger.error('Failed to retrieve logs from Google Sheets', {
        error: error.message
      });
      return [];
    }
  }

  // NEW FUNCTIONALITY - Get dashboard data aggregation from sheets
  async getDashboardData() {
    if (!this.enabled) {
      return null;
    }

    try {
      const [tradesResponse, performanceResponse, logsResponse] = await Promise.all([
        this.sheetsAPI.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: 'Trades!A:J'
        }),
        this.sheetsAPI.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: 'Performance!A:G'
        }),
        this.sheetsAPI.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: 'Logs!A:H'
        })
      ]);

      const trades = tradesResponse.data.values || [];
      const performance = performanceResponse.data.values || [];
      const logs = logsResponse.data.values || [];

      return {
        trades: trades.slice(1), // Skip headers
        performance: performance.slice(1),
        logs: logs.slice(1),
        totalTrades: trades.length - 1,
        lastUpdate: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to get dashboard data from Google Sheets', {
        error: error.message
      });
      return null;
    }
  }
}