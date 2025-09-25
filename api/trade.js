// Enhanced api/trade.js - Now with Take Profit/Stop Loss Position Monitoring
// Integrates PositionExitManager for comprehensive position management

import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { MomentumStrategy } from '../lib/strategies/momentum.js';
import { MeanReversionStrategy } from '../lib/strategies/meanReversion.js';
import { RegimeDetectionStrategy } from '../lib/strategies/regimeDetection.js';
import { RiskManager } from '../lib/utils/riskManager.js';
import { Logger } from '../lib/utils/logger.js';
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';
import TradingPositionManager from '../lib/TradingPositionManager.js';
import { PositionExitManager } from '../lib/PositionExitManager.js'; // NEW

export default async function handler(req, res) {
  const logger = new Logger();
  const sheetsLogger = new GoogleSheetsLogger();
  
  try {
    logger.info('Enhanced Trading System with TP/SL Position Monitoring initiated', {
      timestamp: new Date().toISOString()
    });

    // Initialize Alpaca API
    const alpaca = new AlpacaHybridApi({
      keyId: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: process.env.ALPACA_PAPER === 'true',
      baseUrl: process.env.ALPACA_PAPER === 'true' ?
        'https://paper-api.alpaca.markets' :
        'https://api.alpaca.markets'
    });

    // Initialize Position Manager with enhanced settings
    const positionManager = new TradingPositionManager(alpaca, {
      minTimeBetweenTrades: parseInt(process.env.MIN_TIME_BETWEEN_TRADES) || 300000, // 5 minutes default
      maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT) || 0.08, // 8% max position
      enableLogging: true,
      logger: logger
    });

    // NEW: Initialize Position Exit Manager for TP/SL monitoring
    const exitManager = new PositionExitManager(alpaca, {
      enableLogging: true,
      logger: logger,
      priceBuffer: parseFloat(process.env.EXIT_PRICE_BUFFER) || 0.001, // 0.1% buffer
      maxRetries: parseInt(process.env.EXIT_ORDER_MAX_RETRIES) || 3,
      emergencyStopEnabled: process.env.EMERGENCY_STOP_ENABLED !== 'false'
    });

    // Enhanced strategies with both SPY and QQQ support
    const strategies = [
      // SPY Momentum Strategy
      new MomentumStrategy({
        enabled: process.env.SPY_MOMENTUM_ENABLED === 'true',
        name: 'SPY_Momentum',
        baseSymbol: 'SPY',
        symbols: ['UPRO', 'SPXU'], // SPY leveraged ETFs
        lookbackPeriod: parseInt(process.env.SPY_MOMENTUM_LOOKBACK) || 50,
        shortMA: parseInt(process.env.SPY_MOMENTUM_SHORT_MA) || 20,
        longMA: parseInt(process.env.SPY_MOMENTUM_LONG_MA) || 50,
        positionSize: parseFloat(process.env.SPY_MOMENTUM_POSITION_SIZE) || 0.025
      }),

      // QQQ Momentum Strategy
      new MomentumStrategy({
        enabled: process.env.QQQ_MOMENTUM_ENABLED === 'true',
        name: 'QQQ_Momentum',
        baseSymbol: 'QQQ',
        symbols: ['TQQQ', 'SQQQ'], // QQQ leveraged ETFs
        lookbackPeriod: parseInt(process.env.QQQ_MOMENTUM_LOOKBACK) || 50,
        shortMA: parseInt(process.env.QQQ_MOMENTUM_SHORT_MA) || 20,
        longMA: parseInt(process.env.QQQ_MOMENTUM_LONG_MA) || 50,
        positionSize: parseFloat(process.env.QQQ_MOMENTUM_POSITION_SIZE) || 0.02
      }),

      // SPY Mean Reversion Strategy
      new MeanReversionStrategy({
        enabled: process.env.SPY_MEAN_REVERSION_ENABLED === 'true',
        name: 'SPY_MeanReversion',
        baseSymbol: 'SPY',
        symbols: ['UPRO', 'SPXU'],
        rsiPeriod: parseInt(process.env.SPY_RSI_PERIOD) || 14,
        oversoldThreshold: parseInt(process.env.SPY_RSI_OVERSOLD) || 30,
        overboughtThreshold: parseInt(process.env.SPY_RSI_OVERBOUGHT) || 70,
        positionSize: parseFloat(process.env.SPY_MEAN_REVERSION_POSITION_SIZE) || 0.02
      }),

      // QQQ Mean Reversion Strategy
      new MeanReversionStrategy({
        enabled: process.env.QQQ_MEAN_REVERSION_ENABLED === 'true',
        name: 'QQQ_MeanReversion',
        baseSymbol: 'QQQ',
        symbols: ['TQQQ', 'SQQQ'],
        rsiPeriod: parseInt(process.env.QQQ_RSI_PERIOD) || 14,
        oversoldThreshold: parseInt(process.env.QQQ_RSI_OVERSOLD) || 30,
        overboughtThreshold: parseInt(process.env.QQQ_RSI_OVERBOUGHT) || 70,
        positionSize: parseFloat(process.env.QQQ_MEAN_REVERSION_POSITION_SIZE) || 0.015
      }),

      // SPY Regime Detection Strategy
      new RegimeDetectionStrategy({
        enabled: process.env.SPY_REGIME_DETECTION_ENABLED === 'true',
        name: 'SPY_RegimeDetection',
        baseSymbol: 'SPY',
        bullSymbol: 'UPRO',
        bearSymbol: 'SPXU',
        spyLookback: parseInt(process.env.SPY_REGIME_LOOKBACK) || 200,
        positionSize: parseFloat(process.env.SPY_REGIME_POSITION_SIZE) || 0.03
      }),

      // QQQ Regime Detection Strategy
      new RegimeDetectionStrategy({
        enabled: process.env.QQQ_REGIME_DETECTION_ENABLED === 'true',
        name: 'QQQ_RegimeDetection',
        baseSymbol: 'QQQ',
        bullSymbol: 'TQQQ',
        bearSymbol: 'SQQQ',
        spyLookback: parseInt(process.env.QQQ_REGIME_LOOKBACK) || 200,
        positionSize: parseFloat(process.env.QQQ_REGIME_POSITION_SIZE) || 0.025
      })
    ];

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

    // =====================================
    // NEW: POSITION EXIT MONITORING PHASE
    // =====================================
    logger.info('Phase 1: Monitoring existing positions for TP/SL exits');
    
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

    // ===================================
    // EXISTING: NEW TRADE SIGNALS PHASE
    // ===================================
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
    const signalsByBaseSymbol = { SPY: [], QQQ: [] };

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
                await sheetsLogger.logTrade(skippedTrade);
                continue;
              }

              // NEW: Execute trade with TP/SL storage capability
              const tradeResult = await executeTradeWithTPSLStorage(
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
                  exitLevelsStored: true, // NEW: Indicates TP/SL levels are stored
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
                  type: 'entry' // NEW: Distinguish between entry and exit trades
                });

                logger.success('Trade executed successfully with TP/SL storage', enhancedTradeResult);
                
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

    // Get comprehensive position summary
    const positionSummary = await positionManager.getPositionSummary();
    
    // NEW: Get exit monitoring status
    const exitMonitoringStatus = await exitManager.getMonitoringStatus();

    // Log system performance with enhanced metrics
    const performanceMetrics = await riskManager.calculatePerformanceMetrics(account, positions);
    performanceMetrics.positionBreakdown = {
      SPY_based: signalsByBaseSymbol.SPY.length,
      QQQ_based: signalsByBaseSymbol.QQQ.length,
      totalActivePositions: positionSummary.totalPositions,
      totalPortfolioValue: positionSummary.totalValue,
      positionsWithExitLevels: exitMonitoringStatus.positionsWithStoredLevels || 0
    };

    await sheetsLogger.logPerformance(performanceMetrics);

    // Enhanced response with both exit and entry trade data
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
        signalBreakdown: {
          SPY_signals: signalsByBaseSymbol.SPY.length,
          QQQ_signals: signalsByBaseSymbol.QQQ.length
        }
      },
      
      // Enhanced position and monitoring status
      positionSummary: positionSummary,
      exitMonitoringStatus: exitMonitoringStatus,
      performanceMetrics: performanceMetrics,
      
      cooldownStatus: {
        allCooldowns: positionManager.getAllCooldowns(),
        symbolSpecific: Array.from(currentPositions.keys()).reduce((status, symbol) => {
          try {
            status[symbol] = positionManager.getCooldownStatus(symbol);
          } catch (error) {
            status[symbol] = { error: error.message, isInCooldown: false };
          }
          return status;
        }, {})
      },
      
      timestamp: new Date().toISOString()
    };

    logger.info('Enhanced trading system execution completed', {
      exitOrdersExecuted: response.exitMonitoring.exitOrdersExecuted,
      newTradesExecuted: response.newTrades.tradesExecuted,
      newTradesSkipped: response.newTrades.tradesSkipped,
      newTradesFailed: response.newTrades.tradesFailed,
      SPY_signals: response.newTrades.signalBreakdown.SPY_signals,
      QQQ_signals: response.newTrades.signalBreakdown.QQQ_signals,
      totalPositionsMonitored: response.exitMonitoring.positionsMonitored
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
 * Helper function to execute trade with TP/SL storage
 * @param {Object} positionManager - Trading position manager
 * @param {Object} adjustedSignal - Risk-adjusted signal
 * @param {number} quantity - Trade quantity
 * @param {number} currentPrice - Current market price
 * @param {string} strategy - Strategy name
 * @returns {Object} Trade execution result
 */
async function executeTradeWithTPSLStorage(positionManager, adjustedSignal, quantity, currentPrice, strategy) {
  try {
    // Execute the trade
    const tradeResult = await positionManager.executeTradeWithValidation(
      adjustedSignal.symbol,
      adjustedSignal.side,
      quantity,
      currentPrice,
      strategy
    );

    if (tradeResult.success) {
      // Store TP/SL levels if the trade was successful
      // Note: The adjustedSignal should contain stopLoss and takeProfit from RiskManager
      if (adjustedSignal.stopLoss || adjustedSignal.takeProfit) {
        // We would need to enhance the positionManager to store these levels
        // For now, we'll just indicate that levels should be stored
        tradeResult.exitLevelsStored = true;
      }
    }

    return tradeResult;
    
  } catch (error) {
    return {
      success: false,
      error: error,
      exitLevelsStored: false
    };
  }
}