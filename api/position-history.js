// api/position-history.js - Position History API Endpoint
import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { Logger } from '../lib/utils/logger.js';

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

    // Get query parameters for filtering
    const {
      limit = 100,
      status = 'all', // 'all', 'filled', 'canceled', 'pending'
      symbols = null, // comma-separated symbols to filter
      start_date = null,
      end_date = null
    } = req.query;

    // Build query parameters for Alpaca API
    const queryParams = {
      limit: parseInt(limit),
      direction: 'desc' // Most recent first
    };

    if (status !== 'all') {
      queryParams.status = status;
    }

    if (start_date) {
      queryParams.after = start_date;
    }

    if (end_date) {
      queryParams.until = end_date;
    }

    // Get all orders (filled, canceled, etc.)
    const allOrders = await alpaca.alpaca.getOrders(queryParams);
    
    // Filter by symbols if specified
    let filteredOrders = allOrders;
    if (symbols) {
      const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
      filteredOrders = allOrders.filter(order => symbolList.includes(order.symbol));
    }

    // Format position history data
    const positionHistory = filteredOrders.map(order => {
      const filledAt = order.filled_at ? new Date(order.filled_at) : null;
      const submittedAt = new Date(order.submitted_at);
      
      return {
        id: order.id,
        date: filledAt ? filledAt.toDateString() : submittedAt.toDateString(),
        time: filledAt ? filledAt.toLocaleTimeString() : submittedAt.toLocaleTimeString(),
        symbol: order.symbol,
        action: order.side.toUpperCase(),
        filledQty: parseFloat(order.filled_qty || 0),
        requestedQty: parseFloat(order.qty),
        avgFillPrice: parseFloat(order.filled_avg_price || 0),
        totalAmount: parseFloat(order.filled_qty || 0) * parseFloat(order.filled_avg_price || 0),
        status: order.status,
        orderType: order.order_type,
        timeInForce: order.time_in_force,
        submittedAt: submittedAt.toISOString(),
        filledAt: filledAt ? filledAt.toISOString() : null,
        // Additional useful fields
        limitPrice: parseFloat(order.limit_price || 0),
        stopPrice: parseFloat(order.stop_price || 0),
        trailAmount: parseFloat(order.trail_amount || 0),
        commission: 0, // Alpaca doesn't charge commission
        fees: 0
      };
    });

    // Calculate summary statistics
    const filledOrders = positionHistory.filter(order => order.status === 'filled');
    const totalTrades = filledOrders.length;
    const buyTrades = filledOrders.filter(order => order.action === 'BUY');
    const sellTrades = filledOrders.filter(order => order.action === 'SELL');
    
    // Calculate profit/loss for matched trades
    let totalPnL = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    
    // Simple P&L calculation - match buy/sell pairs by symbol
    const symbolTrades = {};
    filledOrders.forEach(trade => {
      if (!symbolTrades[trade.symbol]) {
        symbolTrades[trade.symbol] = { buys: [], sells: [] };
      }
      
      if (trade.action === 'BUY') {
        symbolTrades[trade.symbol].buys.push(trade);
      } else {
        symbolTrades[trade.symbol].sells.push(trade);
      }
    });

    // Calculate P&L for each symbol
    Object.keys(symbolTrades).forEach(symbol => {
      const { buys, sells } = symbolTrades[symbol];
      
      // Sort by date
      buys.sort((a, b) => new Date(a.filledAt) - new Date(b.filledAt));
      sells.sort((a, b) => new Date(a.filledAt) - new Date(b.filledAt));
      
      let buyIndex = 0;
      let sellIndex = 0;
      let position = 0;
      let avgCost = 0;
      
      // Process all trades chronologically
      const allTrades = [...buys.map(t => ({...t, type: 'buy'})), ...sells.map(t => ({...t, type: 'sell'}))];
      allTrades.sort((a, b) => new Date(a.filledAt) - new Date(b.filledAt));
      
      allTrades.forEach(trade => {
        if (trade.type === 'buy') {
          // Calculate new average cost
          const totalCost = position * avgCost + trade.filledQty * trade.avgFillPrice;
          position += trade.filledQty;
          avgCost = position > 0 ? totalCost / position : 0;
        } else if (trade.type === 'sell' && position > 0) {
          // Calculate P&L for this sale
          const sellAmount = Math.min(trade.filledQty, position);
          const pnl = sellAmount * (trade.avgFillPrice - avgCost);
          totalPnL += pnl;
          
          if (pnl > 0) {
            winningTrades++;
          } else if (pnl < 0) {
            losingTrades++;
          }
          
          position -= sellAmount;
        }
      });
    });

    const winRate = totalTrades > 0 ? ((winningTrades / (winningTrades + losingTrades)) * 100) : 0;
    
    const summary = {
      totalOrders: positionHistory.length,
      filledOrders: filledOrders.length,
      canceledOrders: positionHistory.filter(order => order.status === 'canceled').length,
      pendingOrders: positionHistory.filter(order => ['new', 'accepted', 'pending_new'].includes(order.status)).length,
      totalBuyTrades: buyTrades.length,
      totalSellTrades: sellTrades.length,
      totalTrades: winningTrades + losingTrades, // Matched buy/sell pairs
      winningTrades,
      losingTrades,
      winRate,
      totalPnL,
      totalVolume: filledOrders.reduce((sum, order) => sum + order.totalAmount, 0),
      avgTradeSize: filledOrders.length > 0 ? filledOrders.reduce((sum, order) => sum + order.totalAmount, 0) / filledOrders.length : 0
    };

    logger.info('Position history retrieved successfully', {
      totalOrders: summary.totalOrders,
      filledOrders: summary.filledOrders,
      dateRange: {
        earliest: positionHistory.length > 0 ? positionHistory[positionHistory.length - 1].date : null,
        latest: positionHistory.length > 0 ? positionHistory[0].date : null
      }
    });

    return res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      summary,
      history: positionHistory,
      filters: {
        limit: parseInt(limit),
        status,
        symbols,
        start_date,
        end_date
      }
    });

  } catch (error) {
    logger.error('Position history API error', {
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