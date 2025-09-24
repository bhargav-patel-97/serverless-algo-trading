// api/manual-trade.js - Manual Trading API Endpoint
import { AlpacaHybridApi } from '../lib/brokers/alpacaHybrid.js';
import { RiskManager } from '../lib/utils/riskManager.js';
import { Logger } from '../lib/utils/logger.js';
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';

export default async function handler(req, res) {
  const logger = new Logger();
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const { 
      symbol, 
      side, 
      quantity, 
      orderType = 'market', 
      limitPrice = null 
    } = req.body;

    // Validate required fields
    if (!symbol || !side || !quantity) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: symbol, side, quantity',
        timestamp: new Date().toISOString()
      });
    }

    if (!['buy', 'sell'].includes(side.toLowerCase())) {
      return res.status(400).json({
        status: 'error',
        message: 'Side must be either "buy" or "sell"',
        timestamp: new Date().toISOString()
      });
    }

    if (!['market', 'limit'].includes(orderType.toLowerCase())) {
      return res.status(400).json({
        status: 'error',
        message: 'Order type must be either "market" or "limit"',
        timestamp: new Date().toISOString()
      });
    }

    if (orderType.toLowerCase() === 'limit' && !limitPrice) {
      return res.status(400).json({
        status: 'error',
        message: 'Limit price required for limit orders',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Manual trade request received', {
      symbol,
      side: side.toLowerCase(),
      quantity: parseInt(quantity),
      orderType: orderType.toLowerCase(),
      limitPrice
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

    // Initialize risk manager
    const riskManager = new RiskManager({
      maxPositionSize: 0.10, // 10% max per position for manual trades
      maxDailyLoss: 0.05, // 5% max daily loss
      maxDrawdown: 0.15, // 15% max drawdown
      stopLossPercent: 0.05, // 5% stop loss for manual trades
      takeProfitPercent: 0.10 // 10% take profit for manual trades
    });

    // Get account information
    const account = await alpaca.getAccount();
    const currentEquity = parseFloat(account.equity);
    
    // Get current positions
    const positions = await alpaca.getPositions();
    
    // Check if market is open for manual trading
    const isMarketOpen = await alpaca.isMarketOpen();
    if (!isMarketOpen) {
      logger.warning('Manual trade attempted while market is closed', {
        symbol,
        side,
        quantity
      });
      
      return res.status(400).json({
        status: 'error',
        message: 'Cannot place manual trades while market is closed',
        timestamp: new Date().toISOString(),
        marketStatus: 'CLOSED'
      });
    }

    // Get current quote for risk calculations
    const quote = await alpaca.getQuote(symbol);
    const currentPrice = (quote.bid + quote.ask) / 2;

    // Calculate trade value
    const tradeValue = parseInt(quantity) * currentPrice;
    const positionSizePercent = (tradeValue / currentEquity) * 100;

    // Risk management checks
    const riskChecks = {
      dailyLossLimit: await riskManager.isDailyLossLimitExceeded(account, positions),
      positionSizeLimit: positionSizePercent > (riskManager.maxPositionSize * 100),
      availableCash: parseFloat(account.cash) < tradeValue && side.toLowerCase() === 'buy'
    };

    if (riskChecks.dailyLossLimit) {
      return res.status(400).json({
        status: 'error',
        message: 'Daily loss limit exceeded - manual trading disabled',
        timestamp: new Date().toISOString(),
        riskReason: 'DAILY_LOSS_LIMIT'
      });
    }

    if (riskChecks.positionSizeLimit) {
      return res.status(400).json({
        status: 'error',
        message: `Position size (${positionSizePercent.toFixed(1)}%) exceeds maximum allowed (${(riskManager.maxPositionSize * 100).toFixed(1)}%)`,
        timestamp: new Date().toISOString(),
        riskReason: 'POSITION_SIZE_LIMIT',
        details: {
          requestedSize: positionSizePercent,
          maxAllowed: riskManager.maxPositionSize * 100,
          tradeValue: tradeValue
        }
      });
    }

    if (riskChecks.availableCash) {
      return res.status(400).json({
        status: 'error',
        message: `Insufficient cash for trade. Available: $${parseFloat(account.cash).toLocaleString()}, Required: $${tradeValue.toLocaleString()}`,
        timestamp: new Date().toISOString(),
        riskReason: 'INSUFFICIENT_CASH',
        details: {
          availableCash: parseFloat(account.cash),
          requiredCash: tradeValue
        }
      });
    }

    // Prepare order data
    const orderData = {
      symbol: symbol.toUpperCase(),
      qty: parseInt(quantity),
      side: side.toLowerCase(),
      type: orderType.toLowerCase(),
      time_in_force: 'day'
    };

    if (orderType.toLowerCase() === 'limit') {
      orderData.limit_price = parseFloat(limitPrice);
    }

    // Execute the trade
    const order = await alpaca.submitOrder(orderData);

    // Create trade result
    const tradeResult = {
      orderId: order.id,
      symbol: symbol.toUpperCase(),
      side: side.toLowerCase(),
      quantity: parseInt(quantity),
      orderType: orderType.toLowerCase(),
      limitPrice: orderType.toLowerCase() === 'limit' ? parseFloat(limitPrice) : null,
      currentPrice: currentPrice,
      estimatedValue: tradeValue,
      positionSizePercent: positionSizePercent,
      timestamp: new Date().toISOString(),
      status: order.status,
      orderSource: 'manual_ui'
    };

    // Log to Google Sheets
    try {
      const sheetsLogger = new GoogleSheetsLogger();
      await sheetsLogger.logTrade({
        ...tradeResult,
        strategy: 'Manual Trade',
        price: currentPrice
      });
    } catch (sheetsError) {
      logger.warning('Failed to log manual trade to Google Sheets', {
        error: sheetsError.message,
        tradeId: order.id
      });
    }

    logger.success('Manual trade executed successfully', tradeResult);

    return res.json({
      status: 'success',
      message: `Manual ${side.toUpperCase()} order submitted successfully`,
      trade: tradeResult,
      timestamp: new Date().toISOString(),
      riskMetrics: {
        positionSizePercent: positionSizePercent,
        tradeValue: tradeValue,
        accountEquity: currentEquity,
        remainingCash: parseFloat(account.cash) - (side.toLowerCase() === 'buy' ? tradeValue : 0)
      }
    });

  } catch (error) {
    logger.error('Manual trade execution error', {
      error: error.message,
      stack: error.stack,
      requestBody: req.body
    });

    let errorMessage = error.message;
    let statusCode = 500;

    // Handle specific Alpaca API errors
    if (error.message.includes('insufficient buying power')) {
      errorMessage = 'Insufficient buying power for this trade';
      statusCode = 400;
    } else if (error.message.includes('market is closed')) {
      errorMessage = 'Market is closed - cannot execute trades';
      statusCode = 400;
    } else if (error.message.includes('invalid symbol')) {
      errorMessage = 'Invalid symbol provided';
      statusCode = 400;
    }

    return res.status(statusCode).json({
      status: 'error',
      message: errorMessage,
      timestamp: new Date().toISOString(),
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}