// lib/utils/googleSheets.js - Google Sheets Integration
import { GoogleAuth } from 'google-auth-library';
import { sheets } from '@googleapis/sheets';
import { Logger } from './logger.js';

export class GoogleSheetsLogger {
    constructor() {
        this.auth = new GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        this.sheetsAPI = sheets({ version: 'v4', auth: this.auth });
        this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
        this.logger = new Logger();
    }

    async logTrade(tradeData) {
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
                tradeData 
            });
        }
    }

    async logPerformance(performanceData) {
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

            this.logger.info('Performance logged to Google Sheets', performanceData);
        } catch (error) {
            this.logger.error('Failed to log performance to Google Sheets', { 
                error: error.message,
                performanceData 
            });
        }
    }

    async updateTradeStatus(orderId, status, exitPrice = null, pnl = null) {
        try {
            // First, find the row with the matching order ID
            const response = await this.sheetsAPI.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'Trades!A:J'
            });

            const rows = response.data.values;
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
            }
        } catch (error) {
            this.logger.error('Failed to update trade status in Google Sheets', { 
                error: error.message,
                orderId 
            });
        }
    }

    async initializeSheets() {
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
            this.logger.error('Failed to initialize Google Sheets', error);
        }
    }
}