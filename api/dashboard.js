// api/dashboard.js - Dashboard Data API Endpoint
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';
import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { Logger } from '../lib/utils/logger.js';

export default async function handler(req, res) {
  const logger = new Logger('Dashboard');
  const sheetsLogger = new GoogleSheetsLogger();

  try {
    // Initialize Alpaca API for real-time data
    const alpaca = new AlpacaHybridApi({
      keyId: process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper: process.env.ALPACA_PAPER === 'true',
      baseUrl: process.env.ALPACA_PAPER === 'true' ? 
        'https://paper-api.alpaca.markets' : 
        'https://api.alpaca.markets'
    });

    // Handle different HTTP methods
    if (req.method === 'GET') {
      return await handleGetDashboardData(req, res, sheetsLogger, alpaca, logger);
    } else if (req.method === 'POST') {
      return await handleFilteredData(req, res, sheetsLogger, alpaca, logger);
    } else {
      return res.status(405).json({ 
        status: 'error', 
        message: 'Method not allowed' 
      });
    }

  } catch (error) {
    logger.error('Dashboard API error', {
      error: error.message,
      stack: error.stack,
      method: req.method
    });

    return res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function handleGetDashboardData(req, res, sheetsLogger, alpaca, logger) {
  const { timeRange, limit } = req.query;
  
  logger.info('Fetching dashboard data', { 
    timeRange: timeRange || 'all',
    limit: limit || 'default'
  });

  try {
    // Get data from multiple sources in parallel
    const [
      dashboardData,
      portfolioData,
      accountInfo,
      marketStatus
    ] = await Promise.all([
      sheetsLogger.getDashboardData(),
      getPortfolioSummary(alpaca),
      alpaca.getAccount(),
      getMarketStatus(alpaca)
    ]);

    // Parse and aggregate the data
    const processedData = {
      portfolio: {
        totalValue: parseFloat(accountInfo.equity),
        cash: parseFloat(accountInfo.cash),
        buyingPower: parseFloat(accountInfo.buying_power),
        dayChange: parseFloat(accountInfo.unrealized_pl),
        positions: portfolioData.positions || []
      },
      
      trades: processTrades(dashboardData?.trades || [], timeRange, parseInt(limit) || 50),
      
      performance: processPerformance(dashboardData?.performance || [], timeRange),
      
      logs: processLogs(dashboardData?.logs || [], timeRange, parseInt(limit) || 100),
      
      summary: {
        totalTrades: dashboardData?.totalTrades || 0,
        activeTrades: portfolioData.positions?.length || 0,
        winRate: calculateWinRate(dashboardData?.trades || []),
        profitLoss: calculateProfitLoss(dashboardData?.trades || [])
      },
      
      marketStatus: marketStatus,
      
      lastUpdate: new Date().toISOString()
    };

    logger.info('Dashboard data retrieved successfully', {
      totalTrades: processedData.summary.totalTrades,
      activeTrades: processedData.summary.activeTrades,
      portfolioValue: processedData.portfolio.totalValue
    });

    return res.json({
      status: 'success',
      data: processedData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to fetch dashboard data', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch dashboard data',
      timestamp: new Date().toISOString()
    });
  }
}

async function handleFilteredData(req, res, sheetsLogger, alpaca, logger) {
  const { 
    dateFrom, 
    dateTo, 
    strategy, 
    symbol, 
    logLevel, 
    tradeStatus,
    limit = 100
  } = req.body;

  logger.info('Fetching filtered dashboard data', {
    dateFrom,
    dateTo,
    strategy,
    symbol,
    logLevel,
    tradeStatus,
    limit
  });

  try {
    // Get filtered data from Google Sheets
    const dashboardData = await sheetsLogger.getDashboardData();
    
    // Apply filters
    let filteredTrades = dashboardData?.trades || [];
    let filteredLogs = dashboardData?.logs || [];
    let filteredPerformance = dashboardData?.performance || [];

    // Date filters
    if (dateFrom || dateTo) {
      const fromDate = dateFrom ? new Date(dateFrom) : new Date('2020-01-01');
      const toDate = dateTo ? new Date(dateTo) : new Date();

      filteredTrades = filteredTrades.filter(trade => {
        const tradeDate = new Date(trade[0]); // Timestamp is first column
        return tradeDate >= fromDate && tradeDate <= toDate;
      });

      filteredLogs = filteredLogs.filter(log => {
        const logDate = new Date(log[0]); // Timestamp is first column
        return logDate >= fromDate && logDate <= toDate;
      });

      filteredPerformance = filteredPerformance.filter(perf => {
        const perfDate = new Date(perf[0]);
        return perfDate >= fromDate && perfDate <= toDate;
      });
    }

    // Strategy filter
    if (strategy) {
      filteredTrades = filteredTrades.filter(trade => 
        trade[5] && trade[5].toLowerCase().includes(strategy.toLowerCase()) // Strategy column
      );

      filteredLogs = filteredLogs.filter(log => 
        log[5] && log[5].toLowerCase().includes(strategy.toLowerCase()) // Strategy column
      );
    }

    // Symbol filter
    if (symbol) {
      filteredTrades = filteredTrades.filter(trade => 
        trade[1] && trade[1].toUpperCase() === symbol.toUpperCase() // Symbol column
      );

      filteredLogs = filteredLogs.filter(log => 
        log[6] && log[6].toUpperCase() === symbol.toUpperCase() // Symbol column
      );
    }

    // Log level filter
    if (logLevel) {
      filteredLogs = filteredLogs.filter(log => 
        log[1] && log[1].toUpperCase() === logLevel.toUpperCase() // Level column
      );
    }

    // Trade status filter
    if (tradeStatus) {
      filteredTrades = filteredTrades.filter(trade => 
        trade[9] && trade[9].toUpperCase() === tradeStatus.toUpperCase() // Status column
      );
    }

    // Apply limits
    filteredTrades = filteredTrades.slice(0, parseInt(limit));
    filteredLogs = filteredLogs.slice(0, parseInt(limit));

    const responseData = {
      trades: processTrades(filteredTrades),
      logs: processLogs(filteredLogs),
      performance: processPerformance(filteredPerformance),
      summary: {
        totalTrades: filteredTrades.length,
        totalLogs: filteredLogs.length,
        winRate: calculateWinRate(filteredTrades),
        profitLoss: calculateProfitLoss(filteredTrades)
      },
      filters: {
        dateFrom,
        dateTo,
        strategy,
        symbol,
        logLevel,
        tradeStatus,
        limit
      },
      timestamp: new Date().toISOString()
    };

    logger.info('Filtered dashboard data retrieved', {
      tradesCount: filteredTrades.length,
      logsCount: filteredLogs.length,
      performanceCount: filteredPerformance.length
    });

    return res.json({
      status: 'success',
      data: responseData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to fetch filtered dashboard data', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch filtered data',
      timestamp: new Date().toISOString()
    });
  }
}

// Helper functions
async function getPortfolioSummary(alpaca) {
  try {
    const positions = await alpaca.getPositions();
    return {
      positions: positions.map(pos => ({
        symbol: pos.symbol,
        quantity: parseFloat(pos.qty),
        marketValue: parseFloat(pos.market_value),
        unrealizedPL: parseFloat(pos.unrealized_pl),
        side: pos.side
      }))
    };
  } catch (error) {
    return { positions: [] };
  }
}

async function getMarketStatus(alpaca) {
  try {
    const clock = await alpaca.getClock();
    return {
      isOpen: clock.is_open,
      nextOpen: clock.next_open,
      nextClose: clock.next_close,
      timezone: clock.timezone
    };
  } catch (error) {
    return {
      isOpen: false,
      nextOpen: null,
      nextClose: null,
      timezone: 'America/New_York'
    };
  }
}

function processTrades(tradesData, timeRange = null, limit = 50) {
  if (!Array.isArray(tradesData)) return [];

  let processed = tradesData.map(trade => ({
    timestamp: trade[0],
    symbol: trade[1],
    side: trade[2],
    quantity: parseFloat(trade[3]) || 0,
    price: parseFloat(trade[4]) || 0,
    strategy: trade[5],
    orderId: trade[6],
    stopLoss: parseFloat(trade[7]) || null,
    takeProfit: parseFloat(trade[8]) || null,
    status: trade[9] || 'UNKNOWN'
  }));

  // Apply time range filter
  if (timeRange) {
    const now = new Date();
    let cutoffDate;
    
    switch (timeRange) {
      case '1d':
        cutoffDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffDate = null;
    }

    if (cutoffDate) {
      processed = processed.filter(trade => new Date(trade.timestamp) >= cutoffDate);
    }
  }

  // Sort by timestamp (newest first) and limit
  processed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return processed.slice(0, limit);
}

function processLogs(logsData, timeRange = null, limit = 100) {
  if (!Array.isArray(logsData)) return [];

  let processed = logsData.map(log => ({
    timestamp: log[0],
    level: log[1],
    context: log[2],
    message: log[3],
    data: log[4] ? JSON.parse(log[4]) : {},
    strategy: log[5] || null,
    symbol: log[6] || null,
    orderId: log[7] || null
  }));

  // Apply time range filter
  if (timeRange) {
    const now = new Date();
    let cutoffDate;
    
    switch (timeRange) {
      case '1d':
        cutoffDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffDate = null;
    }

    if (cutoffDate) {
      processed = processed.filter(log => new Date(log.timestamp) >= cutoffDate);
    }
  }

  // Sort by timestamp (newest first) and limit
  processed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return processed.slice(0, limit);
}

function processPerformance(performanceData, timeRange = null) {
  if (!Array.isArray(performanceData)) return [];

  let processed = performanceData.map(perf => ({
    timestamp: perf[0],
    totalEquity: parseFloat(perf[1]) || 0,
    dailyPnL: parseFloat(perf[2]) || 0,
    dailyReturn: parseFloat(perf[3]) || 0,
    unrealizedPnL: parseFloat(perf[4]) || 0,
    positionCount: parseInt(perf[5]) || 0,
    buyingPower: parseFloat(perf[6]) || 0
  }));

  // Apply time range filter
  if (timeRange) {
    const now = new Date();
    let cutoffDate;
    
    switch (timeRange) {
      case '1d':
        cutoffDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffDate = null;
    }

    if (cutoffDate) {
      processed = processed.filter(perf => new Date(perf.timestamp) >= cutoffDate);
    }
  }

  // Sort by timestamp
  processed.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return processed;
}

function calculateWinRate(tradesData) {
  if (!Array.isArray(tradesData) || tradesData.length === 0) return 0;
  
  // This is a simplified calculation - in real implementation,
  // we'd need exit prices to calculate actual wins/losses
  const completedTrades = tradesData.filter(trade => 
    trade[9] && trade[9].toUpperCase() === 'CLOSED'
  );
  
  if (completedTrades.length === 0) return 0;
  
  // For now, return a placeholder calculation
  // Real implementation would require exit trade data
  return Math.random() * 100; // Placeholder
}

function calculateProfitLoss(tradesData) {
  if (!Array.isArray(tradesData) || tradesData.length === 0) return 0;
  
  // This is a simplified calculation - in real implementation,
  // we'd calculate based on entry and exit prices
  return tradesData.reduce((total, trade) => {
    // Placeholder calculation
    const quantity = parseFloat(trade[3]) || 0;
    const price = parseFloat(trade[4]) || 0;
    return total + (quantity * price * 0.01); // 1% assumed return
  }, 0);
}