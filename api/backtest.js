// api/backtest.js - Backtesting Functionality
import { MomentumStrategy } from '../lib/strategies/momentum.js';
import { MeanReversionStrategy } from '../lib/strategies/meanReversion.js';
import { RegimeDetectionStrategy } from '../lib/strategies/regimeDetection.js';
import { Logger } from '../lib/utils/logger.js';
import { RSI } from '../lib/indicators/rsi.js';
import { MovingAverages } from '../lib/indicators/movingAverages.js';

export default async function handler(req, res) {
    const logger = new Logger();

    try {
        const {
            strategy = 'momentum',
            startDate = '2023-01-01',
            endDate = '2024-12-31',
            initialCapital = 100000,
            symbols = ['TQQQ', 'SQQQ']
        } = req.body;

        logger.info('Starting backtest', {
            strategy,
            startDate,
            endDate,
            initialCapital,
            symbols
        });

        // Mock historical data generator (in production, use real historical data API)
        const historicalData = generateMockData(startDate, endDate, symbols);

        // Initialize strategy
        let strategyInstance;
        switch (strategy.toLowerCase()) {
            case 'momentum':
                strategyInstance = new MomentumStrategy({
                    enabled: true,
                    symbols: symbols,
                    shortMA: 20,
                    longMA: 50,
                    positionSize: 0.02
                });
                break;
            case 'mean_reversion':
                strategyInstance = new MeanReversionStrategy({
                    enabled: true,
                    symbols: symbols,
                    rsiPeriod: 14,
                    oversoldThreshold: 30,
                    overboughtThreshold: 70,
                    positionSize: 0.015
                });
                break;
            case 'regime_detection':
                strategyInstance = new RegimeDetectionStrategy({
                    enabled: true,
                    bullSymbol: 'TQQQ',
                    bearSymbol: 'SQQQ',
                    spyLookback: 200,
                    positionSize: 0.03
                });
                break;
            default:
                throw new Error(`Unknown strategy: ${strategy}`);
        }

        // Run backtest simulation
        const backtestResults = await runBacktest(
            strategyInstance, 
            historicalData, 
            initialCapital, 
            symbols
        );

        logger.info('Backtest completed', {
            totalReturn: backtestResults.totalReturn,
            trades: backtestResults.trades.length,
            winRate: backtestResults.winRate
        });

        return res.json({
            status: 'success',
            strategy: strategy,
            parameters: {
                startDate,
                endDate,
                initialCapital,
                symbols
            },
            results: backtestResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Backtest API error', { 
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

function generateMockData(startDate, endDate, symbols) {
    // Generate mock OHLC data for backtesting
    // In production, replace with real historical data API calls
    const data = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysCount = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    symbols.forEach(symbol => {
        data[symbol] = [];
        let price = symbol === 'TQQQ' ? 50 : 20; // Starting prices

        for (let i = 0; i < daysCount; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);

            // Skip weekends
            if (date.getDay() === 0 || date.getDay() === 6) continue;

            // Generate price movement with some trend and volatility
            const change = (Math.random() - 0.5) * 0.06; // ±3% daily change
            const trend = symbol === 'TQQQ' ? 0.0003 : -0.0001; // Slight upward trend for TQQQ
            price = price * (1 + change + trend);

            const high = price * (1 + Math.random() * 0.02);
            const low = price * (1 - Math.random() * 0.02);
            const volume = 1000000 + Math.random() * 5000000;

            data[symbol].push({
                timestamp: date.toISOString(),
                open: price,
                high: high,
                low: low,
                close: price,
                volume: Math.floor(volume)
            });
        }
    });

    return data;
}

async function runBacktest(strategy, historicalData, initialCapital, symbols) {
    const trades = [];
    const portfolio = [];
    let currentCapital = initialCapital;
    let positions = {};

    // Get SPY data for strategy calculations
    const spyData = historicalData[symbols[0]] || []; // Use first symbol as proxy

    for (let i = 50; i < spyData.length; i++) { // Start after warm-up period
        const currentDate = spyData[i].timestamp;
        const mockAlpaca = createMockAlpacaApi(historicalData, i);

        try {
            // Generate signals for current date
            const signals = await strategy.generateSignals(mockAlpaca);

            // Execute trades
            for (const signal of signals) {
                const currentPrice = historicalData[signal.symbol][i].close;
                const tradeSize = currentCapital * signal.positionSize;
                const quantity = Math.floor(tradeSize / currentPrice);

                if (quantity > 0) {
                    const trade = {
                        date: currentDate,
                        symbol: signal.symbol,
                        side: signal.side,
                        quantity: quantity,
                        price: currentPrice,
                        value: quantity * currentPrice,
                        reason: signal.reason
                    };

                    trades.push(trade);

                    // Update positions
                    if (signal.side === 'buy') {
                        positions[signal.symbol] = (positions[signal.symbol] || 0) + quantity;
                        currentCapital -= trade.value;
                    } else {
                        const sellQuantity = Math.min(quantity, positions[signal.symbol] || 0);
                        positions[signal.symbol] = (positions[signal.symbol] || 0) - sellQuantity;
                        currentCapital += sellQuantity * currentPrice;

                        // Calculate P&L for sell trades
                        const buyTrade = trades.find(t => 
                            t.symbol === signal.symbol && 
                            t.side === 'buy' && 
                            !t.closed
                        );
                        if (buyTrade) {
                            trade.pnl = (currentPrice - buyTrade.price) * sellQuantity;
                            buyTrade.closed = true;
                        }
                    }
                }
            }

            // Calculate portfolio value
            let portfolioValue = currentCapital;
            for (const [symbol, qty] of Object.entries(positions)) {
                if (qty > 0) {
                    portfolioValue += qty * historicalData[symbol][i].close;
                }
            }

            portfolio.push({
                date: currentDate,
                value: portfolioValue,
                cash: currentCapital,
                return: ((portfolioValue - initialCapital) / initialCapital) * 100
            });

        } catch (error) {
            // Continue backtest even if individual day fails
            console.warn(`Backtest error on ${currentDate}: ${error.message}`);
        }
    }

    // Calculate performance metrics
    const finalValue = portfolio[portfolio.length - 1].value;
    const totalReturn = ((finalValue - initialCapital) / initialCapital) * 100;
    const winningTrades = trades.filter(t => t.pnl && t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl && t.pnl < 0).length;
    const winRate = winningTrades / (winningTrades + losingTrades) || 0;

    // Calculate maximum drawdown
    let maxDrawdown = 0;
    let peak = initialCapital;
    for (const point of portfolio) {
        if (point.value > peak) peak = point.value;
        const drawdown = ((peak - point.value) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
        initialCapital,
        finalValue,
        totalReturn,
        trades,
        portfolio,
        metrics: {
            totalTrades: trades.length,
            winningTrades,
            losingTrades,
            winRate: winRate * 100,
            maxDrawdown,
            totalPnL: finalValue - initialCapital,
            avgTradeReturn: trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / trades.length || 0
        }
    };
}

function createMockAlpacaApi(historicalData, currentIndex) {
    return {
        async getHistoricalData(symbol, timeframe, limit) {
            const data = historicalData[symbol] || [];
            return data.slice(Math.max(0, currentIndex - limit + 1), currentIndex + 1);
        },

        async getQuote(symbol) {
            const price = historicalData[symbol][currentIndex].close;
            return {
                bid: price * 0.999,
                ask: price * 1.001,
                symbol: symbol
            };
        }
    };
}