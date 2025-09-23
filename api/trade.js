// api/trade.js - Main Trading Execution Endpoint
import { AlpacaApi } from '../lib/brokers/alpaca.js';
import { MomentumStrategy } from '../lib/strategies/momentum.js';
import { MeanReversionStrategy } from '../lib/strategies/meanReversion.js';
import { RegimeDetectionStrategy } from '../lib/strategies/regimeDetection.js';
import { RiskManager } from '../lib/utils/riskManager.js';
import { Logger } from '../lib/utils/logger.js';
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';

export default async function handler(req, res) {
    const logger = new Logger();
    const sheetsLogger = new GoogleSheetsLogger();

    try {
        logger.info('Trading system initiated', { timestamp: new Date().toISOString() });

        // Initialize Alpaca API
        const alpaca = new AlpacaApi({
            keyId: process.env.ALPACA_API_KEY,
            secretKey: process.env.ALPACA_SECRET_KEY,
            paper: process.env.ALPACA_PAPER === 'true',
            baseUrl: process.env.ALPACA_PAPER === 'true' ? 
                'https://paper-api.alpaca.markets' : 
                'https://api.alpaca.markets'
        });

        // Initialize strategies
        const strategies = [
            new MomentumStrategy({
                enabled: process.env.MOMENTUM_ENABLED === 'true',
                symbols: ['TQQQ', 'SQQQ'],
                lookbackPeriod: 50,
                shortMA: 20,
                longMA: 50,
                positionSize: 0.02 // 2% of portfolio
            }),
            new MeanReversionStrategy({
                enabled: process.env.MEAN_REVERSION_ENABLED === 'true',
                symbols: ['TQQQ', 'SQQQ'],
                rsiPeriod: 14,
                oversoldThreshold: 30,
                overboughtThreshold: 70,
                positionSize: 0.015 // 1.5% of portfolio
            }),
            new RegimeDetectionStrategy({
                enabled: process.env.REGIME_DETECTION_ENABLED === 'true',
                bullSymbol: 'TQQQ',
                bearSymbol: 'SQQQ',
                spyLookback: 200,
                positionSize: 0.03 // 3% of portfolio
            })
        ];

        // Initialize risk manager
        const riskManager = new RiskManager({
            maxPositionSize: 0.05, // 5% max per position
            maxDailyLoss: 0.02, // 2% max daily loss
            maxDrawdown: 0.10, // 10% max drawdown
            stopLossPercent: 0.03, // 3% stop loss
            takeProfitPercent: 0.06 // 6% take profit (2:1 ratio)
        });

        // Get current account info
        const account = await alpaca.getAccount();
        const currentEquity = parseFloat(account.equity);

        logger.info('Account info retrieved', { 
            equity: currentEquity,
            buyingPower: account.buying_power 
        });

        // Get current positions
        const positions = await alpaca.getPositions();

        // Check daily loss limit
        if (await riskManager.isDailyLossLimitExceeded(account, positions)) {
            logger.warning('Daily loss limit exceeded, skipping trades');
            return res.json({ 
                status: 'skipped', 
                reason: 'daily_loss_limit_exceeded',
                timestamp: new Date().toISOString()
            });
        }

        const tradingSignals = [];

        // Execute each enabled strategy
        for (const strategy of strategies) {
            if (strategy.isEnabled()) {
                try {
                    logger.info(`Executing strategy: ${strategy.getName()}`);

                    const signals = await strategy.generateSignals(alpaca);

                    for (const signal of signals) {
                        // Apply risk management
                        const adjustedSignal = await riskManager.adjustSignal(signal, account, positions);

                        if (adjustedSignal && adjustedSignal.quantity > 0) {
                            // Execute trade
                            const order = await alpaca.submitOrder({
                                symbol: adjustedSignal.symbol,
                                qty: Math.floor(adjustedSignal.quantity),
                                side: adjustedSignal.side,
                                type: 'market',
                                time_in_force: 'day'
                            });

                            const tradeResult = {
                                orderId: order.id,
                                symbol: adjustedSignal.symbol,
                                side: adjustedSignal.side,
                                quantity: Math.floor(adjustedSignal.quantity),
                                strategy: strategy.getName(),
                                timestamp: new Date().toISOString(),
                                price: adjustedSignal.currentPrice,
                                stopLoss: adjustedSignal.stopLoss,
                                takeProfit: adjustedSignal.takeProfit
                            };

                            tradingSignals.push(tradeResult);

                            // Log to Google Sheets
                            await sheetsLogger.logTrade(tradeResult);

                            logger.success('Trade executed successfully', tradeResult);
                        }
                    }
                } catch (strategyError) {
                    logger.error(`Strategy ${strategy.getName()} error: ${strategyError.message}`, {
                        stack: strategyError.stack
                    });
                }
            }
        }

        // Log system performance
        const performanceMetrics = await riskManager.calculatePerformanceMetrics(account, positions);
        await sheetsLogger.logPerformance(performanceMetrics);

        return res.json({
            status: 'success',
            tradesExecuted: tradingSignals.length,
            trades: tradingSignals,
            performanceMetrics,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Trading system error', { 
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