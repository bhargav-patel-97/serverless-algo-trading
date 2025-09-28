// api/backtest.js - Enhanced Backtesting with Dynamic Symbol Configuration
import { MomentumStrategy } from '../lib/strategies/momentum.js';
import { MeanReversionStrategy } from '../lib/strategies/meanReversion.js';
import { RegimeDetectionStrategy } from '../lib/strategies/regimeDetection.js';
import { Logger } from '../lib/utils/logger.js';
import { RSI } from '../lib/indicators/rsi.js';
import { MovingAverages } from '../lib/indicators/movingAverages.js';
import { SYMBOL_TRIPLETS, getSymbolTriplet, getAllBaseSymbols } from '../lib/config/symbolConfig.js';

export default async function handler(req, res) {
  const logger = new Logger();

  try {
    const {
      strategy = 'momentum',
      baseSymbol = 'SPY', // NEW: Allow specifying base symbol
      startDate = '2023-01-01',
      endDate = '2024-12-31',
      initialCapital = 100000
    } = req.body;

    // Get symbol triplet for the specified base symbol
    const symbolTriplet = getSymbolTriplet(baseSymbol);
    if (!symbolTriplet) {
      return res.status(400).json({
        status: 'error',
        message: `Symbol triplet not found for base symbol: ${baseSymbol}. Available symbols: ${getAllBaseSymbols().join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    const symbols = [symbolTriplet.bullSymbol, symbolTriplet.bearSymbol];

    logger.info('Starting enhanced backtest with symbol configuration', {
      strategy,
      baseSymbol,
      symbols,
      startDate,
      endDate,
      initialCapital
    });

    // Mock historical data generator (in production, use real historical data API)
    const historicalData = generateMockData(startDate, endDate, [baseSymbol, ...symbols]);

    // Initialize strategy with dynamic symbol configuration
    let strategyInstance;
    switch (strategy.toLowerCase()) {
      case 'momentum':
        strategyInstance = new MomentumStrategy({
          enabled: true,
          baseSymbol: baseSymbol,
          symbols: symbols,
          shortMA: 20,
          longMA: 50,
          positionSize: 0.02
        });
        break;

      case 'mean_reversion':
        strategyInstance = new MeanReversionStrategy({
          enabled: true,
          baseSymbol: baseSymbol,
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
          baseSymbol: baseSymbol,
          bullSymbol: symbolTriplet.bullSymbol,
          bearSymbol: symbolTriplet.bearSymbol,
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
      baseSymbol,
      symbols
    );

    logger.info('Backtest completed', {
      totalReturn: backtestResults.totalReturn,
      trades: backtestResults.trades.length,
      winRate: backtestResults.winRate,
      baseSymbol: baseSymbol
    });

    return res.json({
      status: 'success',
      strategy: strategy,
      configuration: {
        baseSymbol: baseSymbol,
        bullSymbol: symbolTriplet.bullSymbol,
        bearSymbol: symbolTriplet.bearSymbol,
        symbols: symbols
      },
      parameters: {
        startDate,
        endDate,
        initialCapital
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
      availableSymbols: getAllBaseSymbols(),
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
    
    // Set different starting prices based on symbol type
    let price;
    if (symbol === 'SPY' || symbol === 'QQQ' || symbol === 'GLD') {
      price = symbol === 'SPY' ? 400 : symbol === 'QQQ' ? 300 : 180; // Base symbols
    } else if (symbol.includes('T') || symbol === 'UGL') {
      price = 50; // 3x or 2x bull ETFs
    } else {
      price = 20; // Bear ETFs
    }

    for (let i = 0; i < daysCount; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);

      // Skip weekends
      if (date.getDay() === 0 || date.getDay() === 6) continue;

      // Generate price movement with some trend and volatility
      const change = (Math.random() - 0.5) * 0.06; // ±3% daily change
      
      // Set different trends based on symbol type
      let trend;
      if (symbol === 'SPY' || symbol === 'QQQ') {
        trend = 0.0003; // Slight upward trend for base symbols
      } else if (symbol === 'GLD') {
        trend = 0.0001; // Smaller trend for gold
      } else if (symbol.includes('T') || symbol === 'UGL') {
        trend = 0.0005; // Stronger trend for bull ETFs
      } else {
        trend = -0.0002; // Negative trend for bear ETFs
      }

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

async function runBacktest(strategy, historicalData, initialCapital, baseSymbol, symbols) {
  const trades = [];
  const portfolio = [];
  let currentCapital = initialCapital;
  let positions = {};

  // Get base symbol data for strategy calculations
  const baseData = historicalData[baseSymbol] || [];

  for (let i = 50; i < baseData.length; i++) { // Start after warm-up period
    const currentDate = baseData[i].timestamp;
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
            reason: signal.reason,
            baseSymbol: baseSymbol,
            confidence: signal.confidence || 0.5
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

  // Calculate symbol-specific metrics
  const symbolMetrics = {};
  symbols.forEach(symbol => {
    const symbolTrades = trades.filter(t => t.symbol === symbol);
    const symbolWins = symbolTrades.filter(t => t.pnl && t.pnl > 0).length;
    const symbolLosses = symbolTrades.filter(t => t.pnl && t.pnl < 0).length;
    
    symbolMetrics[symbol] = {
      totalTrades: symbolTrades.length,
      winningTrades: symbolWins,
      losingTrades: symbolLosses,
      winRate: symbolWins / (symbolWins + symbolLosses) || 0,
      totalPnL: symbolTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)
    };
  });

  return {
    initialCapital,
    finalValue,
    totalReturn,
    trades,
    portfolio,
    symbolMetrics, // NEW: Symbol-specific performance
    metrics: {
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      winRate: winRate * 100,
      maxDrawdown,
      totalPnL: finalValue - initialCapital,
      avgTradeReturn: trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / trades.length || 0,
      baseSymbol: baseSymbol,
      bullSymbol: symbols[0],
      bearSymbol: symbols[1]
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