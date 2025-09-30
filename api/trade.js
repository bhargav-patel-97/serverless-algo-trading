// CRITICAL FIX: Enhanced api/trade.js - Google Sheets State Management for Serverless  
// Eliminates Map-based caching issues and fixes duplicate trade problem
// Integrates PositionExitManager with enhanced persistent storage for serverless environments

import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { MomentumStrategy } from '../lib/strategies/momentum.js';
import { MeanReversionStrategy } from '../lib/strategies/meanReversion.js';
import { RegimeDetectionStrategy } from '../lib/strategies/regimeDetection.js';
import { RiskManager } from '../lib/utils/riskManager.js';
import { Logger } from '../lib/utils/logger.js';
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';
import TradingPositionManager from '../lib/TradingPositionManager.js';
import { PositionExitManager } from '../lib/PositionExitManager.js';
import { SYMBOL_TRIPLETS, getAllBaseSymbols } from '../lib/config/symbolConfig.js';

export default async function handler(req, res) {
    const logger = new Logger();
    const sheetsLogger = new GoogleSheetsLogger();
    
    try {
        logger.info('CRITICAL FIX: Enhanced Trading System with Google Sheets State Management', {
            timestamp: new Date().toISOString(),
            configuredSymbols: getAllBaseSymbols(),
            mapCachesEliminated: true
        });

        // CRITICAL FIX: Initialize all required Google Sheets including new TradingState sheet
        await sheetsLogger.initializeSignalStrengthSheet();
        await sheetsLogger.initializePositionLevelsSheet();
        await sheetsLogger.initializeTradingStateSheet(); // NEW: For cooldown management

        // Initialize Alpaca API
        const alpaca = new AlpacaHybridApi({
            keyId: process.env.ALPACA_API_KEY,
            secretKey: process.env.ALPACA_SECRET_KEY,
            paper: process.env.ALPACA_PAPER === 'true',
            baseUrl: process.env.ALPACA_PAPER === 'true' ? 
                'https://paper-api.alpaca.markets' : 
                'https://api.alpaca.markets'
        });

        // CRITICAL FIX: Initialize Position Manager with Google Sheets state management
        const positionManager = new TradingPositionManager(alpaca, {
            minTimeBetweenTrades: parseInt(process.env.MIN_TIME_BETWEEN_TRADES) || 300000, // 5 minutes default
            maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT) || 0.08, // 8% max position
            enableLogging: true,
            logger: logger,
            // Enhanced: Google Sheets-based storage for persistent state management
            storageOptions: {
                enablePersistence: true,
                enableLogging: true,
                logger: logger
            }
        });

        // Initialize Position Exit Manager with enhanced persistent storage for TP/SL monitoring
        const exitManager = new PositionExitManager(alpaca, {
            enableLogging: true,
            logger: logger,
            priceBuffer: parseFloat(process.env.EXIT_PRICE_BUFFER) || 0.001, // 0.1% buffer
            maxRetries: parseInt(process.env.EXIT_ORDER_MAX_RETRIES) || 3,
            emergencyStopEnabled: process.env.EMERGENCY_STOP_ENABLED !== 'false',
            // Enhanced: Storage configuration for persistent backend
            storageOptions: {
                enablePersistence: true,
                enableLogging: true,
                logger: logger
            }
        });

        // Generate strategies dynamically from symbol configuration
        const strategies = generateStrategiesFromConfig();

        // Initialize risk manager with enhanced settings
        const riskManager = new RiskManager({
            maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 0.05,
            maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 0.02,
            maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN) || 0.10,
            stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 0.03,
            takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 0.06
        });

        // Get current account info
        const account = await alpaca.getAccount();
        const currentEquity = parseFloat(account.equity);
        
        logger.info('Account info retrieved', {
            equity: currentEquity,
            buyingPower: account.buying_power
        });

        // CRITICAL FIX: Synchronize position storage with persistent backend after cold start
        logger.info('CRITICAL: Synchronizing position storage with Google Sheets persistent backend');
        const syncResult = await positionManager.positionStorage.synchronizeWithPersistentStorage();
        logger.info('Position storage synchronization completed', syncResult);

        // =============================================================================
        // PHASE 1: POSITION EXIT MONITORING (with persistent storage)
        // =============================================================================
        logger.info('Phase 1: Monitoring existing positions for TP/SL exits (with Google Sheets persistence)');
        const exitResults = await exitManager.monitorAndExecuteExits();
        
        if (exitResults.exitOrdersExecuted > 0) {
            logger.info('Position exits executed', {
                exitOrdersExecuted: exitResults.exitOrdersExecuted,
                stopLossTriggered: exitResults.stopLossTriggered,
                takeProfitTriggered: exitResults.takeProfitTriggered
            });

            // Log exit trades to Google Sheets
            for (const exitTrade of exitResults.exitTrades) {
                if (exitTrade.status === 'executed') {
                    await sheetsLogger.logTrade({
                        ...exitTrade,
                        type: 'exit',
                        strategy: exitTrade.exitType === 'stop_loss' ? 'Stop Loss' : 'Take Profit'
                    });
                }
            }
        }

        // =============================================================================
        // PHASE 2: NEW TRADE SIGNALS PROCESSING (with Google Sheets duplicate detection)
        // =============================================================================
        logger.info('Phase 2: Processing new trade signals with Google Sheets duplicate detection');
        
        // CRITICAL FIX: Get current positions fresh from Alpaca (no Map caching)
        const currentPositions = await positionManager.getCurrentPositions();
        const positions = await alpaca.getPositions();
        
        logger.info('Position status after exits', {
            totalPositions: currentPositions.size,
            symbols: Array.from(currentPositions.keys())
        });

        // Check daily loss limit
        if (await riskManager.isDailyLossLimitExceeded(account, positions)) {
            logger.warning('Daily loss limit exceeded, skipping new trades');
            return res.json({
                status: 'success',
                phase1_exits: exitResults,
                phase2_new_trades: {
                    status: 'skipped',
                    reason: 'daily_loss_limit_exceeded'
                },
                timestamp: new Date().toISOString()
            });
        }

        const tradingResults = [];
        const signalsByBaseSymbol = {};
        
        // Initialize signalsByBaseSymbol for all configured symbols
        getAllBaseSymbols().forEach(symbol => {
            signalsByBaseSymbol[symbol] = [];
        });

        // Execute each enabled strategy and categorize signals
        for (const strategy of strategies) {
            if (strategy.isEnabled()) {
                try {
                    logger.info(`Executing strategy: ${strategy.getName()}`);
                    const signals = await strategy.generateSignals(alpaca);

                    // Categorize signals by base symbol for better tracking
                    const baseSymbol = (strategy.config && strategy.config.baseSymbol) ||
                        (strategy.options && strategy.options.baseSymbol) ||
                        'SPY';

                    signalsByBaseSymbol[baseSymbol] = signalsByBaseSymbol[baseSymbol] || [];

                    for (const signal of signals) {
                        // Apply risk management (includes TP/SL calculation)
                        const adjustedSignal = await riskManager.adjustSignal(signal, account, positions);
                        
                        if (adjustedSignal && adjustedSignal.quantity > 0) {
                            const quantity = Math.floor(adjustedSignal.quantity);
                            const currentPrice = adjustedSignal.currentPrice;

                            // CRITICAL FIX: Enhanced duplicate detection using Google Sheets
                            const duplicateCheck = await checkForDuplicateTradeUsingGoogleSheets(
                                sheetsLogger,
                                adjustedSignal,
                                currentPositions,
                                logger
                            );

                            if (!duplicateCheck.allowTrade) {
                                const duplicateTrade = {
                                    symbol: adjustedSignal.symbol,
                                    side: adjustedSignal.side,
                                    quantity: quantity,
                                    strategy: strategy.getName(),
                                    status: 'skipped',
                                    reasons: duplicateCheck.reasons,
                                    duplicateCheckDetails: duplicateCheck.details,
                                    timestamp: new Date().toISOString(),
                                    baseSymbol: baseSymbol
                                };
                                tradingResults.push(duplicateTrade);
                                
                                logger.info('CRITICAL FIX: Trade blocked by Google Sheets duplicate detection', duplicateTrade);
                                continue;
                            }

                            // Log signal strength for this trade to Google Sheets (for future duplicate detection)
                            await sheetsLogger.logSignalStrength({
                                timestamp: new Date().toISOString(),
                                symbol: adjustedSignal.symbol,
                                side: adjustedSignal.side,
                                strategy: strategy.getName(),
                                signalStrength: adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null),
                                orderId: null // Will be updated after trade if needed
                            });

                            // Enhanced validation with position manager (uses Google Sheets state)
                            const validation = await positionManager.validateTradeBeforeExecution(
                                adjustedSignal.symbol,
                                adjustedSignal.side,
                                quantity,
                                currentPrice
                            );

                            if (!validation.canTrade) {
                                logger.warning('Trade blocked by position manager validation (Google Sheets state)', {
                                    symbol: adjustedSignal.symbol,
                                    side: adjustedSignal.side,
                                    quantity: quantity,
                                    reasons: validation.skipReasons,
                                    strategy: strategy.getName()
                                });

                                // Log skipped trade
                                const skippedTrade = {
                                    symbol: adjustedSignal.symbol,
                                    side: adjustedSignal.side,
                                    quantity: quantity,
                                    strategy: strategy.getName(),
                                    status: 'skipped',
                                    reasons: validation.skipReasons,
                                    timestamp: new Date().toISOString(),
                                    baseSymbol: baseSymbol
                                };
                                tradingResults.push(skippedTrade);
                                continue;
                            }

                            // CRITICAL FIX: Execute trade with Google Sheets persistent TP/SL storage capability
                            const tradeResult = await executeTradeWithGoogleSheetsTPSLStorage(
                                positionManager,
                                adjustedSignal,
                                quantity,
                                currentPrice,
                                strategy.getName()
                            );

                            if (tradeResult.success) {
                                const enhancedTradeResult = {
                                    orderId: tradeResult.order.id,
                                    symbol: adjustedSignal.symbol,
                                    side: adjustedSignal.side,
                                    quantity: quantity,
                                    strategy: strategy.getName(),
                                    timestamp: new Date().toISOString(),
                                    price: currentPrice,
                                    stopLoss: adjustedSignal.stopLoss,
                                    takeProfit: adjustedSignal.takeProfit,
                                    status: 'executed',
                                    baseSymbol: baseSymbol,
                                    exitLevelsStored: tradeResult.exitLevelsStored || false,
                                    persistentStorageUsed: tradeResult.persistentStorageUsed || false,
                                    googleSheetsStateManagement: true, // NEW: Indicate Google Sheets state management is used
                                    duplicateCheckPassed: duplicateCheck.details,
                                    validation: {
                                        exposureCheck: validation.checks.exposure?.action || 'proceed',
                                        riskLimits: validation.checks.riskLimits?.withinLimits || true
                                    }
                                };

                                tradingResults.push(enhancedTradeResult);
                                signalsByBaseSymbol[baseSymbol].push(enhancedTradeResult);

                                // Log to Google Sheets
                                await sheetsLogger.logTrade({
                                    ...enhancedTradeResult,
                                    type: 'entry' // Distinguish between entry and exit trades
                                });

                                // CRITICAL FIX: Update signal strength log with orderId in Google Sheets
                                await sheetsLogger.logSignalStrength({
                                    timestamp: enhancedTradeResult.timestamp,
                                    symbol: enhancedTradeResult.symbol,
                                    side: enhancedTradeResult.side,
                                    strategy: enhancedTradeResult.strategy,
                                    signalStrength: adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null),
                                    orderId: tradeResult.order.id
                                });

                                logger.success('CRITICAL FIX: Trade executed successfully with Google Sheets state management', enhancedTradeResult);
                            } else {
                                // Handle failed or skipped trades
                                const failedTrade = {
                                    symbol: adjustedSignal.symbol,
                                    side: adjustedSignal.side,
                                    quantity: quantity,
                                    strategy: strategy.getName(),
                                    status: tradeResult.skipped ? 'skipped' : 'failed',
                                    reasons: tradeResult.reasons || [tradeResult.error?.message],
                                    timestamp: new Date().toISOString(),
                                    baseSymbol: baseSymbol
                                };
                                tradingResults.push(failedTrade);
                                await sheetsLogger.logTrade(failedTrade);
                                logger.warning('Trade execution failed or skipped', failedTrade);
                            }
                        } else {
                            logger.info('Signal filtered out by risk management', {
                                originalSignal: signal,
                                adjustedSignal: adjustedSignal,
                                strategy: strategy.getName()
                            });
                        }
                    }
                } catch (strategyError) {
                    logger.error(`Strategy ${strategy.getName()} error: ${strategyError.message}`, {
                        stack: strategyError.stack
                    });
                }
            }
        }

        // Get comprehensive position summary with persistent storage information
        const positionSummary = await positionManager.getEnhancedPositionSummary();

        // Get exit monitoring status with persistent storage information
        const exitMonitoringStatus = await exitManager.getMonitoringStatus();

        // Log system performance with enhanced metrics
        const performanceMetrics = await riskManager.calculatePerformanceMetrics(account, positions);
        performanceMetrics.positionBreakdown = {
            // Create breakdown for all configured symbols
            ...Object.fromEntries(
                getAllBaseSymbols().map(symbol => [`${symbol}_based`, signalsByBaseSymbol[symbol].length])
            ),
            totalActivePositions: positionSummary.totalPositions,
            totalPortfolioValue: positionSummary.totalValue,
            positionsWithExitLevels: exitMonitoringStatus.positionsWithStoredLevels || 0
        };

        await sheetsLogger.logPerformance(performanceMetrics);

        // CRITICAL FIX: Enhanced response with Google Sheets state management status
        const response = {
            status: 'success',
            
            // Phase 1: Exit monitoring results
            exitMonitoring: {
                positionsMonitored: exitResults.positionsMonitored,
                exitOrdersExecuted: exitResults.exitOrdersExecuted,
                stopLossTriggered: exitResults.stopLossTriggered,
                takeProfitTriggered: exitResults.takeProfitTriggered,
                exitTrades: exitResults.exitTrades,
                errors: exitResults.errors
            },
            
            // Phase 2: New trade execution results
            newTrades: {
                tradesExecuted: tradingResults.filter(t => t.status === 'executed').length,
                tradesSkipped: tradingResults.filter(t => t.status === 'skipped').length,
                tradesFailed: tradingResults.filter(t => t.status === 'failed').length,
                trades: tradingResults,
                signalBreakdown: Object.fromEntries(
                    getAllBaseSymbols().map(symbol => [`${symbol}_signals`, signalsByBaseSymbol[symbol].length])
                )
            },
            
            // Enhanced position and monitoring status
            positionSummary: positionSummary,
            exitMonitoringStatus: exitMonitoringStatus,
            
            // CRITICAL FIX: Google Sheets state management status
            persistentStorage: {
                enabled: sheetsLogger.enabled,
                synchronizationResult: syncResult,
                storageStats: await positionManager.positionStorage.getStorageStats(),
                googleSheetsStateManagement: true,
                mapCachesEliminated: true
            },
            
            // Configuration info
            configuration: {
                symbolTriplets: SYMBOL_TRIPLETS,
                strategiesEnabled: strategies.filter(s => s.isEnabled()).length,
                totalStrategies: strategies.length
            },
            
            performanceMetrics: performanceMetrics,
            
            // CRITICAL FIX: Cooldown status using Google Sheets instead of Map
            cooldownStatus: {
                allCooldowns: await positionManager.getAllCooldowns(),
                symbolSpecific: await getSymbolSpecificCooldowns(positionManager, currentPositions)
            },
            
            timestamp: new Date().toISOString()
        };

        logger.info('CRITICAL FIX: Enhanced trading system execution completed with Google Sheets state management', {
            exitOrdersExecuted: response.exitMonitoring.exitOrdersExecuted,
            newTradesExecuted: response.newTrades.tradesExecuted,
            newTradesSkipped: response.newTrades.tradesSkipped,
            newTradesFailed: response.newTrades.tradesFailed,
            ...Object.fromEntries(
                getAllBaseSymbols().map(symbol => [`${symbol}_signals`, response.newTrades.signalBreakdown[`${symbol}_signals`]])
            ),
            totalPositionsMonitored: response.exitMonitoring.positionsMonitored,
            persistentStorageEnabled: response.persistentStorage.enabled,
            storageSyncResult: response.persistentStorage.synchronizationResult,
            configuredSymbols: getAllBaseSymbols().length,
            googleSheetsStateManagement: response.persistentStorage.googleSheetsStateManagement,
            mapCachesEliminated: response.persistentStorage.mapCachesEliminated
        });

        return res.json(response);

    } catch (error) {
        logger.error('CRITICAL FIX: Enhanced trading system error', {
            error: error.message,
            stack: error.stack
        });
        
        return res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * CRITICAL FIX: Enhanced duplicate trade detection using Google Sheets
 * @param {GoogleSheetsLogger} sheetsLogger - Google Sheets logger instance
 * @param {Object} adjustedSignal - Risk-adjusted signal
 * @param {Map} currentPositions - Current positions from Alpaca
 * @param {Logger} logger - Logger instance
 * @returns {Object} Duplicate check result
 */
async function checkForDuplicateTradeUsingGoogleSheets(sheetsLogger, adjustedSignal, currentPositions, logger) {
    const result = {
        allowTrade: true,
        reasons: [],
        details: {}
    };

    try {
        // Check for open position in the same symbol
        const openPosition = currentPositions.get(adjustedSignal.symbol);
        if (openPosition) {
            // Get last signal strength for this symbol/side from Google Sheets
            const lastStrength = await sheetsLogger.getLastSignalStrength(adjustedSignal.symbol, adjustedSignal.side);
            const newStrength = adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null);
            
            if (lastStrength != null && newStrength != null) {
                // Only allow if new signal is at least 30% stronger than last
                if (newStrength <= lastStrength * 1.3) {
                    result.allowTrade = false;
                    result.reasons.push('duplicate_or_weak_signal');
                    result.details = {
                        openPosition: true,
                        lastSignalStrength: lastStrength,
                        newSignalStrength: newStrength,
                        improvementRequired: lastStrength * 1.3,
                        improvementPercentage: ((newStrength - lastStrength) / lastStrength * 100).toFixed(2) + '%'
                    };
                    
                    logger.info('CRITICAL FIX: Duplicate/open position detected via Google Sheets - new signal not strong enough', {
                        symbol: adjustedSignal.symbol,
                        lastStrength,
                        newStrength,
                        improvementRequired: lastStrength * 1.3
                    });
                } else {
                    result.details = {
                        openPosition: true,
                        signalImprovement: 'sufficient',
                        lastSignalStrength: lastStrength,
                        newSignalStrength: newStrength,
                        improvementPercentage: ((newStrength - lastStrength) / lastStrength * 100).toFixed(2) + '%'
                    };
                }
            } else if (lastStrength != null && newStrength == null) {
                result.allowTrade = false;
                result.reasons.push('duplicate_or_weak_signal');
                result.details = {
                    openPosition: true,
                    lastSignalStrength: lastStrength,
                    newSignalStrength: null,
                    reason: 'no_new_signal_strength_provided'
                };
                
                logger.info('CRITICAL FIX: Duplicate/open position detected via Google Sheets - no new signal strength provided', {
                    symbol: adjustedSignal.symbol,
                    lastStrength
                });
            }
        } else {
            result.details = {
                openPosition: false,
                freshSignal: true
            };
        }

        // Additional check: Get last trade time for this symbol from Google Sheets
        const lastTrade = await sheetsLogger.getLastTradeForSymbol(adjustedSignal.symbol);
        if (lastTrade && lastTrade.timestamp) {
            const timeSinceLastTrade = Date.now() - new Date(lastTrade.timestamp).getTime();
            const cooldownTime = parseInt(process.env.MIN_TIME_BETWEEN_TRADES) || 300000; // 5 minutes default
            
            if (timeSinceLastTrade < cooldownTime) {
                result.allowTrade = false;
                result.reasons.push('cooldown_active');
                result.details.cooldown = {
                    timeSinceLastTrade,
                    cooldownTime,
                    timeRemaining: cooldownTime - timeSinceLastTrade,
                    lastTradeTimestamp: lastTrade.timestamp
                };
                
                logger.info('CRITICAL FIX: Trade blocked by cooldown from Google Sheets', {
                    symbol: adjustedSignal.symbol,
                    timeSinceLastTrade,
                    cooldownTime,
                    timeRemaining: cooldownTime - timeSinceLastTrade
                });
            }
        }

        return result;

    } catch (error) {
        logger.error('CRITICAL FIX: Error in Google Sheets duplicate check', {
            symbol: adjustedSignal.symbol,
            error: error.message
        });
        
        // On error, allow trade but log the issue
        result.allowTrade = true;
        result.reasons.push('duplicate_check_error');
        result.details.error = error.message;
        return result;
    }
}

/**
 * CRITICAL FIX: Get symbol-specific cooldowns using Google Sheets
 * @param {TradingPositionManager} positionManager - Position manager instance
 * @param {Map} currentPositions - Current positions
 * @returns {Object} Symbol-specific cooldown status
 */
async function getSymbolSpecificCooldowns(positionManager, currentPositions) {
    const cooldowns = {};
    
    try {
        for (const symbol of currentPositions.keys()) {
            cooldowns[symbol] = await positionManager.getCooldownStatus(symbol);
        }
    } catch (error) {
        console.error('Error getting symbol-specific cooldowns from Google Sheets:', error);
    }
    
    return cooldowns;
}

/**
 * Generate strategies dynamically from symbol configuration
 * @returns {Array} Array of strategy instances
 */
function generateStrategiesFromConfig() {
    const strategies = [];

    // Generate strategies for each symbol triplet
    for (const triplet of SYMBOL_TRIPLETS) {
        const baseSymbol = triplet.baseSymbol;
        
        // Momentum Strategy
        strategies.push(new MomentumStrategy({
            enabled: process.env[`${baseSymbol}_MOMENTUM_ENABLED`] === 'true',
            name: `${baseSymbol}_Momentum`,
            baseSymbol: baseSymbol,
            symbols: [triplet.bullSymbol, triplet.bearSymbol],
            lookbackPeriod: parseInt(process.env[`${baseSymbol}_MOMENTUM_LOOKBACK`]) || 50,
            shortMA: parseInt(process.env[`${baseSymbol}_MOMENTUM_SHORT_MA`]) || 20,
            longMA: parseInt(process.env[`${baseSymbol}_MOMENTUM_LONG_MA`]) || 50,
            positionSize: parseFloat(process.env[`${baseSymbol}_MOMENTUM_POSITION_SIZE`]) || 0.025
        }));

        // Mean Reversion Strategy
        strategies.push(new MeanReversionStrategy({
            enabled: process.env[`${baseSymbol}_MEAN_REVERSION_ENABLED`] === 'true',
            name: `${baseSymbol}_MeanReversion`,
            baseSymbol: baseSymbol,
            symbols: [triplet.bullSymbol, triplet.bearSymbol],
            rsiPeriod: parseInt(process.env[`${baseSymbol}_RSI_PERIOD`]) || 14,
            oversoldThreshold: parseInt(process.env[`${baseSymbol}_RSI_OVERSOLD`]) || 30,
            overboughtThreshold: parseInt(process.env[`${baseSymbol}_RSI_OVERBOUGHT`]) || 70,
            positionSize: parseFloat(process.env[`${baseSymbol}_MEAN_REVERSION_POSITION_SIZE`]) || 0.02
        }));

        // Regime Detection Strategy
        strategies.push(new RegimeDetectionStrategy({
            enabled: process.env[`${baseSymbol}_REGIME_DETECTION_ENABLED`] === 'true',
            name: `${baseSymbol}_RegimeDetection`,
            baseSymbol: baseSymbol,
            bullSymbol: triplet.bullSymbol,
            bearSymbol: triplet.bearSymbol,
            spyLookback: parseInt(process.env[`${baseSymbol}_REGIME_LOOKBACK`]) || 200,
            positionSize: parseFloat(process.env[`${baseSymbol}_REGIME_POSITION_SIZE`]) || 0.03
        }));
    }

    return strategies;
}

/**
 * CRITICAL FIX: Enhanced helper function to execute trade with Google Sheets persistent TP/SL storage
 * @param {Object} positionManager - Trading position manager
 * @param {Object} adjustedSignal - Risk-adjusted signal
 * @param {number} quantity - Trade quantity
 * @param {number} currentPrice - Current market price
 * @param {string} strategy - Strategy name
 * @returns {Object} Trade execution result
 */
async function executeTradeWithGoogleSheetsTPSLStorage(positionManager, adjustedSignal, quantity, currentPrice, strategy) {
    try {
        // Prepare exit levels for persistent storage
        const exitLevels = {
            stopLoss: adjustedSignal.stopLoss || null,
            takeProfit: adjustedSignal.takeProfit || null
        };

        // CRITICAL FIX: Execute trade with enhanced Google Sheets persistent TP/SL storage
        const tradeResult = await positionManager.executeTradeWithTPSL(
            adjustedSignal.symbol,
            adjustedSignal.side,
            quantity,
            currentPrice,
            strategy,
            adjustedSignal.confidence || null, // signal strength
            exitLevels // TP/SL levels to store persistently in Google Sheets
        );

        // Enhance result with persistent storage information
        if (tradeResult.success) {
            tradeResult.exitLevelsStored = !!(exitLevels.stopLoss || exitLevels.takeProfit);
            tradeResult.persistentStorageUsed = positionManager.positionStorage?.sheetsLogger?.enabled || false;
            tradeResult.googleSheetsStateManagement = true; // NEW: Indicate Google Sheets state management
        }

        return tradeResult;
    } catch (error) {
        return {
            success: false,
            error: error,
            exitLevelsStored: false,
            persistentStorageUsed: false,
            googleSheetsStateManagement: false
        };
    }
}