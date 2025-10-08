// lib/utils/googleSheets.js - Enhanced Google Sheets Integration with Trading State Management
// CRITICAL FIX: Adds enhanced symbol validation and debugging for signal strength comparison
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

 // Signal strength tracking methods
 async logSignalStrength({ timestamp, symbol, side, strategy, signalStrength, orderId }) {
 if (!this.enabled) {
 this.logger.info('Google Sheets signal strength logging skipped - integration disabled');
 return;
 }

 try {
 // CRITICAL FIX: Enhanced validation and logging for signal strength
 const validatedSymbol = symbol ? symbol.toString().toUpperCase() : '';
 const validatedSide = side ? side.toString().toUpperCase() : '';
 const validatedStrategy = strategy ? strategy.toString() : '';
 const validatedSignalStrength = signalStrength != null ? parseFloat(signalStrength) : '';
 const validatedOrderId = orderId ? orderId.toString() : '';

 if (!validatedSymbol) {
 this.logger.error('Cannot log signal strength - missing symbol', { 
 symbol, side, strategy, signalStrength, orderId 
 });
 return;
 }

 const values = [[
 timestamp,
 validatedSymbol, // Column B - This is where signal strength comparison looks
 validatedSide,
 validatedStrategy,
 validatedSignalStrength,
 validatedOrderId
 ]];

 await this.sheetsAPI.spreadsheets.values.append({
 spreadsheetId: this.spreadsheetId,
 range: 'SignalStrength!A:F',
 valueInputOption: 'RAW',
 requestBody: { values }
 });

 this.logger.info('ENHANCED SIGNAL STRENGTH: Logged to Google Sheets with validation', {
 symbol: validatedSymbol,
 strategy: validatedStrategy,
 signalStrength: validatedSignalStrength,
 side: validatedSide,
 columnB_symbol: validatedSymbol, // Explicitly confirm what's stored in Column B
 orderId: validatedOrderId
 });
 } catch (error) {
 this.logger.error('Failed to log signal strength to Google Sheets', {
 error: error.message,
 symbol,
 strategy
 });
 }
 }

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

 // CRITICAL FIX: Enhanced getLastSignalStrength with comprehensive debugging and validation
 async getLastSignalStrength(symbol, side = null) {
 if (!this.enabled) {
 this.logger.warning('Google Sheets disabled - cannot get signal strength', { symbol, side });
 return null;
 }

 try {
 // CRITICAL FIX: Validate input parameters
 const searchSymbol = symbol ? symbol.toString().toUpperCase() : '';
 const searchSide = side ? side.toString().toUpperCase() : null;

 if (!searchSymbol) {
 this.logger.error('SIGNAL STRENGTH ERROR: Invalid symbol provided', { symbol, side });
 return null;
 }

 this.logger.info('SIGNAL STRENGTH LOOKUP: Starting search', {
 searchSymbol,
 searchSide,
 originalSymbol: symbol,
 originalSide: side
 });

 const response = await this.sheetsAPI.spreadsheets.values.get({
 spreadsheetId: this.spreadsheetId,
 range: 'SignalStrength!A:F'
 });

 const rows = response.data.values;
 if (!rows || rows.length <= 1) {
 this.logger.info('SIGNAL STRENGTH LOOKUP: No data found in SignalStrength sheet', { 
 searchSymbol,
 searchSide 
 });
 return null;
 }

 this.logger.info('SIGNAL STRENGTH LOOKUP: Found rows to search', {
 totalRows: rows.length - 1, // Excluding header
 searchSymbol,
 searchSide
 });

 // CRITICAL FIX: Enhanced search with detailed logging
 let foundRows = [];
 let lastMatchingRow = null;

 // Find all matching rows for debugging
 for (let i = rows.length - 1; i > 0; i--) {
 const rowSymbol = rows[i][1] ? rows[i][1].toString().toUpperCase() : '';
 const rowSide = rows[i][2] ? rows[i][2].toString().toUpperCase() : '';
 const rowStrategy = rows[i][3] ? rows[i][3].toString() : '';
 const rowStrength = rows[i][4] !== '' ? parseFloat(rows[i][4]) : null;

 // Log each row for debugging (limit to recent rows to avoid spam)
 if (i >= rows.length - 10) { // Only log last 10 rows
 this.logger.info('SIGNAL STRENGTH ROW DEBUG', {
 rowIndex: i,
 rowSymbol,
 rowSide,
 rowStrategy,
 rowStrength,
 searchSymbol,
 searchSide,
 symbolMatch: rowSymbol === searchSymbol,
 sideMatch: !searchSide || rowSide === searchSide
 });
 }

 // Check if this row matches our search criteria
 if (rowSymbol === searchSymbol) {
 foundRows.push({
 index: i,
 symbol: rowSymbol,
 side: rowSide,
 strategy: rowStrategy,
 strength: rowStrength,
 timestamp: rows[i][0]
 });

 // If side is specified, check for exact match
 if (!searchSide || rowSide === searchSide) {
 if (!lastMatchingRow) {
 lastMatchingRow = {
 index: i,
 symbol: rowSymbol,
 side: rowSide,
 strategy: rowStrategy,
 strength: rowStrength,
 timestamp: rows[i][0]
 };
 }
 }
 }
 }

 // CRITICAL FIX: Enhanced result reporting
 if (foundRows.length > 0) {
 this.logger.info('SIGNAL STRENGTH LOOKUP: Found matching symbol entries', {
 searchSymbol,
 searchSide,
 totalMatches: foundRows.length,
 allMatches: foundRows.map(r => ({
 symbol: r.symbol,
 side: r.side,
 strategy: r.strategy,
 strength: r.strength,
 timestamp: r.timestamp
 }))
 });
 }

 if (lastMatchingRow && lastMatchingRow.strength !== null && !isNaN(lastMatchingRow.strength)) {
 this.logger.info('SIGNAL STRENGTH LOOKUP: FOUND MATCH', {
 searchSymbol,
 searchSide,
 foundSymbol: lastMatchingRow.symbol,
 foundSide: lastMatchingRow.side,
 foundStrategy: lastMatchingRow.strategy,
 foundStrength: lastMatchingRow.strength,
 foundTimestamp: lastMatchingRow.timestamp,
 confirmColumnB: lastMatchingRow.symbol // Explicitly confirm Column B content
 });
 return lastMatchingRow.strength;
 } else {
 this.logger.info('SIGNAL STRENGTH LOOKUP: NO VALID MATCH FOUND', {
 searchSymbol,
 searchSide,
 totalRowsSearched: rows.length - 1,
 symbolMatches: foundRows.length,
 lastMatchingRow: lastMatchingRow
 });
 return null;
 }

 } catch (error) {
 this.logger.error('SIGNAL STRENGTH ERROR: Failed to get last signal strength from Google Sheets', {
 error: error.message,
 stack: error.stack,
 symbol,
 side
 });
 return null;
 }
 }

 // ===============================================================================
 // CRITICAL FIX: NEW TRADING STATE MANAGEMENT METHODS FOR SERVERLESS
 // ===============================================================================

 /**
 * CRITICAL FIX: Initialize trading state sheet for cooldown management
 */
 async initializeTradingStateSheet() {
 if (!this.enabled) {
 this.logger.warning('Cannot initialize trading state sheet - integration disabled');
 return;
 }

 try {
 const headers = [
 'Timestamp', 'Symbol', 'Side', 'Strategy', 'Quantity', 'Price', 'Order ID', 'Last Trade Time'
 ];

 await this.sheetsAPI.spreadsheets.values.update({
 spreadsheetId: this.spreadsheetId,
 range: 'TradingState!A1:H1',
 valueInputOption: 'RAW',
 requestBody: { values: [headers] }
 });

 this.logger.info('TradingState sheet initialized with headers');
 } catch (error) {
 this.logger.error('Failed to initialize TradingState sheet', {
 error: error.message,
 stack: error.stack
 });
 }
 }

 /**
 * CRITICAL FIX: Record trading state for cooldown tracking
 * @param {Object} stateData - Trading state information
 * @returns {boolean} Success status
 */
 async recordTradingState(stateData) {
 if (!this.enabled) {
 this.logger.info('Google Sheets trading state recording skipped - integration disabled');
 return false;
 }

 try {
 // First, check if symbol already exists and update it
 const existingRowIndex = await this.findTradingStateRow(stateData.symbol);

 const values = [[
 new Date().toISOString(), // timestamp
 stateData.symbol,
 stateData.side ? stateData.side.toUpperCase() : '',
 stateData.strategy || '',
 parseInt(stateData.quantity) || '',
 parseFloat(stateData.price) || '',
 stateData.orderId || '',
 stateData.lastTradeTime || new Date().toISOString()
 ]];

 if (existingRowIndex > 0) {
 // Update existing row
 await this.sheetsAPI.spreadsheets.values.update({
 spreadsheetId: this.spreadsheetId,
 range: `TradingState!A${existingRowIndex}:H${existingRowIndex}`,
 valueInputOption: 'RAW',
 requestBody: { values }
 });

 this.logger.info('Trading state updated in Google Sheets', {
 symbol: stateData.symbol,
 rowIndex: existingRowIndex
 });
 } else {
 // Append new row
 await this.sheetsAPI.spreadsheets.values.append({
 spreadsheetId: this.spreadsheetId,
 range: 'TradingState!A:H',
 valueInputOption: 'RAW',
 requestBody: { values }
 });

 this.logger.info('Trading state recorded in Google Sheets', {
 symbol: stateData.symbol,
 strategy: stateData.strategy
 });
 }

 return true;
 } catch (error) {
 this.logger.error('Failed to record trading state in Google Sheets', {
 symbol: stateData.symbol,
 error: error.message
 });
 return false;
 }
 }

 /**
 * CRITICAL FIX: Get last trade for a symbol from Google Sheets
 * @param {string} symbol - Trading symbol
 * @returns {Object|null} Last trade data or null if not found
 */
 async getLastTradeForSymbol(symbol) {
 if (!this.enabled) {
 return null;
 }

 try {
 const response = await this.sheetsAPI.spreadsheets.values.get({
 spreadsheetId: this.spreadsheetId,
 range: 'TradingState!A:H'
 });

 const rows = response.data.values;
 if (!rows || rows.length <= 1) {
 return null;
 }

 // Find the row for the symbol (most recent entry)
 for (let i = rows.length - 1; i > 0; i--) {
 if (rows[i][1] === symbol) {
 const row = rows[i];
 
 return {
 timestamp: row[0],
 symbol: row[1],
 side: row[2],
 strategy: row[3],
 quantity: row[4] ? parseInt(row[4]) : null,
 price: row[5] ? parseFloat(row[5]) : null,
 orderId: row[6],
 lastTradeTime: row[7]
 };
 }
 }

 return null;
 } catch (error) {
 this.logger.error('Failed to get last trade from Google Sheets', {
 symbol,
 error: error.message
 });
 return null;
 }
 }

 /**
 * CRITICAL FIX: Get recent trades for cooldown analysis
 * @param {number} hoursBack - Hours to look back
 * @returns {Array} Array of recent trade data
 */
 async getRecentTrades(hoursBack = 24) {
 if (!this.enabled) {
 return [];
 }

 try {
 const response = await this.sheetsAPI.spreadsheets.values.get({
 spreadsheetId: this.spreadsheetId,
 range: 'TradingState!A:H'
 });

 const rows = response.data.values;
 if (!rows || rows.length <= 1) {
 return [];
 }

 const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
 const recentTrades = [];

 // Process rows in reverse order (most recent first)
 for (let i = rows.length - 1; i > 0; i--) {
 if (rows[i][0] && rows[i][1]) {
 const tradeTime = new Date(rows[i][0]);
 
 if (tradeTime >= cutoffTime) {
 recentTrades.push({
 timestamp: rows[i][0],
 symbol: rows[i][1],
 side: rows[i][2],
 strategy: rows[i][3],
 quantity: rows[i][4] ? parseInt(rows[i][4]) : null,
 price: rows[i][5] ? parseFloat(rows[i][5]) : null,
 orderId: rows[i][6],
 lastTradeTime: rows[i][7]
 });
 }
 }
 }

 return recentTrades;
 } catch (error) {
 this.logger.error('Failed to get recent trades from Google Sheets', {
 hoursBack,
 error: error.message
 });
 return [];
 }
 }

 /**
 * CRITICAL FIX: Find trading state row for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {number} Row index (1-based) or -1 if not found
 */
 async findTradingStateRow(symbol) {
 try {
 const response = await this.sheetsAPI.spreadsheets.values.get({
 spreadsheetId: this.spreadsheetId,
 range: 'TradingState!B:B'
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
 this.logger.error('Failed to find trading state row', {
 symbol,
 error: error.message
 });
 return -1;
 }
 }

 // ===============================================================================
 // EXISTING POSITION LEVEL STORAGE METHODS (unchanged)
 // ===============================================================================

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