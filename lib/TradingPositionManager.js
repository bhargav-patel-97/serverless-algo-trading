/**
 * TradingPositionManager - Comprehensive position management and duplicate trade prevention
 * for serverless algorithmic trading systems
 */

class TradingPositionManager {
  constructor(alpacaClient, options = {}) {
    this.alpaca = alpacaClient;
    this.activeOrders = new Map(); // Track pending orders
    this.lastTradeTime = new Map(); // Prevent rapid duplicate trades
    this.positionCache = new Map(); // Cache current positions
    
    // Configurable options
    this.minTimeBetweenTrades = options.minTimeBetweenTrades || 60000; // 1 minute default
    this.maxPositionSizePercent = options.maxPositionSizePercent || 0.10; // 10% of equity
    this.enableLogging = options.enableLogging !== false; // Default true
    this.logger = options.logger || console;
  }

  /**
   * Retrieve and cache current positions from Alpaca
   * @returns {Map} Map of symbol -> position data
   */
  async getCurrentPositions() {
    try {
      const positions = await this.alpaca.getPositions();
      
      // Update position cache
      this.positionCache.clear();
      positions.forEach(position => {
        this.positionCache.set(position.symbol, {
          qty: parseInt(position.qty),
          side: position.side,
          market_value: parseFloat(position.market_value),
          cost_basis: parseFloat(position.cost_basis),
          unrealized_pl: parseFloat(position.unrealized_pl),
          avg_entry_price: parseFloat(position.avg_entry_price)
        });
      });
      
      if (this.enableLogging) {
        this.logger.info('Position cache updated', {
          totalPositions: this.positionCache.size,
          symbols: Array.from(this.positionCache.keys())
        });
      }
      
      return this.positionCache;
    } catch (error) {
      this.logger.error('Error fetching positions:', error);
      return new Map();
    }
  }

  /**
   * Check if we already have exposure to a symbol
   * @param {string} symbol - Trading symbol
   * @param {string} targetSide - 'buy' or 'sell'
   * @param {number} targetQuantity - Number of shares
   * @returns {Object} Exposure check result
   */
  async checkExistingExposure(symbol, targetSide, targetQuantity) {
    await this.getCurrentPositions();
    const currentPosition = this.positionCache.get(symbol);
    
    if (!currentPosition) {
      return { hasExposure: false, action: 'proceed' };
    }

    const currentQty = Math.abs(currentPosition.qty);
    const currentSide = currentPosition.side;
    
    // Special handling for leveraged ETFs
    if (this.isLeveragedETF(symbol)) {
      if (currentSide === targetSide) {
        return {
          hasExposure: true,
          action: 'skip',
          reason: `Already have leveraged ETF position: ${currentSide} ${currentQty} shares in ${symbol}`,
          currentPosition,
          riskLevel: 'high'
        };
      }
    }
    
    // Check for same direction exposure
    if (currentSide === targetSide) {
      return {
        hasExposure: true,
        action: 'skip',
        reason: `Already have ${currentSide} position of ${currentQty} shares in ${symbol}`,
        currentPosition,
        riskLevel: 'medium'
      };
    }
    
    // Check for opposite direction (potential hedge)
    if (currentSide !== targetSide) {
      return {
        hasExposure: true,
        action: 'evaluate',
        reason: `Have opposite position: ${currentSide} ${currentQty} vs target ${targetSide} ${targetQuantity}`,
        currentPosition,
        riskLevel: 'low'
      };
    }
    
    return { hasExposure: false, action: 'proceed' };
  }

  /**
   * Check for pending orders that might conflict
   * @param {string} symbol - Trading symbol
   * @returns {Object} Pending order check result
   */
  async checkPendingOrders(symbol) {
    try {
      const openOrders = await this.alpaca.getOrders({
        status: 'open',
        symbols: [symbol],
        limit: 100
      });
      
      const pendingOrders = openOrders.filter(order => 
        ['pending_new', 'accepted', 'partially_filled', 'new'].includes(order.status)
      );
      
      if (pendingOrders.length > 0) {
        const orderDetails = pendingOrders.map(order => ({
          id: order.id,
          side: order.side,
          qty: order.qty,
          status: order.status,
          submitted_at: order.submitted_at
        }));
        
        return {
          hasPendingOrders: true,
          orders: orderDetails,
          count: pendingOrders.length,
          reason: `${pendingOrders.length} pending orders for ${symbol}`
        };
      }
      
      return { hasPendingOrders: false };
    } catch (error) {
      this.logger.error('Error checking pending orders:', error);
      return { hasPendingOrders: false };
    }
  }

  /**
   * Check if sufficient time has passed since last trade
   * @param {string} symbol - Trading symbol
   * @returns {Object} Time check result
   */
  checkRecentTradeTime(symbol) {
    const lastTrade = this.lastTradeTime.get(symbol);
    const now = Date.now();
    
    if (lastTrade && (now - lastTrade) < this.minTimeBetweenTrades) {
      const timeSinceLastTrade = now - lastTrade;
      const timeRemaining = Math.ceil((this.minTimeBetweenTrades - timeSinceLastTrade) / 1000);
      
      return {
        tooRecent: true,
        timeRemaining: timeRemaining,
        timeSinceLastTrade: Math.ceil(timeSinceLastTrade / 1000),
        reason: `Last trade for ${symbol} was ${Math.ceil(timeSinceLastTrade / 1000)} seconds ago. Wait ${timeRemaining} more seconds.`
      };
    }
    
    return { tooRecent: false };
  }

  /**
   * Validate position size against risk management rules
   * @param {string} symbol - Trading symbol
   * @param {string} targetSide - 'buy' or 'sell'
   * @param {number} targetQuantity - Number of shares
   * @param {number} currentPrice - Current market price
   * @returns {Object} Risk check result
   */
  async checkRiskLimits(symbol, targetSide, targetQuantity, currentPrice) {
    try {
      const account = await this.alpaca.getAccount();
      const equity = parseFloat(account.equity);
      const buyingPower = parseFloat(account.buying_power);
      
      const positionValue = targetQuantity * currentPrice;
      const maxPositionSize = equity * this.maxPositionSizePercent;
      
      // Check position size limit
      if (positionValue > maxPositionSize) {
        return {
          withinLimits: false,
          reason: `Position size $${positionValue.toFixed(2)} exceeds max allowed $${maxPositionSize.toFixed(2)} (${(this.maxPositionSizePercent * 100)}% of equity)`,
          positionValue: positionValue,
          maxAllowed: maxPositionSize,
          equity: equity
        };
      }
      
      // Check buying power for buy orders
      if (targetSide === 'buy' && positionValue > buyingPower) {
        return {
          withinLimits: false,
          reason: `Insufficient buying power: need $${positionValue.toFixed(2)}, have $${buyingPower.toFixed(2)}`,
          required: positionValue,
          available: buyingPower
        };
      }
      
      // Additional risk checks for leveraged ETFs
      if (this.isLeveragedETF(symbol)) {
        const leveragedMaxSize = equity * 0.05; // More conservative for leveraged ETFs
        if (positionValue > leveragedMaxSize) {
          return {
            withinLimits: false,
            reason: `Leveraged ETF position size $${positionValue.toFixed(2)} exceeds conservative limit $${leveragedMaxSize.toFixed(2)} (5% of equity)`,
            positionValue: positionValue,
            maxAllowed: leveragedMaxSize,
            leveraged: true
          };
        }
      }
      
      return { 
        withinLimits: true,
        positionValue: positionValue,
        maxAllowed: maxPositionSize,
        buyingPower: buyingPower
      };
    } catch (error) {
      this.logger.error('Error checking risk limits:', error);
      return { withinLimits: true }; // Default to allow if we can't check
    }
  }

  /**
   * Main validation function - runs all checks before trade execution
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Number of shares
   * @param {number} currentPrice - Current market price
   * @returns {Object} Complete validation result
   */
  async validateTradeBeforeExecution(symbol, side, quantity, currentPrice) {
    if (this.enableLogging) {
      this.logger.info('Validating trade before execution', {
        symbol,
        side,
        quantity,
        price: currentPrice,
        timestamp: new Date().toISOString()
      });
    }
    
    const validationResults = {
      canTrade: false,
      checks: {
        exposure: null,
        pendingOrders: null,
        recentTrade: null,
        riskLimits: null
      },
      skipReasons: [],
      timestamp: new Date().toISOString()
    };
    
    try {
      // 1. Check existing exposure
      const exposureCheck = await this.checkExistingExposure(symbol, side, quantity);
      validationResults.checks.exposure = exposureCheck;
      
      if (exposureCheck.action === 'skip') {
        validationResults.skipReasons.push(exposureCheck.reason);
        if (this.enableLogging) {
          this.logger.warn('Trade blocked by position exposure check', {
            symbol,
            reason: exposureCheck.reason,
            currentPosition: exposureCheck.currentPosition
          });
        }
        return validationResults;
      }
      
      // 2. Check pending orders
      const pendingCheck = await this.checkPendingOrders(symbol);
      validationResults.checks.pendingOrders = pendingCheck;
      
      if (pendingCheck.hasPendingOrders) {
        validationResults.skipReasons.push(pendingCheck.reason);
        if (this.enableLogging) {
          this.logger.warn('Trade blocked by pending orders', {
            symbol,
            pendingOrders: pendingCheck.orders
          });
        }
        return validationResults;
      }
      
      // 3. Check recent trade timing
      const timeCheck = this.checkRecentTradeTime(symbol);
      validationResults.checks.recentTrade = timeCheck;
      
      if (timeCheck.tooRecent) {
        validationResults.skipReasons.push(timeCheck.reason);
        if (this.enableLogging) {
          this.logger.warn('Trade blocked by time cooldown', {
            symbol,
            timeRemaining: timeCheck.timeRemaining,
            timeSinceLastTrade: timeCheck.timeSinceLastTrade
          });
        }
        return validationResults;
      }
      
      // 4. Check risk limits
      const riskCheck = await this.checkRiskLimits(symbol, side, quantity, currentPrice);
      validationResults.checks.riskLimits = riskCheck;
      
      if (!riskCheck.withinLimits) {
        validationResults.skipReasons.push(riskCheck.reason);
        if (this.enableLogging) {
          this.logger.warn('Trade blocked by risk limits', {
            symbol,
            reason: riskCheck.reason,
            positionValue: riskCheck.positionValue,
            maxAllowed: riskCheck.maxAllowed
          });
        }
        return validationResults;
      }
      
      // All checks passed
      validationResults.canTrade = true;
      if (this.enableLogging) {
        this.logger.info('All trade validation checks passed', {
          symbol,
          side,
          quantity,
          price: currentPrice
        });
      }
      
      return validationResults;
      
    } catch (error) {
      this.logger.error('Error during trade validation:', error);
      validationResults.skipReasons.push(`Validation error: ${error.message}`);
      return validationResults;
    }
  }

  /**
   * Execute trade with full validation
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Number of shares
   * @param {number} currentPrice - Current market price
   * @param {string} strategy - Strategy name for logging
   * @returns {Object} Trade execution result
   */
  async executeTradeWithValidation(symbol, side, quantity, currentPrice, strategy) {
    try {
      // Validate before executing
      const validation = await this.validateTradeBeforeExecution(symbol, side, quantity, currentPrice);
      
      if (!validation.canTrade) {
        if (this.enableLogging) {
          this.logger.warn('Trade execution blocked by validation', {
            symbol,
            side,
            quantity,
            strategy,
            reasons: validation.skipReasons,
            validation: validation.checks
          });
        }
        
        return {
          success: false,
          skipped: true,
          reasons: validation.skipReasons,
          validation: validation,
          timestamp: new Date().toISOString()
        };
      }
      
      // Execute the trade
      if (this.enableLogging) {
        this.logger.info('Submitting order to Alpaca', {
          symbol,
          qty: quantity,
          side,
          type: 'market',
          time_in_force: 'day',
          strategy
        });
      }
      
      const order = await this.alpaca.createOrder({
        symbol: symbol,
        qty: quantity,
        side: side,
        type: 'market',
        time_in_force: 'day'
      });
      
      // Record the trade time to prevent duplicates
      this.lastTradeTime.set(symbol, Date.now());
      
      if (this.enableLogging) {
        this.logger.info('Trade executed successfully', {
          orderId: order.id,
          symbol,
          side,
          quantity,
          status: order.status,
          strategy,
          timestamp: new Date().toISOString()
        });
      }
      
      return {
        success: true,
        skipped: false,
        order: order,
        validation: validation,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Trade execution failed', {
        symbol,
        side,
        quantity,
        strategy,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        skipped: false,
        error: error,
        validation: validation,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get comprehensive position summary for logging
   * @returns {Object} Position summary
   */
  async getPositionSummary() {
    await this.getCurrentPositions();
    
    const summary = {
      totalPositions: this.positionCache.size,
      positions: {},
      totalValue: 0,
      totalUnrealizedPL: 0,
      timestamp: new Date().toISOString()
    };
    
    this.positionCache.forEach((position, symbol) => {
      summary.positions[symbol] = {
        side: position.side,
        quantity: Math.abs(position.qty),
        marketValue: position.market_value,
        unrealizedPL: position.unrealized_pl,
        avgEntryPrice: position.avg_entry_price,
        costBasis: position.cost_basis
      };
      summary.totalValue += position.market_value;
      summary.totalUnrealizedPL += position.unrealized_pl;
    });
    
    return summary;
  }

  /**
   * Check if symbol is a leveraged ETF
   * @param {string} symbol - Trading symbol
   * @returns {boolean} True if leveraged ETF
   */
  isLeveragedETF(symbol) {
    const leveragedETFs = [
      'SQQQ', 'TQQQ', 'SPXU', 'UPRO', 'SPXS', 'SPXL',
      'QQQ', 'QLD', 'QID', 'TNA', 'TZA', 'FAS', 'FAZ',
      'DUST', 'NUGT', 'JDST', 'JNUG', 'DRIP', 'GUSH'
    ];
    return leveragedETFs.includes(symbol.toUpperCase());
  }

  /**
   * Reset cooldown for a symbol (for testing/emergency use)
   * @param {string} symbol - Trading symbol
   */
  resetCooldown(symbol) {
    this.lastTradeTime.delete(symbol);
    if (this.enableLogging) {
      this.logger.info('Trade cooldown reset', { symbol });
    }
  }

  /**
   * Get current cooldown status for all symbols
   * @returns {Object} Cooldown status
   */
  getCooldownStatus() {
    const now = Date.now();
    const status = {};
    
    this.lastTradeTime.forEach((lastTrade, symbol) => {
      const timeSince = now - lastTrade;
      const timeRemaining = Math.max(0, this.minTimeBetweenTrades - timeSince);
      
      status[symbol] = {
        lastTradeTime: new Date(lastTrade).toISOString(),
        timeSinceLastTrade: Math.floor(timeSince / 1000),
        timeRemainingSeconds: Math.ceil(timeRemaining / 1000),
        canTrade: timeRemaining === 0
      };
    });
    
    return status;
  }
}

module.exports = TradingPositionManager;