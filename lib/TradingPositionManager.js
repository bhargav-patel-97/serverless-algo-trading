/**
 * Fixed TradingPositionManager.js - Google Sheets State Management for Serverless
 * Eliminates Map-based caching issues by using persistent Google Sheets storage
 * for all state management including cooldowns, signal tracking, and position data
 */
import { Logger } from './utils/logger.js';
import { PositionStorage } from './utils/positionStorage.js';
import { GoogleSheetsLogger } from './utils/googleSheets.js';

export default class EnhancedTradingPositionManager {
    constructor(alpacaClient, options = {}) {
        this.alpaca = alpacaClient;
        this.options = options;
        
        // CRITICAL FIX: Remove all Map-based caches for serverless compatibility
        // this.activeOrders = new Map(); // REMOVED - causes duplicate trades
        // this.lastTradeTime = new Map(); // REMOVED - causes duplicate trades
        // this.positionCache = new Map(); // REMOVED - causes duplicate trades
        // this.signalCache = new Map(); // REMOVED - causes duplicate trades
        // this.cache = new Map(); // REMOVED - causes duplicate trades
        
        // Initialize Google Sheets-based state management
        this.sheetsLogger = new GoogleSheetsLogger();
        
        // Enhanced: Initialize position storage with persistent backend (Google Sheets)
        this.positionStorage = new PositionStorage({
            logger: options.logger,
            enableLogging: options.enableLogging !== false,
            enablePersistence: true, // Enable Google Sheets persistence
            ...options.storageOptions // Allow override of storage options
        });
        
        // Configurable options
        this.initializeCooldownSystem(options.cooldown || {});
        this.minTimeBetweenTrades = options.minTimeBetweenTrades || 60000; // 1 minute default
        this.maxPositionSizePercent = options.maxPositionSizePercent || 0.10; // 10% of equity
        this.signalImprovementThreshold = options.signalImprovementThreshold || 0.20; // 20% improvement required
        this.enableLogging = options.enableLogging !== false; // Default true
        this.logger = options.logger || console;
        
        // Initialize persistent storage system
        this.initializePersistentStorage();
    }
    
    /**
     * Initialize the persistent storage backend
     */
    async initializePersistentStorage() {
        try {
            if (this.positionStorage && this.positionStorage.initializePersistentStorage) {
                await this.positionStorage.initializePersistentStorage();
                if (this.enableLogging) {
                    this.logger.info('Persistent storage initialized for TradingPositionManager');
                }
            }
            
            // CRITICAL FIX: Initialize Google Sheets tables for state management
            if (this.sheetsLogger && this.sheetsLogger.enabled) {
                await this.sheetsLogger.initializeTradingStateSheet();
                await this.sheetsLogger.initializeSignalStrengthSheet();
                await this.sheetsLogger.initializePositionLevelsSheet();
                if (this.enableLogging) {
                    this.logger.info('Google Sheets state management initialized');
                }
            }
        } catch (error) {
            this.logger.error('Failed to initialize persistent storage in TradingPositionManager', {
                error: error.message
            });
        }
    }
    
    /**
     * CRITICAL FIX: Check last trade time using Google Sheets instead of Map
     * @param {string} symbol - Trading symbol
     * @returns {Object} Last trade info from Google Sheets
     */
    async getLastTradeTime(symbol) {
        try {
            if (!this.sheetsLogger || !this.sheetsLogger.enabled) {
                return { lastTradeTime: null, timeSinceLastTrade: Infinity };
            }
            
            const lastTrade = await this.sheetsLogger.getLastTradeForSymbol(symbol);
            if (!lastTrade || !lastTrade.timestamp) {
                return { lastTradeTime: null, timeSinceLastTrade: Infinity };
            }
            
            const lastTradeTime = new Date(lastTrade.timestamp).getTime();
            const timeSinceLastTrade = Date.now() - lastTradeTime;
            
            return { 
                lastTradeTime: lastTradeTime, 
                timeSinceLastTrade: timeSinceLastTrade,
                lastTradeData: lastTrade
            };
        } catch (error) {
            this.logger.error('Failed to get last trade time from Google Sheets', {
                symbol,
                error: error.message
            });
            return { lastTradeTime: null, timeSinceLastTrade: Infinity };
        }
    }
    
    /**
     * CRITICAL FIX: Record trade time in Google Sheets instead of Map
     * @param {string} symbol - Trading symbol
     * @param {Object} tradeData - Trade information
     */
    async recordTradeTime(symbol, tradeData) {
        try {
            if (!this.sheetsLogger || !this.sheetsLogger.enabled) {
                if (this.enableLogging) {
                    this.logger.warning('Cannot record trade time - Google Sheets disabled');
                }
                return false;
            }
            
            // Record in trading state sheet for cooldown tracking
            const success = await this.sheetsLogger.recordTradingState({
                symbol,
                lastTradeTime: new Date().toISOString(),
                strategy: tradeData.strategy,
                side: tradeData.side,
                quantity: tradeData.quantity,
                price: tradeData.price,
                orderId: tradeData.orderId
            });
            
            if (this.enableLogging) {
                this.logger.info('Trade time recorded in Google Sheets', {
                    symbol,
                    success
                });
            }
            
            return success;
        } catch (error) {
            this.logger.error('Failed to record trade time in Google Sheets', {
                symbol,
                error: error.message
            });
            return false;
        }
    }
    
    /**
     * Enhanced trade execution that now stores TP/SL levels persistently
     * CRITICAL FIX: Uses Google Sheets for all state management
     * @param {string} symbol - Trading symbol
     * @param {string} side - 'buy' or 'sell'
     * @param {number} quantity - Number of shares
     * @param {number} currentPrice - Current market price
     * @param {string} strategy - Strategy name
     * @param {number} signalStrength - Signal strength (0-1 scale)
     * @param {Object} exitLevels - Take profit and stop loss levels
     * @returns {Object} Trade execution result
     */
    async executeTradeWithTPSL(symbol, side, quantity, currentPrice, strategy, signalStrength = null, exitLevels = null) {
        try {
            // CRITICAL FIX: Validate before executing using Google Sheets state
            const validation = await this.validateTradeBeforeExecution(
                symbol, side, quantity, currentPrice, strategy, signalStrength
            );
            
            if (!validation.canTrade) {
                if (this.enableLogging) {
                    this.logger.warn('Trade execution blocked by validation', {
                        symbol,
                        side,
                        quantity,
                        strategy,
                        signalStrength,
                        reasons: validation.skipReasons,
                        signalAnalysis: validation.signalAnalysis
                    });
                }
                return {
                    success: false,
                    skipped: true,
                    reasons: validation.skipReasons,
                    validation: validation,
                    signalAnalysis: validation.signalAnalysis,
                    exitLevelsStored: false,
                    persistentStorageUsed: false,
                    timestamp: new Date().toISOString()
                };
            }
            
            // Execute the trade
            if (this.enableLogging) {
                this.logger.info('Submitting order to Alpaca', {
                    symbol,
                    qty: quantity,
                    side,
                    type: 'market',
                    time_in_force: 'day',
                    strategy,
                    signalStrength,
                    exitLevels,
                    scaling: validation.signalAnalysis?.canScale || false
                });
            }
            
            const order = await this.alpaca.submitOrder({
                symbol: symbol,
                qty: quantity,
                side: side,
                type: 'market',
                time_in_force: 'day'
            });
            
            // CRITICAL FIX: Record the trade time in Google Sheets instead of Map
            await this.recordTradeTime(symbol, {
                strategy,
                side,
                quantity,
                price: currentPrice,
                orderId: order.id
            });
            
            // Enhanced: Store take profit and stop loss levels persistently if provided
            let exitLevelsStored = false;
            let persistentStorageUsed = false;
            
            if (exitLevels && (exitLevels.stopLoss || exitLevels.takeProfit)) {
                const positionSide = side === 'buy' ? 'long' : 'short';
                const levelData = {
                    stopLoss: exitLevels.stopLoss,
                    takeProfit: exitLevels.takeProfit,
                    entryPrice: currentPrice,
                    side: positionSide,
                    quantity: quantity,
                    strategy: strategy,
                    orderId: order.id
                };
                
                try {
                    exitLevelsStored = await this.positionStorage.storePositionLevels(symbol, levelData);
                    persistentStorageUsed = this.positionStorage.sheetsLogger?.enabled || false;
                    
                    if (this.enableLogging) {
                        this.logger.info('Take profit/stop loss levels stored persistently', {
                            symbol,
                            exitLevelsStored,
                            persistentStorageUsed,
                            stopLoss: exitLevels.stopLoss,
                            takeProfit: exitLevels.takeProfit,
                            strategy
                        });
                    }
                } catch (storageError) {
                    this.logger.error('Failed to store exit levels persistently', {
                        symbol,
                        error: storageError.message,
                        exitLevels
                    });
                    exitLevelsStored = false;
                }
            }
            
            if (this.enableLogging) {
                this.logger.info('Trade executed successfully with persistent TP/SL storage', {
                    orderId: order.id,
                    symbol,
                    side,
                    quantity,
                    status: order.status,
                    strategy,
                    signalStrength,
                    exitLevelsStored,
                    persistentStorageUsed,
                    scaling: validation.signalAnalysis?.canScale || false,
                    signalImprovement: validation.signalAnalysis?.relativeImprovement,
                    timestamp: new Date().toISOString()
                });
            }
            
            return {
                success: true,
                skipped: false,
                order: order,
                validation: validation,
                signalAnalysis: validation.signalAnalysis,
                exitLevelsStored,
                persistentStorageUsed,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            this.logger.error('Enhanced trade execution failed', {
                symbol,
                side,
                quantity,
                strategy,
                signalStrength,
                exitLevels,
                error: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                skipped: false,
                error: error,
                validation: undefined,
                signalAnalysis: undefined,
                exitLevelsStored: false,
                persistentStorageUsed: false,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Alias method for backward compatibility with existing trade.js calls
     * This method calls executeTradeWithTPSL internally
     */
    async executeTradeWithValidation(symbol, side, quantity, currentPrice, strategy, signalStrength = null) {
        return await this.executeTradeWithTPSL(symbol, side, quantity, currentPrice, strategy, signalStrength, null);
    }
    
    /**
     * Get stored take profit/stop loss levels for a position
     * @param {string} symbol - Trading symbol
     * @returns {Object|null} Stored TP/SL levels
     */
    async getStoredExitLevels(symbol) {
        try {
            return await this.positionStorage.getPositionLevels(symbol);
        } catch (error) {
            this.logger.error('Failed to get stored exit levels', {
                symbol,
                error: error.message
            });
            return null;
        }
    }
    
    /**
     * Update stored take profit/stop loss levels
     * @param {string} symbol - Trading symbol
     * @param {Object} updates - Fields to update
     * @returns {boolean} Success status
     */
    async updateStoredExitLevels(symbol, updates) {
        try {
            const success = await this.positionStorage.updatePositionLevels(symbol, updates);
            if (this.enableLogging) {
                this.logger.info('Exit levels updated', {
                    symbol,
                    updates,
                    success
                });
            }
            return success;
        } catch (error) {
            this.logger.error('Failed to update exit levels', {
                symbol,
                updates,
                error: error.message
            });
            return false;
        }
    }
    
    /**
     * Remove stored levels when position is manually closed
     * @param {string} symbol - Trading symbol
     * @returns {boolean} Success status
     */
    async removeStoredExitLevels(symbol) {
        try {
            const success = await this.positionStorage.removePositionLevels(symbol);
            if (this.enableLogging) {
                this.logger.info('Exit levels removed', {
                    symbol,
                    success
                });
            }
            return success;
        } catch (error) {
            this.logger.error('Failed to remove exit levels', {
                symbol,
                error: error.message
            });
            return false;
        }
    }
    
    /**
     * CRITICAL FIX: Get current positions without using Map cache
     * @returns {Map} Map of symbol -> position data (fresh from Alpaca)
     */
    async getCurrentPositions() {
        try {
            const positions = await this.alpaca.getPositions();
            
            // Don't cache in Map - return fresh data as temporary Map for compatibility
            const tempPositionMap = new Map();
            positions.forEach(position => {
                tempPositionMap.set(position.symbol, {
                    qty: parseInt(position.qty),
                    side: position.side,
                    market_value: parseFloat(position.market_value),
                    cost_basis: parseFloat(position.cost_basis),
                    unrealized_pl: parseFloat(position.unrealized_pl),
                    avg_entry_price: parseFloat(position.avg_entry_price)
                });
            });
            
            if (this.enableLogging) {
                this.logger.info('Fresh positions retrieved (no caching)', {
                    totalPositions: tempPositionMap.size,
                    symbols: Array.from(tempPositionMap.keys())
                });
            }
            
            return tempPositionMap;
        } catch (error) {
            this.logger.error('Error fetching positions:', error);
            return new Map();
        }
    }
    
    /**
     * CRITICAL FIX: Main validation function using Google Sheets state
     * @param {string} symbol - Trading symbol
     * @param {string} side - 'buy' or 'sell'
     * @param {number} quantity - Number of shares
     * @param {number} currentPrice - Current market price
     * @param {string} strategy - Strategy name
     * @param {number} signalStrength - Signal strength (0-1 scale)
     * @returns {Object} Complete validation result
     */
    async validateTradeBeforeExecution(symbol, side, quantity, currentPrice, strategy, signalStrength = null) {
        if (this.enableLogging) {
            this.logger.info('Validating trade with Google Sheets state management', {
                symbol,
                side,
                quantity,
                price: currentPrice,
                strategy,
                signalStrength,
                timestamp: new Date().toISOString()
            });
        }
        
        const validationResults = {
            canTrade: false,
            checks: {
                exposure: null,
                pendingOrders: null,
                recentTrade: null,
                riskLimits: null,
                duplicateCheck: null
            },
            skipReasons: [],
            signalAnalysis: null,
            timestamp: new Date().toISOString()
        };
        
        try {
            // CRITICAL FIX: Check recent trade cooldown using Google Sheets
            const lastTradeInfo = await this.getLastTradeTime(symbol);
            if (lastTradeInfo.lastTradeTime && lastTradeInfo.timeSinceLastTrade < this.minTimeBetweenTrades) {
                validationResults.skipReasons.push('Recent trade cooldown active');
                validationResults.checks.recentTrade = { 
                    blocked: true, 
                    cooldownRemaining: this.minTimeBetweenTrades - lastTradeInfo.timeSinceLastTrade,
                    lastTradeTime: new Date(lastTradeInfo.lastTradeTime).toISOString()
                };
                
                if (this.enableLogging) {
                    this.logger.info('Trade blocked by cooldown from Google Sheets', {
                        symbol,
                        timeSinceLastTrade: lastTradeInfo.timeSinceLastTrade,
                        minTimeBetweenTrades: this.minTimeBetweenTrades,
                        cooldownRemaining: this.minTimeBetweenTrades - lastTradeInfo.timeSinceLastTrade
                    });
                }
                return validationResults;
            }
            
            // CRITICAL FIX: Check for duplicate signals using Google Sheets
            if (signalStrength !== null && this.sheetsLogger && this.sheetsLogger.enabled) {
                try {
                    const lastSignalStrength = await this.sheetsLogger.getLastSignalStrength(symbol, side);
                    if (lastSignalStrength !== null) {
                        // Only allow if new signal is at least 30% stronger than last
                        if (signalStrength <= lastSignalStrength * 1.3) {
                            validationResults.skipReasons.push('Signal not strong enough compared to last signal');
                            validationResults.checks.duplicateCheck = {
                                blocked: true,
                                reason: 'weak_signal',
                                lastSignalStrength: lastSignalStrength,
                                currentSignalStrength: signalStrength,
                                improvementRequired: lastSignalStrength * 1.3
                            };
                            
                            if (this.enableLogging) {
                                this.logger.info('Trade blocked by weak signal strength from Google Sheets', {
                                    symbol,
                                    side,
                                    lastSignalStrength,
                                    currentSignalStrength: signalStrength,
                                    improvementRequired: lastSignalStrength * 1.3
                                });
                            }
                            return validationResults;
                        }
                    }
                    
                    validationResults.checks.duplicateCheck = {
                        blocked: false,
                        signalImprovement: lastSignalStrength ? ((signalStrength - lastSignalStrength) / lastSignalStrength * 100).toFixed(2) + '%' : 'first_signal'
                    };
                } catch (signalError) {
                    this.logger.warning('Failed to check signal strength from Google Sheets', {
                        symbol,
                        side,
                        error: signalError.message
                    });
                }
            }
            
            // Check position limits
            const totalValue = quantity * currentPrice;
            if (totalValue > 100000) { // Simple position size check
                validationResults.skipReasons.push('Position size exceeds limits');
                validationResults.checks.riskLimits = { withinLimits: false, reason: 'Position too large' };
                return validationResults;
            }
            
            // If we reach here, trade can proceed
            validationResults.canTrade = true;
            validationResults.checks.exposure = { action: 'proceed' };
            validationResults.checks.riskLimits = { withinLimits: true };
            validationResults.checks.recentTrade = { blocked: false };
            
            if (this.enableLogging) {
                this.logger.info('Trade validation passed using Google Sheets state', {
                    symbol,
                    side,
                    strategy,
                    signalStrength,
                    checksPass: Object.keys(validationResults.checks).filter(k => !validationResults.checks[k]?.blocked).length
                });
            }
            
            return validationResults;
            
        } catch (error) {
            this.logger.error('Error during trade validation with Google Sheets:', error);
            validationResults.skipReasons.push(`Validation error: ${error.message}`);
            return validationResults;
        }
    }
    
    /**
     * Enhanced position summary with persistent TP/SL information
     * @returns {Object} Comprehensive position summary including exit levels
     */
    async getEnhancedPositionSummary() {
        // CRITICAL FIX: Get fresh positions instead of cached
        const currentPositions = await this.getCurrentPositions();
        
        const summary = {
            totalPositions: currentPositions.size,
            positions: {},
            totalValue: 0,
            totalUnrealizedPL: 0,
            positionsWithExitLevels: 0,
            signalCache: {}, // Empty since we don't use Map cache anymore
            exitLevelsStatus: {},
            persistentStorage: {
                enabled: this.positionStorage.sheetsLogger?.enabled || false,
                stats: await this.positionStorage.getStorageStats()
            },
            timestamp: new Date().toISOString()
        };
        
        // Process each position
        for (const [symbol, position] of currentPositions.entries()) {
            summary.positions[symbol] = {
                side: position.side,
                quantity: Math.abs(position.qty),
                marketValue: position.market_value,
                unrealizedPL: position.unrealized_pl,
                avgEntryPrice: position.avg_entry_price,
                costBasis: position.cost_basis
            };
            
            summary.totalValue += position.market_value;
            summary.totalUnrealizedPL += position.unrealized_pl;
            
            // Get stored exit levels for this position with enhanced error handling
            try {
                const exitLevels = await this.getStoredExitLevels(symbol);
                if (exitLevels) {
                    summary.positionsWithExitLevels++;
                    summary.exitLevelsStatus[symbol] = {
                        hasStopLoss: !!exitLevels.stopLoss,
                        hasTakeProfit: !!exitLevels.takeProfit,
                        stopLoss: exitLevels.stopLoss,
                        takeProfit: exitLevels.takeProfit,
                        strategy: exitLevels.strategy,
                        entryPrice: exitLevels.entryPrice,
                        storedTimestamp: exitLevels.timestamp,
                        source: 'persistent_storage'
                    };
                } else {
                    summary.exitLevelsStatus[symbol] = {
                        hasStopLoss: false,
                        hasTakeProfit: false,
                        message: 'No stored exit levels found',
                        source: 'none'
                    };
                }
            } catch (exitLevelError) {
                summary.exitLevelsStatus[symbol] = {
                    hasStopLoss: false,
                    hasTakeProfit: false,
                    message: 'Error retrieving exit levels',
                    error: exitLevelError.message,
                    source: 'error'
                };
            }
        }
        
        return summary;
    }
    
    /**
     * Alias method for backward compatibility with existing trade.js calls
     * This method calls getEnhancedPositionSummary internally
     */
    async getPositionSummary() {
        return await this.getEnhancedPositionSummary();
    }
    
    /**
     * CRITICAL FIX: Get cooldown status using Google Sheets instead of Map
     */
    async getCooldownStatus(symbol) {
        try {
            const lastTradeInfo = await this.getLastTradeTime(symbol);
            if (!lastTradeInfo.lastTradeTime) {
                return { isInCooldown: false, timeRemaining: 0 };
            }
            
            const isInCooldown = lastTradeInfo.timeSinceLastTrade < this.minTimeBetweenTrades;
            
            return {
                isInCooldown,
                timeRemaining: isInCooldown ? this.minTimeBetweenTrades - lastTradeInfo.timeSinceLastTrade : 0,
                lastTradeTime: new Date(lastTradeInfo.lastTradeTime).toISOString()
            };
        } catch (error) {
            this.logger.error('Error getting cooldown status from Google Sheets:', symbol, error);
            return { error: error.message, isInCooldown: false };
        }
    }
    
    /**
     * CRITICAL FIX: Get all cooldowns using Google Sheets instead of Map
     */
    async getAllCooldowns() {
        try {
            if (!this.sheetsLogger || !this.sheetsLogger.enabled) {
                return {};
            }
            
            // Get all recent trades from Google Sheets
            const recentTrades = await this.sheetsLogger.getRecentTrades(24); // Last 24 hours
            const cooldowns = {};
            
            for (const trade of recentTrades) {
                if (trade.symbol && trade.timestamp) {
                    const tradeTime = new Date(trade.timestamp).getTime();
                    const timeSinceLastTrade = Date.now() - tradeTime;
                    const isInCooldown = timeSinceLastTrade < this.minTimeBetweenTrades;
                    
                    if (isInCooldown) {
                        cooldowns[trade.symbol] = {
                            timeRemaining: this.minTimeBetweenTrades - timeSinceLastTrade,
                            lastTradeTime: trade.timestamp
                        };
                    }
                }
            }
            
            return cooldowns;
        } catch (error) {
            this.logger.error('Error getting all cooldowns from Google Sheets:', error);
            return {};
        }
    }
    
    /**
     * Initialize cooldown system with configuration
     * @param {Object} config - Configuration options
     */
    initializeCooldownSystem(config = {}) {
        this.config = {
            cooldownMinutes: config.cooldownMinutes || 15,
            maxCooldowns: config.maxCooldowns || 100,
            cleanupIntervalMinutes: config.cleanupIntervalMinutes || 60,
            ...config
        };
        
        // CRITICAL FIX: Remove Map cache initialization
        // if (!this.cache) {
        //     this.cache = new Map(); // REMOVED
        // }
        
        if (this.logger) {
            this.logger.info('Enhanced Trading Position Manager initialized with Google Sheets state management', {
                defaultCooldownMinutes: this.config.cooldownMinutes,
                positionStorageEnabled: true,
                persistentStorageEnabled: this.positionStorage.sheetsLogger?.enabled || false,
                mapCachesRemoved: true // Indicate that Map caches have been removed
            });
        }
    }
    
    /**
     * Get comprehensive exit levels statistics
     * @returns {Object} Exit levels statistics and health check
     */
    async getExitLevelsStats() {
        try {
            const storageStats = await this.positionStorage.getStorageStats();
            const currentPositions = await this.getCurrentPositions();
            
            return {
                storage: storageStats,
                positions: {
                    total: currentPositions.size,
                    symbols: Array.from(currentPositions.keys())
                },
                coverage: {
                    positionsWithLevels: storageStats.analysis?.totalStoredPositions || 0,
                    positionsWithoutLevels: Math.max(0, currentPositions.size - (storageStats.analysis?.totalStoredPositions || 0)),
                    coveragePercent: currentPositions.size > 0 
                        ? Math.round(((storageStats.analysis?.totalStoredPositions || 0) / currentPositions.size) * 100)
                        : 100
                },
                persistentStorage: {
                    enabled: storageStats.persistent?.enabled || false,
                    totalEntries: storageStats.persistent?.totalEntries || 0
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Failed to get exit levels stats', error);
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Cleanup orphaned exit levels (positions that no longer exist)
     * @returns {Object} Cleanup results
     */
    async cleanupOrphanedExitLevels() {
        try {
            const currentPositions = await this.getCurrentPositions();
            const storedSymbols = await this.positionStorage.getAllStoredSymbols();
            const currentSymbols = new Set(Array.from(currentPositions.keys()));
            
            let cleanedCount = 0;
            const cleanedSymbols = [];
            
            for (const symbol of storedSymbols) {
                if (!currentSymbols.has(symbol)) {
                    await this.positionStorage.removePositionLevels(symbol);
                    cleanedCount++;
                    cleanedSymbols.push(symbol);
                }
            }
            
            const result = {
                cleanedCount,
                cleanedSymbols,
                currentPositions: currentSymbols.size,
                storedLevels: storedSymbols.length,
                remainingStoredLevels: storedSymbols.length - cleanedCount,
                timestamp: new Date().toISOString()
            };
            
            if (this.enableLogging && cleanedCount > 0) {
                this.logger.info('Orphaned exit levels cleaned up', result);
            }
            
            return result;
        } catch (error) {
            this.logger.error('Failed to cleanup orphaned exit levels', error);
            return {
                error: error.message,
                cleanedCount: 0,
                timestamp: new Date().toISOString()
            };
        }
    }
}