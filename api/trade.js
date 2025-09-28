// Enhanced api/trade.js - Now with Dynamic Symbol Configuration Support
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
    logger.info('Enhanced Trading System with Dynamic Symbol Configuration initiated', {
      timestamp: new Date().toISOString(),
      configuredSymbols: getAllBaseSymbols()
    });

    // Initialize all required Google Sheets
    await sheetsLogger.initializeSignalStrengthSheet();
    await sheetsLogger.initializePositionLevelsSheet(); // NEW: Initialize persistent storage sheet

    // Initialize Alpaca API
    const alpaca = new AlpacaHybridApi({
      keyId: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: process.env.ALPACA_PAPER === 'true',
      baseUrl: process.env.ALPACA_PAPER === 'true' ? 
        'https://paper-api.alpaca.markets' : 
        'https://api.alpaca.markets'
    });

    // Initialize Position Manager with enhanced persistent storage settings
    const positionManager = new TradingPositionManager(alpaca, {
      minTimeBetweenTrades: parseInt(process.env.MIN_TIME_BETWEEN_TRADES) || 300000, // 5 minutes default
      maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT) || 0.08, // 8% max position
      enableLogging: true,
      logger: logger,
      // NEW: Enhanced storage options for persistent backend
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
      // NEW: Storage configuration for persistent backend
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

    // NEW: Synchronize position storage with persistent backend after cold start
    logger.info('Synchronizing position storage with persistent backend');
    const syncResult = await positionManager.positionStorage.synchronizeWithPersistentStorage();
    logger.info('Position storage synchronization completed', syncResult);

    // =============================================================================
    // PHASE 1: POSITION EXIT MONITORING (with persistent storage)
    // =============================================================================
    logger.info('Phase 1: Monitoring existing positions for TP/SL exits (with persistent storage)');
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
    // PHASE 2: NEW TRADE SIGNALS PROCESSING
    // =============================================================================
    logger.info('Phase 2: Processing new trade signals');
    
    // Get current positions with position manager
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

              // --- ENHANCEMENT: Prevent duplicate trades and manage signal strength ---
              // Check for open position in the same symbol
              const openPosition = currentPositions.get(adjustedSignal.symbol);
              let allowTrade = true;
              
              if (openPosition) {
                // Get last signal strength for this symbol/side from Google Sheets
                const lastStrength = await sheetsLogger.getLastSignalStrength(adjustedSignal.symbol, adjustedSignal.side);
                const newStrength = adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null);
                
                if (lastStrength != null && newStrength != null) {
                  // Only allow if new signal is at least 30% stronger than last
                  if (newStrength <= lastStrength * 1.3) {
                    allowTrade = false;
                    logger.info('Duplicate/open position detected: new signal not strong enough to re-enter', {
                      symbol: adjustedSignal.symbol,
                      lastStrength,
                      newStrength
                    });
                  }
                } else if (lastStrength != null && newStrength == null) {
                  allowTrade = false;
                  logger.info('Duplicate/open position detected: no new signal strength provided', {
                    symbol: adjustedSignal.symbol,
                    lastStrength
                  });
                }
              }

              if (!allowTrade) {
                const duplicateTrade = {
                  symbol: adjustedSignal.symbol,
                  side: adjustedSignal.side,
                  quantity: quantity,
                  strategy: strategy.getName(),
                  status: 'skipped',
                  reasons: ['duplicate_or_weak_signal'],
                  timestamp: new Date().toISOString(),
                  baseSymbol: baseSymbol
                };
                tradingResults.push(duplicateTrade);
                continue;
              }

              // Log signal strength for this trade
              await sheetsLogger.logSignalStrength({
                timestamp: new Date().toISOString(),
                symbol: adjustedSignal.symbol,
                side: adjustedSignal.side,
                strategy: strategy.getName(),
                signalStrength: adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null),
                orderId: null // Will be updated after trade if needed
              });
              // --- END ENHANCEMENT ---

              // Enhanced validation with position manager
              const validation = await positionManager.validateTradeBeforeExecution(
                adjustedSignal.symbol,
                adjustedSignal.side,
                quantity,
                currentPrice
              );

              if (!validation.canTrade) {
                logger.warning('Trade blocked by position manager', {
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

              // Execute trade with persistent TP/SL storage capability
              const tradeResult = await executeTradeWithPersistentTPSLStorage(
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
                  persistentStorageUsed: tradeResult.persistentStorageUsed || false, // NEW
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

                // After successful trade, update signal strength log with orderId
                await sheetsLogger.logSignalStrength({
                  timestamp: enhancedTradeResult.timestamp,
                  symbol: enhancedTradeResult.symbol,
                  side: enhancedTradeResult.side,
                  strategy: enhancedTradeResult.strategy,
                  signalStrength: adjustedSignal.confidence != null ? adjustedSignal.confidence : (adjustedSignal.signalStrength != null ? adjustedSignal.signalStrength : null),
                  orderId: tradeResult.order.id
                });

                logger.success('Trade executed successfully with persistent TP/SL storage', enhancedTradeResult);
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

    // Enhanced response with both exit and entry trade data + persistent storage status
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
      
      // NEW: Persistent storage status
      persistentStorage: {
        enabled: sheetsLogger.enabled,
        synchronizationResult: syncResult,
        storageStats: await positionManager.positionStorage.getStorageStats()
      },
      
      // Configuration info
      configuration: {
        symbolTriplets: SYMBOL_TRIPLETS,
        strategiesEnabled: strategies.filter(s => s.isEnabled()).length,
        totalStrategies: strategies.length
      },
      
      performanceMetrics: performanceMetrics,
      
      cooldownStatus: {
        allCooldowns: positionManager.getAllCooldowns ? positionManager.getAllCooldowns() : {},
        symbolSpecific: Array.from(currentPositions.keys()).reduce((status, symbol) => {
          try {
            status[symbol] = positionManager.getCooldownStatus ? positionManager.getCooldownStatus(symbol) : { isInCooldown: false };
          } catch (error) {
            status[symbol] = { error: error.message, isInCooldown: false };
          }
          return status;
        }, {})
      },
      
      timestamp: new Date().toISOString()
    };

    logger.info('Enhanced trading system execution completed with dynamic symbol configuration', {
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
      configuredSymbols: getAllBaseSymbols().length
    });

    return res.json(response);

  } catch (error) {
    logger.error('Enhanced trading system error', {
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
 * Generate strategies dynamically from symbol configuration
 * @returns {Array} Array of strategy instances
 */
function generateStrategiesFromConfig() {
  const strategies = [];

  // Generate strategies for each symbol triplet
  for (const triplet of SYMBOL_TRIPLETS) {
    const baseSymbol = triplet.baseSymbol;
    const symbolPrefix = baseSymbol.toLowerCase();

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
 * Enhanced helper function to execute trade with persistent TP/SL storage
 * @param {Object} positionManager - Trading position manager
 * @param {Object} adjustedSignal - Risk-adjusted signal
 * @param {number} quantity - Trade quantity
 * @param {number} currentPrice - Current market price
 * @param {string} strategy - Strategy name
 * @returns {Object} Trade execution result
 */
async function executeTradeWithPersistentTPSLStorage(positionManager, adjustedSignal, quantity, currentPrice, strategy) {
  try {
    // Prepare exit levels for persistent storage
    const exitLevels = {
      stopLoss: adjustedSignal.stopLoss || null,
      takeProfit: adjustedSignal.takeProfit || null
    };

    // Execute trade with enhanced persistent TP/SL storage
    const tradeResult = await positionManager.executeTradeWithTPSL(
      adjustedSignal.symbol,
      adjustedSignal.side,
      quantity,
      currentPrice,
      strategy,
      adjustedSignal.confidence || null, // signal strength
      exitLevels // TP/SL levels to store persistently
    );

    // Enhance result with persistent storage information
    if (tradeResult.success) {
      tradeResult.exitLevelsStored = !!(exitLevels.stopLoss || exitLevels.takeProfit);
      tradeResult.persistentStorageUsed = positionManager.positionStorage?.sheetsLogger?.enabled || false;
    }

    return tradeResult;
  } catch (error) {
    return {
      success: false,
      error: error,
      exitLevelsStored: false,
      persistentStorageUsed: false
    };
  }
}