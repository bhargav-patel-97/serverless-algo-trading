/**
 * TradingPositionManager - Enhanced with Signal Strength Thresholds (ES Module Version)
 * Comprehensive position management and duplicate trade prevention
 * for serverless algorithmic trading systems
 */

export default class TradingPositionManager {
  constructor(alpacaClient, options = {}) {
    this.alpaca = alpacaClient;
    this.options = options;
    this.activeOrders = new Map(); // Track pending orders
    this.lastTradeTime = new Map(); // Prevent rapid duplicate trades
    this.positionCache = new Map(); // Cache current positions
    this.signalCache = new Map(); // Store last signal strength for each symbol/strategy
    this.cache = new Map(); // For cooldown storage

    // Configurable options
    this.initializeCooldownSystem(options.cooldown || {});
    this.minTimeBetweenTrades = options.minTimeBetweenTrades || 60000; // 1 minute default
    this.maxPositionSizePercent = options.maxPositionSizePercent || 0.10; // 10% of equity
    this.signalImprovementThreshold = options.signalImprovementThreshold || 0.20; // 20% improvement required
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
   * Check signal strength threshold for same-direction position scaling
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} currentStrength - Current signal strength (0-1 scale)
   * @param {string} strategy - Strategy name
   * @returns {Object} Signal threshold check result
   */
  async checkSignalThreshold(symbol, side, currentStrength, strategy) {
    const cacheKey = `${symbol}|${side}|${strategy}`;
    const previousSignal = this.signalCache.get(cacheKey);
    
    let canScale = false;
    let improvement = null;
    let relativeImprovement = null;
    let reason = null;
    
    if (typeof previousSignal === 'number') {
      improvement = currentStrength - previousSignal;
      relativeImprovement = improvement / Math.abs(previousSignal || 1);
      canScale = relativeImprovement >= this.signalImprovementThreshold;
      
      reason = canScale
        ? `Signal improved by ${(relativeImprovement * 100).toFixed(2)}% (threshold: ${(this.signalImprovementThreshold * 100)}%)`
        : `Signal improvement ${(relativeImprovement * 100).toFixed(2)}% below threshold ${(this.signalImprovementThreshold * 100)}%`;
    } else {
      canScale = true; // First signal for this combination
      reason = 'No previous signal recorded for this symbol/strategy combination';
    }
    
    // Store the current signal strength for next comparison
    this.signalCache.set(cacheKey, currentStrength);
    
    if (this.enableLogging) {
      this.logger.info('Signal strength analysis', {
        symbol,
        side,
        strategy,
        previousStrength: previousSignal,
        currentStrength,
        improvement,
        relativeImprovement: relativeImprovement ? (relativeImprovement * 100).toFixed(2) + '%' : 'N/A',
        canScale,
        reason
      });
    }
    
    return {
      canScale,
      previousSignal,
      currentStrength,
      improvement,
      relativeImprovement,
      reason,
      threshold: this.signalImprovementThreshold
    };
  }

  /**
   * Check if we already have exposure to a symbol
   * @param {string} symbol - Trading symbol
   * @param {string} targetSide - 'buy' or 'sell'
   * @param {number} targetQuantity - Number of shares
   * @param {number} signalStrength - Current signal strength
   * @param {string} strategy - Strategy name
   * @returns {Object} Exposure check result
   */
  async checkExistingExposure(symbol, targetSide, targetQuantity, signalStrength, strategy) {
    await this.getCurrentPositions();
    const currentPosition = this.positionCache.get(symbol);
    
    if (!currentPosition) {
      return { hasExposure: false, action: 'proceed', reason: 'No existing position' };
    }

    const currentQty = Math.abs(currentPosition.qty);
    const currentSide = currentPosition.side;
    
    // Check for same direction exposure - this is where we apply signal threshold logic
    if (currentSide === targetSide) {
      // If signal strength is provided, check if it's strong enough to scale
      if (signalStrength !== null && signalStrength !== undefined) {
        const signalCheck = await this.checkSignalThreshold(symbol, targetSide, signalStrength, strategy);
        
        if (signalCheck.canScale) {
          return {
            hasExposure: true,
            action: 'proceed', // Allow scaling up
            reason: `Position scaling approved: ${signalCheck.reason}`,
            currentPosition,
            signalAnalysis: signalCheck,
            scaling: true
          };
        } else {
          return {
            hasExposure: true,
            action: 'skip', // Block due to insufficient signal improvement
            reason: `Position scaling blocked: ${signalCheck.reason}`,
            currentPosition,
            signalAnalysis: signalCheck,
            scaling: false
          };
        }
      } else {
        // No signal strength provided - default to blocking same direction
        return {
          hasExposure: true,
          action: 'skip',
          reason: `Already have ${currentSide} position of ${currentQty} shares in ${symbol} (no signal strength provided)`,
          currentPosition
        };
      }
    }
    
    // Check for opposite direction (potential hedge)
    if (currentSide !== targetSide) {
      return {
        hasExposure: true,
        action: 'evaluate',
        reason: `Have opposite position: ${currentSide} ${currentQty} vs target ${targetSide} ${targetQuantity}`,
        currentPosition,
        hedge: true
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
        return {
          hasPendingOrders: true,
          orders: pendingOrders,
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
      
      // Check total position size limit (including existing position)
      const currentPosition = this.positionCache.get(symbol);
      let totalPositionValue = positionValue;
      
      if (currentPosition && currentPosition.side === targetSide) {
        totalPositionValue = Math.abs(currentPosition.market_value) + positionValue;
      }
      
      if (totalPositionValue > maxPositionSize) {
        return {
          withinLimits: false,
          reason: `Total position size $${totalPositionValue.toFixed(2)} would exceed max allowed $${maxPositionSize.toFixed(2)} (${(this.maxPositionSizePercent * 100)}% of equity)`,
          newPositionValue: positionValue,
          existingValue: currentPosition ? Math.abs(currentPosition.market_value) : 0,
          totalValue: totalPositionValue,
          maxAllowed: maxPositionSize
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
      
      return { 
        withinLimits: true,
        positionValue: positionValue,
        totalPositionValue: totalPositionValue,
        maxAllowed: maxPositionSize,
        buyingPower: buyingPower
      };
    } catch (error) {
      this.logger.error('Error checking risk limits:', error);
      return { withinLimits: true }; // Default to allow if we can't check
    }
  }

  /**
   * Main validation function with signal strength consideration
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Number of shares
   * @param {number} currentPrice - Current market price
   * @param {string} strategy - Strategy name
   * @param {number} signalStrength - Signal strength (0-1 scale)
   * @returns {Object} Complete validation result
   */
  async validateTradeBeforeExecution(symbol, side, quantity, currentPrice, strategy, signalStrength = null) {
    if (this.enableLogging) {
      this.logger.info('Validating trade with signal strength consideration', {
        symbol,
        side,
        quantity,
        price: currentPrice,
        strategy,
        signalStrength,
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
      signalAnalysis: null,
      timestamp: new Date().toISOString()
    };
    
    try {
      // 1. Check existing exposure (includes signal strength logic)
      const exposureCheck = await this.checkExistingExposure(symbol, side, quantity, signalStrength, strategy);
      validationResults.checks.exposure = exposureCheck;
      validationResults.signalAnalysis = exposureCheck.signalAnalysis;
      
      if (exposureCheck.action === 'skip') {
        validationResults.skipReasons.push(exposureCheck.reason);
        if (this.enableLogging) {
          this.logger.warn('Trade blocked by position exposure/signal strength check', {
            symbol,
            reason: exposureCheck.reason,
            signalAnalysis: exposureCheck.signalAnalysis
          });
        }
        return validationResults;
      }
      
      // 2. Check pending orders
      const pendingCheck = await this.checkPendingOrders(symbol);
      validationResults.checks.pendingOrders = pendingCheck;
      
      if (pendingCheck.hasPendingOrders) {
        validationResults.skipReasons.push(pendingCheck.reason);
        return validationResults;
      }
      
      // 3. Check recent trade timing
      const timeCheck = this.checkRecentTradeTime(symbol);
      validationResults.checks.recentTrade = timeCheck;
      
      if (timeCheck.tooRecent) {
        validationResults.skipReasons.push(timeCheck.reason);
        return validationResults;
      }
      
      // 4. Check risk limits
      const riskCheck = await this.checkRiskLimits(symbol, side, quantity, currentPrice);
      validationResults.checks.riskLimits = riskCheck;
      
      if (!riskCheck.withinLimits) {
        validationResults.skipReasons.push(riskCheck.reason);
        return validationResults;
      }
      
      // All checks passed
      validationResults.canTrade = true;
      if (this.enableLogging) {
        this.logger.info('All trade validation checks passed', {
          symbol,
          side,
          quantity,
          price: currentPrice,
          strategy,
          signalStrength,
          signalAnalysis: validationResults.signalAnalysis
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
   * Execute trade with full validation including signal strength
   * @param {string} symbol - Trading symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Number of shares
   * @param {number} currentPrice - Current market price
   * @param {string} strategy - Strategy name
   * @param {number} signalStrength - Signal strength (0-1 scale)
   * @returns {Object} Trade execution result
   */
  async executeTradeWithValidation(symbol, side, quantity, currentPrice, strategy, signalStrength = null) {
    try {
      // Validate before executing
      const validation = await this.validateTradeBeforeExecution(
        symbol, side, quantity, currentPrice, strategy, signalStrength
      );
      
      if (!validation.canTrade) {
        if (this.enableLogging) {
          this.logger.warn('Trade execution blocked by validation', {
            symbol,
            side,
            quantity,
            strategy,
            signalStrength,
            reasons: validation.skipReasons,
            signalAnalysis: validation.signalAnalysis
          });
        }
        
        return {
          success: false,
          skipped: true,
          reasons: validation.skipReasons,
          validation: validation,
          signalAnalysis: validation.signalAnalysis,
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
          strategy,
          signalStrength,
          scaling: validation.signalAnalysis?.canScale || false
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
          signalStrength,
          scaling: validation.signalAnalysis?.canScale || false,
          signalImprovement: validation.signalAnalysis?.relativeImprovement,
          timestamp: new Date().toISOString()
        });
      }
      
      return {
        success: true,
        skipped: false,
        order: order,
        validation: validation,
        signalAnalysis: validation.signalAnalysis,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Trade execution failed', {
        symbol,
        side,
        quantity,
        strategy,
        signalStrength,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        skipped: false,
        error: error,
        validation: validation,
        signalAnalysis: validation?.signalAnalysis,
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
      signalCache: Object.fromEntries(this.signalCache),
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
   * Get current signal cache status
   * @returns {Object} Signal cache status
   */
  getSignalCacheStatus() {
    const signals = {};
    this.signalCache.forEach((strength, key) => {
      const [symbol, side, strategy] = key.split('|');
      signals[key] = {
        symbol,
        side,
        strategy,
        lastSignalStrength: strength,
        timestamp: new Date().toISOString()
      };
    });
    return signals;
  }

  /**
   * Clear signal cache for testing or reset purposes
   */
  clearSignalCache() {
    this.signalCache.clear();
    if (this.enableLogging) {
      this.logger.info('Signal cache cleared');
    }
  }

  /**
 * Get cooldown status for a specific symbol
 * @param {string} symbol - The trading symbol to check
 * @returns {Object} Cooldown status information
 */
getCooldownStatus(symbol) {
    if (!symbol) {
        throw new Error('Symbol is required for cooldown status check');
    }

    const now = new Date();
    const cooldownKey = `cooldown_${symbol}`;
    const lastTradeKey = `lastTrade_${symbol}`;
    
    // Get cooldown data from cache/storage
    const cooldownData = this.cache?.get(cooldownKey);
    const lastTradeData = this.cache?.get(lastTradeKey);
    
    // Default cooldown period (in minutes) - can be configured per strategy
    const defaultCooldownMinutes = this.config?.cooldownMinutes || this.options?.cooldownMinutes || 15;

    
    // Check if symbol is currently in cooldown
    if (cooldownData && cooldownData.endTime) {
        const cooldownEndTime = new Date(cooldownData.endTime);
        
        if (now < cooldownEndTime) {
            const remainingMs = cooldownEndTime.getTime() - now.getTime();
            const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
            
            return {
                isInCooldown: true,
                symbol: symbol,
                cooldownStartTime: cooldownData.startTime,
                cooldownEndTime: cooldownData.endTime,
                remainingTimeMs: remainingMs,
                remainingTimeMinutes: remainingMinutes,
                reason: cooldownData.reason || 'Position closed',
                lastTradeResult: cooldownData.lastTradeResult
            };
        } else {
            // Cooldown has expired, clean up
            this.cache?.delete(cooldownKey);
            
            return {
                isInCooldown: false,
                symbol: symbol,
                cooldownExpired: true,
                expiredAt: cooldownEndTime
            };
        }
    }
    
    // No cooldown active
    return {
        isInCooldown: false,
        symbol: symbol,
        lastTradeTime: lastTradeData?.timestamp || null,
        nextAllowedTradeTime: null
    };
}

/**
 * Set cooldown period for a symbol after a trade
 * @param {string} symbol - The trading symbol
 * @param {Object} options - Cooldown options
 */
setCooldown(symbol, options = {}) {
    if (!symbol) {
        throw new Error('Symbol is required to set cooldown');
    }

    const now = new Date();
    const cooldownMinutes = options.cooldownMinutes || this.config?.cooldownMinutes || 15;
    const cooldownEndTime = new Date(now.getTime() + (cooldownMinutes * 60 * 1000));
    
    const cooldownData = {
        symbol: symbol,
        startTime: now.toISOString(),
        endTime: cooldownEndTime.toISOString(),
        cooldownMinutes: cooldownMinutes,
        reason: options.reason || 'Position closed',
        lastTradeResult: options.tradeResult || 'unknown',
        lastTradeId: options.tradeId || null
    };
    
    const cooldownKey = `cooldown_${symbol}`;
    
    // Store in cache
    if (this.cache) {
        this.cache.set(cooldownKey, cooldownData);
    }
    
    // Log the cooldown activation
    if (this.logger) {
        this.logger.info('Cooldown activated', {
            symbol: symbol,
            cooldownMinutes: cooldownMinutes,
            endTime: cooldownEndTime.toISOString(),
            reason: cooldownData.reason
        });
    }
    
    return cooldownData;
}

/**
 * Clear cooldown for a symbol (manual override)
 * @param {string} symbol - The trading symbol
 */
clearCooldown(symbol) {
    if (!symbol) {
        throw new Error('Symbol is required to clear cooldown');
    }

    const cooldownKey = `cooldown_${symbol}`;
    const wasInCooldown = this.cache?.has(cooldownKey);
    
    if (wasInCooldown) {
        this.cache?.delete(cooldownKey);
        
        if (this.logger) {
            this.logger.info('Cooldown manually cleared', {
                symbol: symbol,
                clearedAt: new Date().toISOString()
            });
        }
    }
    
    return {
        symbol: symbol,
        wasInCooldown: wasInCooldown,
        clearedAt: new Date().toISOString()
    };
}

/**
 * Check if a symbol can be traded (not in cooldown)
 * @param {string} symbol - The trading symbol to check
 * @returns {boolean} True if trading is allowed
 */
canTrade(symbol) {
    const status = this.getCooldownStatus(symbol);
    return !status.isInCooldown;
}

/**
 * Get all symbols currently in cooldown
 * @returns {Array} List of symbols in cooldown with their status
 */
getAllCooldowns() {
    if (!this.cache) {
        return [];
    }

    const cooldowns = [];
    const now = new Date();
    
    // Iterate through cache to find all cooldown entries
    for (const [key, value] of this.cache.entries()) {
        if (key.startsWith('cooldown_')) {
            const symbol = key.replace('cooldown_', '');
            const cooldownEndTime = new Date(value.endTime);
            
            if (now < cooldownEndTime) {
                const remainingMs = cooldownEndTime.getTime() - now.getTime();
                const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
                
                cooldowns.push({
                    symbol: symbol,
                    isInCooldown: true,
                    cooldownStartTime: value.startTime,
                    cooldownEndTime: value.endTime,
                    remainingTimeMs: remainingMs,
                    remainingTimeMinutes: remainingMinutes,
                    reason: value.reason,
                    lastTradeResult: value.lastTradeResult
                });
            } else {
                // Clean up expired cooldowns
                this.cache.delete(key);
            }
        }
    }
    
    return cooldowns;
}

/**
 * Initialize cooldown system with configuration
 * @param {Object} config - Configuration options
 */
initializeCooldownSystem(config = {}) {
    this.config = {
        cooldownMinutes: config.cooldownMinutes || 15,
        maxCooldowns: config.maxCooldowns || 100,
        cleanupIntervalMinutes: config.cleanupIntervalMinutes || 60,
        ...config
    };
    
    // Initialize cache if not exists
    if (!this.cache) {
        this.cache = new Map();
    }
    
    // Set up cleanup interval for expired cooldowns
    if (this.config.cleanupIntervalMinutes > 0) {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredCooldowns();
        }, this.config.cleanupIntervalMinutes * 60 * 1000);
    }
    
    if (this.logger) {
        this.logger.info('Cooldown system initialized', {
            defaultCooldownMinutes: this.config.cooldownMinutes,
            cleanupInterval: this.config.cleanupIntervalMinutes
        });
    }
}

/**
 * Cleanup expired cooldowns from cache
 */
cleanupExpiredCooldowns() {
    if (!this.cache) return;
    
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [key, value] of this.cache.entries()) {
        if (key.startsWith('cooldown_')) {
            const cooldownEndTime = new Date(value.endTime);
            if (now >= cooldownEndTime) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }
    }
    
    if (cleanedCount > 0 && this.logger) {
        this.logger.info('Expired cooldowns cleaned up', {
            cleanedCount: cleanedCount,
            cleanupTime: now.toISOString()
        });
    }
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
}