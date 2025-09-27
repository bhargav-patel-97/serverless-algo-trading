// lib/utils/googleSheets.js - Enhanced Google Sheets Integration with Position Level Storage
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
        privateKey = privateKey.replace(/\\\\n/g, '\\n');
        privateKey = privateKey.replace(/\\n/g, '\\n');
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

      this.logger.info('Google Sheets initialized with headers');
    } catch (error) {
      this.logger.error('Failed to initialize Google Sheets', { 
        error: error.message,
        stack: error.stack 
      });
    }
  }

  // New: Log signal strength to a dedicated sheet
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

  // New: Initialize SignalStrength sheet
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

  // New: Get last signal strength for a symbol (optionally by side)
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

  // =================================================================
  // NEW: POSITION LEVEL STORAGE METHODS FOR PERSISTENT TP/SL STORAGE
  // =================================================================

  /**
   * Store take profit and stop loss levels for a position in Google Sheets
   * @param {string} symbol - Trading symbol
   * @param {Object} levels - TP/SL levels and metadata
   * @returns {boolean} Success status
   */
  async storePositionLevels(symbol, levels) {
    if (!this.enabled) {
      this.logger.info('Google Sheets position level storage skipped - integration disabled');
      return false;
    }

    try {
      // First, check if position already exists and update it
      const existingRowIndex = await this.findPositionLevelRow(symbol);
      
      const values = [[
        new Date().toISOString(), // timestamp
        symbol,
        parseFloat(levels.stopLoss) || '',
        parseFloat(levels.takeProfit) || '',
        parseFloat(levels.entryPrice) || '',
        levels.side || '',
        parseInt(levels.quantity) || '',
        levels.strategy || '',
        levels.orderId || '',
        new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString() // expires (24 hours from now)
      ]];

      if (existingRowIndex > 0) {
        // Update existing row
        await this.sheetsAPI.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `PositionLevels!A${existingRowIndex}:J${existingRowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values }
        });
        
        this.logger.info('Position levels updated in Google Sheets', {
          symbol,
          rowIndex: existingRowIndex,
          stopLoss: levels.stopLoss,
          takeProfit: levels.takeProfit
        });
      } else {
        // Append new row
        await this.sheetsAPI.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'PositionLevels!A:J',
          valueInputOption: 'RAW',
          requestBody: { values }
        });

        this.logger.info('Position levels stored in Google Sheets', {
          symbol,
          stopLoss: levels.stopLoss,
          takeProfit: levels.takeProfit,
          strategy: levels.strategy
        });
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to store position levels in Google Sheets', {
        symbol,
        levels,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Retrieve take profit and stop loss levels for a position from Google Sheets
   * @param {string} symbol - Trading symbol
   * @returns {Object|null} Stored levels or null if not found
   */
  async getPositionLevels(symbol) {
    if (!this.enabled) {
      this.logger.info('Google Sheets position level retrieval skipped - integration disabled');
      return null;
    }

    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'PositionLevels!A:J'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) {
        this.logger.info('No stored levels found for symbol', { symbol });
        return null;
      }

      // Find the row for the symbol
      for (let i = rows.length - 1; i > 0; i--) { // Start from end to get most recent
        if (rows[i][1] === symbol) {
          const row = rows[i];
          
          // Check if data has expired
          const expiryDate = new Date(row[9]);
          if (expiryDate < new Date()) {
            this.logger.info('Stored levels expired for symbol', { symbol });
            // Clean up expired entry
            await this.removePositionLevels(symbol);
            return null;
          }

          const levels = {
            symbol: row[1],
            stopLoss: row[2] ? parseFloat(row[2]) : null,
            takeProfit: row[3] ? parseFloat(row[3]) : null,
            entryPrice: row[4] ? parseFloat(row[4]) : null,
            side: row[5] || null,
            quantity: row[6] ? parseInt(row[6]) : null,
            strategy: row[7] || null,
            orderId: row[8] || null,
            timestamp: row[0],
            lastUpdated: row[0]
          };

          this.logger.info('Retrieved stored levels from Google Sheets', {
            symbol,
            stopLoss: levels.stopLoss,
            takeProfit: levels.takeProfit,
            age: Math.round((Date.now() - new Date(levels.timestamp).getTime()) / 1000 / 60) + ' minutes'
          });

          return levels;
        }
      }

      this.logger.info('No stored levels found for symbol', { symbol });
      return null;
    } catch (error) {
      this.logger.error('Failed to retrieve position levels from Google Sheets', {
        symbol,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Remove position levels from Google Sheets (called when position is closed)
   * @param {string} symbol - Trading symbol
   * @returns {boolean} Success status
   */
  async removePositionLevels(symbol) {
    if (!this.enabled) {
      return false;
    }

    try {
      const rowIndex = await this.findPositionLevelRow(symbol);
      
      if (rowIndex > 0) {
        // Clear the row by overwriting with empty values
        const emptyValues = [['', '', '', '', '', '', '', '', '', '']];
        
        await this.sheetsAPI.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `PositionLevels!A${rowIndex}:J${rowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: emptyValues }
        });

        this.logger.info('Position levels removed from Google Sheets', {
          symbol,
          rowIndex
        });
        return true;
      } else {
        this.logger.info('No position levels found to remove', { symbol });
        return true;
      }
    } catch (error) {
      this.logger.error('Failed to remove position levels from Google Sheets', {
        symbol,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get count of stored positions in Google Sheets
   * @returns {number} Number of positions with stored levels
   */
  async getStoredPositionsCount() {
    if (!this.enabled) return 0;

    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'PositionLevels!A:B'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return 0;

      // Count non-empty rows (excluding header)
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][1] && rows[i][1].trim() !== '') {
          count++;
        }
      }

      return count;
    } catch (error) {
      this.logger.error('Failed to get stored positions count from Google Sheets', {
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Get all stored position symbols from Google Sheets
   * @returns {Array} Array of symbols with stored levels
   */
  async getAllStoredSymbols() {
    if (!this.enabled) return [];

    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'PositionLevels!B:B'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return [];

      const symbols = [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].trim() !== '') {
          symbols.push(rows[i][0]);
        }
      }

      return symbols;
    } catch (error) {
      this.logger.error('Failed to get all stored symbols from Google Sheets', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Initialize PositionLevels sheet with headers
   */
  async initializePositionLevelsSheet() {
    if (!this.enabled) {
      this.logger.warning('Cannot initialize position levels sheet - integration disabled');
      return;
    }

    try {
      const headers = [
        'Timestamp', 'Symbol', 'Stop Loss', 'Take Profit', 'Entry Price',
        'Side', 'Quantity', 'Strategy', 'Order ID', 'Expires'
      ];

      await this.sheetsAPI.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'PositionLevels!A1:J1',
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });

      this.logger.info('PositionLevels sheet initialized with headers');
    } catch (error) {
      this.logger.error('Failed to initialize PositionLevels sheet', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Helper method to find the row index of a position in Google Sheets
   * @param {string} symbol - Trading symbol
   * @returns {number} Row index (1-based) or -1 if not found
   */
  async findPositionLevelRow(symbol) {
    try {
      const response = await this.sheetsAPI.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'PositionLevels!B:B'
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) return -1;

      // Find the row with matching symbol (start from end for most recent)
      for (let i = rows.length - 1; i > 0; i--) {
        if (rows[i][0] === symbol) {
          return i + 1; // +1 because sheets are 1-indexed
        }
      }

      return -1;
    } catch (error) {
      this.logger.error('Failed to find position level row', {
        symbol,
        error: error.message
      });
      return -1;
    }
  }

  // Test connection method
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
}