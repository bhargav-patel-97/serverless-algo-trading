// api/portfolio.js - Enhanced Portfolio Management Endpoint with Performance Metrics
import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { Logger } from '../lib/utils/logger.js';
import { RiskManager } from '../lib/utils/riskManager.js';

export default async function handler(req, res) {
  const logger = new Logger();
  
  try {
    // Initialize Alpaca API
    const alpaca = new AlpacaHybridApi({
      keyId: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: process.env.ALPACA_PAPER === 'true',
      baseUrl: process.env.ALPACA_PAPER === 'true' ? 
        'https://paper-api.alpaca.markets' : 
        'https://api.alpaca.markets'
    });

    const riskManager = new RiskManager({
      maxPositionSize: 0.05,
      maxDailyLoss: 0.02,
      maxDrawdown: 0.10
    });

    // Get account information
    const account = await alpaca.getAccount();
    
    // Get current positions
    const positions = await alpaca.getPositions();
    
    // Get recent orders (for display in UI)
    const recentOrders = await alpaca.getOrders('all');
    const last10Orders = recentOrders.slice(0, 10);
    
    // Get comprehensive order history for enhanced performance metrics
    const allOrders = await alpaca.alpaca.getOrders({
      limit: 500, // Get more historical data
      direction: 'desc'
    });
    
    // Calculate portfolio allocation
    const totalValue = parseFloat(account.portfolio_value);
    const cashValue = parseFloat(account.cash);
    const investedValue = totalValue - cashValue;
    
    // Calculate position details
    const positionDetails = await Promise.all(positions.map(async (position) => {
      try {
        const quote = await alpaca.getQuote(position.symbol);
        const currentPrice = (quote.bid + quote.ask) / 2;
        
        return {
          symbol: position.symbol,
          quantity: parseFloat(position.qty),
          side: position.side,
          entryPrice: parseFloat(position.avg_entry_price),
          currentPrice: currentPrice,
          marketValue: parseFloat(position.market_value),
          unrealizedPL: parseFloat(position.unrealized_pl),
          unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
          allocation: (parseFloat(position.market_value) / totalValue) * 100,
          dayChange: parseFloat(position.change_today || 0),
          dayChangePercent: parseFloat(position.unrealized_intraday_plpc || 0) * 100
        };
      } catch (error) {
        logger.error(`Error getting quote for ${position.symbol}`, error);
        return {
          symbol: position.symbol,
          quantity: parseFloat(position.qty),
          side: position.side,
          entryPrice: parseFloat(position.avg_entry_price),
          currentPrice: parseFloat(position.avg_entry_price), // Fallback
          marketValue: parseFloat(position.market_value),
          unrealizedPL: parseFloat(position.unrealized_pl),
          unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
          allocation: (parseFloat(position.market_value) / totalValue) * 100,
          dayChange: parseFloat(position.change_today || 0),
          dayChangePercent: parseFloat(position.unrealized_intraday_plpc || 0) * 100
        };
      }
    }));

    // ENHANCED PERFORMANCE METRICS CALCULATION
    const enhancedPerformanceMetrics = await calculateEnhancedPerformanceMetrics(
      allOrders, 
      account, 
      positions, 
      riskManager
    );

    // Calculate risk metrics
    const riskMetrics = {
      portfolioValue: totalValue,
      cashBalance: cashValue,
      investedAmount: investedValue,
      buyingPower: parseFloat(account.buying_power),
      dayTradingBuyingPower: parseFloat(account.daytrading_buying_power),
      maintenanceMargin: parseFloat(account.maintenance_margin),
      portfolioDiversification: positions.length,
      largestPositionPercent: Math.max(...positionDetails.map(p => p.allocation)),
      totalUnrealizedPL: positionDetails.reduce((sum, p) => sum + p.unrealizedPL, 0),
      totalDayChange: positionDetails.reduce((sum, p) => sum + p.dayChange, 0)
    };

    // Format recent orders
    const formattedOrders = last10Orders.map(order => ({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: parseFloat(order.qty),
      orderType: order.order_type,
      timeInForce: order.time_in_force,
      status: order.status,
      submittedAt: order.submitted_at,
      filledAt: order.filled_at,
      filledQuantity: parseFloat(order.filled_qty || 0),
      filledPrice: parseFloat(order.filled_avg_price || 0)
    }));

    logger.info('Enhanced portfolio data retrieved successfully', {
      positionsCount: positions.length,
      totalValue: totalValue,
      unrealizedPL: riskMetrics.totalUnrealizedPL,
      allTimeTradesAnalyzed: enhancedPerformanceMetrics.totalTrades,
      realizedPnL: enhancedPerformanceMetrics.allTimePnL
    });

    return res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      account: {
        id: account.id,
        accountNumber: account.account_number,
        status: account.status,
        portfolioValue: totalValue,
        equity: parseFloat(account.equity),
        cash: cashValue,
        buyingPower: parseFloat(account.buying_power),
        patternDayTrader: account.pattern_day_trader,
        tradingBlocked: account.trading_blocked
      },
      positions: positionDetails,
      recentOrders: formattedOrders,
      
      // ENHANCED PERFORMANCE METRICS
      performanceMetrics: enhancedPerformanceMetrics,
      
      riskMetrics,
      allocation: {
        cash: (cashValue / totalValue) * 100,
        invested: (investedValue / totalValue) * 100,
        byPosition: positionDetails.map(p => ({
          symbol: p.symbol,
          allocation: p.allocation
        }))
      }
    });

  } catch (error) {
    logger.error('Enhanced portfolio API error', { 
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
 * Calculate enhanced performance metrics including all-time trades and P&L
 */
async function calculateEnhancedPerformanceMetrics(allOrders, account, positions, riskManager) {
  try {
    // Filter filled orders only
    const filledOrders = allOrders.filter(order => order.status === 'filled');
    
    // Calculate basic trade statistics
    const totalTrades = filledOrders.length;
    const buyTrades = filledOrders.filter(order => order.side === 'buy');
    const sellTrades = filledOrders.filter(order => order.side === 'sell');
    
    // Calculate realized P&L from completed round trips
    const { realizedPnL, completedTrades, winningTrades, losingTrades } = calculateRealizedPnL(filledOrders);
    
    // Get account starting value (assume starting capital of 100k if not available)
    const startingCapital = 100000; // This should be configurable or retrieved from account history
    const currentEquity = parseFloat(account.equity);
    const totalReturn = ((currentEquity - startingCapital) / startingCapital) * 100;
    
    // Calculate current unrealized P&L
    const unrealizedPnL = positions.reduce((sum, pos) => sum + parseFloat(pos.unrealized_pl), 0);
    
    // Total P&L (realized + unrealized)
    const totalPnL = realizedPnL + unrealizedPnL;
    
    // Calculate win rate
    const winRate = completedTrades > 0 ? (winningTrades / completedTrades) * 100 : 0;
    
    // Calculate maximum drawdown (simplified version)
    let maxDrawdown = 0;
    let peak = startingCapital;
    
    // For a more accurate calculation, you'd want to track daily equity values
    if (currentEquity > peak) peak = currentEquity;
    const drawdown = ((peak - currentEquity) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    
    // Calculate Sharpe ratio (simplified - you'd want daily returns for accuracy)
    let sharpeRatio = 0;
    if (totalReturn > 0 && completedTrades > 10) {
      // Simplified calculation - in practice, use daily returns and risk-free rate
      const avgReturn = totalReturn / 12; // Assume 12 months of trading
      const returnStdDev = Math.sqrt(Math.abs(totalReturn)) * 2; // Simplified volatility
      const riskFreeRate = 2; // 2% annual risk-free rate
      sharpeRatio = (avgReturn - riskFreeRate) / returnStdDev;
    }
    
    // Calculate additional metrics
    const averageWin = winningTrades > 0 ? 
      filledOrders.filter(o => o.realized_pnl && o.realized_pnl > 0)
        .reduce((sum, o) => sum + o.realized_pnl, 0) / winningTrades : 0;
    
    const averageLoss = losingTrades > 0 ? 
      Math.abs(filledOrders.filter(o => o.realized_pnl && o.realized_pnl < 0)
        .reduce((sum, o) => sum + o.realized_pnl, 0)) / losingTrades : 0;
    
    const profitFactor = averageLoss > 0 ? averageWin / averageLoss : 0;
    
    // Calculate trading frequency
    if (filledOrders.length > 0) {
      const firstTrade = new Date(filledOrders[filledOrders.length - 1].submitted_at);
      const lastTrade = new Date(filledOrders[0].submitted_at);
      const daysDifference = Math.max(1, (lastTrade - firstTrade) / (1000 * 60 * 60 * 24));
      var tradesPerDay = totalTrades / daysDifference;
    } else {
      var tradesPerDay = 0;
    }

    return {
      // Basic metrics (existing)
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      
      // ENHANCED METRICS (new requirements)
      allTimeTradesWon: winningTrades,
      allTimeTradesLost: losingTrades,
      allTimePnL: totalPnL, // Total P&L in $ amount
      
      // Additional comprehensive metrics
      totalTrades,
      completedTrades, // Round-trip trades (buy + sell)
      buyTrades: buyTrades.length,
      sellTrades: sellTrades.length,
      realizedPnL,
      unrealizedPnL,
      averageWin,
      averageLoss,
      profitFactor,
      tradesPerDay,
      
      // Portfolio metrics
      currentEquity,
      startingCapital,
      netReturn: currentEquity - startingCapital,
      
      // Risk metrics
      largestWin: Math.max(...filledOrders.map(o => o.realized_pnl || 0)),
      largestLoss: Math.min(...filledOrders.map(o => o.realized_pnl || 0)),
      
      // Trading activity metrics
      totalVolume: filledOrders.reduce((sum, order) => 
        sum + (parseFloat(order.filled_qty) * parseFloat(order.filled_avg_price || 0)), 0),
      averageTradeSize: filledOrders.length > 0 ? 
        filledOrders.reduce((sum, order) => 
          sum + (parseFloat(order.filled_qty) * parseFloat(order.filled_avg_price || 0)), 0) / filledOrders.length : 0,
      
      // Time-based metrics
      firstTradeDate: filledOrders.length > 0 ? filledOrders[filledOrders.length - 1].submitted_at : null,
      lastTradeDate: filledOrders.length > 0 ? filledOrders[0].submitted_at : null,
      tradingDays: tradesPerDay > 0 ? Math.round(totalTrades / tradesPerDay) : 0
    };
    
  } catch (error) {
    console.error('Error calculating enhanced performance metrics:', error);
    // Return basic metrics if calculation fails
    return {
      totalReturn: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      allTimeTradesWon: 0,
      allTimeTradesLost: 0,
      allTimePnL: 0,
      totalTrades: 0,
      error: error.message
    };
  }
}

/**
 * Calculate realized P&L from completed round trips
 */
function calculateRealizedPnL(filledOrders) {
  let realizedPnL = 0;
  let completedTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  
  // Group orders by symbol
  const symbolTrades = {};
  filledOrders.forEach(order => {
    if (!symbolTrades[order.symbol]) {
      symbolTrades[order.symbol] = [];
    }
    symbolTrades[order.symbol].push({
      ...order,
      timestamp: new Date(order.filled_at || order.submitted_at),
      qty: parseFloat(order.filled_qty),
      price: parseFloat(order.filled_avg_price || 0)
    });
  });
  
  // Calculate P&L for each symbol
  Object.keys(symbolTrades).forEach(symbol => {
    const trades = symbolTrades[symbol].sort((a, b) => a.timestamp - b.timestamp);
    
    let position = 0;
    let avgCost = 0;
    
    trades.forEach(trade => {
      if (trade.side === 'buy') {
        // Calculate new average cost
        const totalCost = position * avgCost + trade.qty * trade.price;
        position += trade.qty;
        avgCost = position > 0 ? totalCost / position : 0;
      } else if (trade.side === 'sell' && position > 0) {
        // Calculate P&L for this sale
        const sellQty = Math.min(trade.qty, position);
        const pnl = sellQty * (trade.price - avgCost);
        realizedPnL += pnl;
        completedTrades++;
        
        if (pnl > 0) {
          winningTrades++;
        } else if (pnl < 0) {
          losingTrades++;
        }
        
        position -= sellQty;
      }
    });
  });
  
  return { realizedPnL, completedTrades, winningTrades, losingTrades };
}