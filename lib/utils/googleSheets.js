// lib/utils/googleSheets.js - Fixed Google Sheets Integration
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
                // Replace literal \n with actual newlines
                privateKey = privateKey.replace(/\\n/g, '\n');
                privateKey = privateKey.replace(/\n/g, '\n');

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