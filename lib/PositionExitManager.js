/**
 * PositionExitManager.js - Advanced Take Profit/Stop Loss Monitoring System
 * Monitors all open positions and executes exit orders when conditions are met
 * Integrates with the existing serverless algorithmic trading system
 */

import { Logger } from './utils/logger.js';
import { PositionStorage } from './utils/positionStorage.js';

export class PositionExitManager {
  constructor(alpacaClient, options = {}) {
    this.alpaca = alpacaClient;
    this.logger = options.logger || new Logger();
    this.positionStorage = new PositionStorage();
    
    // Configuration options
    this.options = {
      enableLogging: options.enableLogging !== false,
      priceBuffer: options.priceBuffer || 0.001, // 0.1% buffer for price comparisons
      maxRetries: options.maxRetries || 3,
      retryDelayMs: options.retryDelayMs || 1000,
      emergencyStopEnabled: options.emergencyStopEnabled !== false,
      maxSlippage: options.maxSlippage || 0.02, // 2% max slippage
      ...options
    };
  }

  /**
   * Main method to monitor all positions and execute exits when conditions are met
   * @returns {Object} Exit monitoring results
   */
  async monitorAndExecuteExits() {
    if (this.options.enableLogging) {
      this.logger.info('Starting position exit monitoring', {
        timestamp: new Date().toISOString()
      });
    }

    const exitResults = {
      positionsMonitored: 0,
      exitOrdersExecuted: 0,
      stopLossTriggered: 0,
      takeProfitTriggered: 0,
      errors: [],
      exitTrades: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Get all current positions from Alpaca
      const positions = await this.alpaca.getPositions();
      exitResults.positionsMonitored = positions.length;

      if (positions.length === 0) {
        if (this.options.enableLogging) {
          this.logger.info('No open positions to monitor');
        }
        return exitResults;
      }

      if (this.options.enableLogging) {
        this.logger.info('Monitoring positions for exit conditions', {
          totalPositions: positions.length,
          symbols: positions.map(p => p.symbol)
        });
      }

      // Process each position
      for (const position of positions) {
        try {
          const exitResult = await this.processPositionForExit(position);
          if (exitResult) {
            exitResults.exitTrades.push(exitResult);
            exitResults.exitOrdersExecuted++;
            
            if (exitResult.exitType === 'stop_loss') {
              exitResults.stopLossTriggered++;
            } else if (exitResult.exitType === 'take_profit') {
              exitResults.takeProfitTriggered++;
            }
          }
        } catch (error) {
          const errorInfo = {
            symbol: position.symbol,
            error: error.message,
            timestamp: new Date().toISOString()
          };
          exitResults.errors.push(errorInfo);
          
          this.logger.error('Error processing position for exit', {
            ...errorInfo,
            stack: error.stack
          });
        }
      }

      if (this.options.enableLogging) {
        this.logger.info('Position exit monitoring completed', exitResults);
      }

      return exitResults;

    } catch (error) {
      this.logger.error('Critical error in position exit monitoring', {
        error: error.message,
        stack: error.stack
      });
      
      exitResults.errors.push({
        type: 'critical_error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      return exitResults;
    }
  }

  /**
   * Process a single position to check if exit conditions are met
   * @param {Object} position - Alpaca position object
   * @returns {Object|null} Exit trade result or null if no exit needed
   */
  async processPositionForExit(position) {
    const symbol = position.symbol;
    const currentQty = parseInt(position.qty);
    const currentPrice = parseFloat(position.current_price);
    const avgEntryPrice = parseFloat(position.avg_entry_price);
    const side = currentQty > 0 ? 'long' : 'short';
    const absQty = Math.abs(currentQty);

    if (this.options.enableLogging) {
      this.logger.info('Processing position for exit conditions', {
        symbol,
        side,
        quantity: absQty,
        currentPrice,
        avgEntryPrice,
        unrealizedPL: position.unrealized_pl
      });
    }

    try {
      // Get stored TP/SL levels for this position
      const storedLevels = await this.positionStorage.getPositionLevels(symbol);
      
      if (!storedLevels) {
        if (this.options.enableLogging) {
          this.logger.warning('No stored TP/SL levels found for position', {
            symbol,
            side,
            message: 'Position may have been opened before TP/SL system was implemented'
          });
        }
        return null;
      }

      // Get current market price for more accurate comparison
      const quote = await this.alpaca.getQuote(symbol);
      const marketPrice = side === 'long' ? quote.bid : quote.ask; // Use appropriate side for exit

      if (this.options.enableLogging) {
        this.logger.info('Checking exit conditions', {
          symbol,
          side,
          marketPrice,
          storedStopLoss: storedLevels.stopLoss,
          storedTakeProfit: storedLevels.takeProfit,
          entryPrice: avgEntryPrice
        });
      }

      // Check stop loss condition
      if (this.shouldTriggerStopLoss(side, marketPrice, storedLevels.stopLoss)) {
        if (this.options.enableLogging) {
          this.logger.warning('Stop loss triggered', {
            symbol,
            side,
            marketPrice,
            stopLossLevel: storedLevels.stopLoss,
            loss: ((marketPrice - avgEntryPrice) / avgEntryPrice * 100).toFixed(2) + '%'
          });
        }

        return await this.executeExitOrder(position, 'stop_loss', storedLevels);
      }

      // Check take profit condition  
      if (this.shouldTriggerTakeProfit(side, marketPrice, storedLevels.takeProfit)) {
        if (this.options.enableLogging) {
          this.logger.info('Take profit triggered', {
            symbol,
            side,
            marketPrice,
            takeProfitLevel: storedLevels.takeProfit,
            profit: ((marketPrice - avgEntryPrice) / avgEntryPrice * 100).toFixed(2) + '%'
          });
        }

        return await this.executeExitOrder(position, 'take_profit', storedLevels);
      }

      // No exit conditions met
      return null;

    } catch (error) {
      this.logger.error('Error processing position for exit', {
        symbol,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Check if stop loss should be triggered
   * @param {string} side - 'long' or 'short'
   * @param {number} currentPrice - Current market price
   * @param {number} stopLossLevel - Stored stop loss level
   * @returns {boolean} True if stop loss should trigger
   */
  shouldTriggerStopLoss(side, currentPrice, stopLossLevel) {
    if (!stopLossLevel || stopLossLevel <= 0) return false;

    const buffer = 1 + this.options.priceBuffer;
    
    if (side === 'long') {
      // Long position: trigger if current price <= stop loss level
      return currentPrice <= (stopLossLevel * buffer);
    } else {
      // Short position: trigger if current price >= stop loss level  
      return currentPrice >= (stopLossLevel / buffer);
    }
  }

  /**
   * Check if take profit should be triggered
   * @param {string} side - 'long' or 'short'
   * @param {number} currentPrice - Current market price
   * @param {number} takeProfitLevel - Stored take profit level
   * @returns {boolean} True if take profit should trigger
   */
  shouldTriggerTakeProfit(side, currentPrice, takeProfitLevel) {
    if (!takeProfitLevel || takeProfitLevel <= 0) return false;

    const buffer = 1 - this.options.priceBuffer;
    
    if (side === 'long') {
      // Long position: trigger if current price >= take profit level
      return currentPrice >= (takeProfitLevel * buffer);
    } else {
      // Short position: trigger if current price <= take profit level
      return currentPrice <= (takeProfitLevel / buffer);
    }
  }

  /**
   * Execute exit order with retry logic
   * @param {Object} position - Alpaca position object
   * @param {string} exitType - 'stop_loss' or 'take_profit'
   * @param {Object} storedLevels - Stored TP/SL levels
   * @returns {Object} Exit trade result
   */
  async executeExitOrder(position, exitType, storedLevels) {
    const symbol = position.symbol;
    const currentQty = parseInt(position.qty);
    const absQty = Math.abs(currentQty);
    const side = currentQty > 0 ? 'sell' : 'buy'; // Opposite side for exit
    const avgEntryPrice = parseFloat(position.avg_entry_price);

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        if (this.options.enableLogging) {
          this.logger.info('Executing exit order', {
            symbol,
            side,
            quantity: absQty,
            exitType,
            attempt,
            maxRetries: this.options.maxRetries
          });
        }

        // Execute market order for immediate exit
        const exitOrder = await this.alpaca.submitOrder({
          symbol: symbol,
          qty: absQty,
          side: side,
          type: 'market',
          time_in_force: 'day'
        });

        // Get the actual exit price (this might be filled immediately or pending)
        let exitPrice = null;
        try {
          // Wait a moment for potential fill
          await new Promise(resolve => setTimeout(resolve, 1000));
          const orderStatus = await this.alpaca.getOrder(exitOrder.id);
          if (orderStatus.status === 'filled') {
            exitPrice = parseFloat(orderStatus.filled_avg_price);
          }
        } catch (priceError) {
          this.logger.warning('Could not get filled exit price', {
            symbol,
            orderId: exitOrder.id,
            error: priceError.message
          });
        }

        // Calculate P&L
        const realizedPL = currentQty > 0 
          ? (exitPrice - avgEntryPrice) * absQty 
          : (avgEntryPrice - exitPrice) * absQty;

        const exitTradeResult = {
          orderId: exitOrder.id,
          symbol,
          side,
          quantity: absQty,
          exitType,
          entryPrice: avgEntryPrice,
          exitPrice: exitPrice,
          realizedPL: realizedPL,
          exitReason: exitType === 'stop_loss' ? 'Stop loss triggered' : 'Take profit triggered',
          storedLevels: {
            stopLoss: storedLevels.stopLoss,
            takeProfit: storedLevels.takeProfit
          },
          timestamp: new Date().toISOString(),
          status: 'executed'
        };

        // Clean up stored position levels
        await this.positionStorage.removePositionLevels(symbol);

        if (this.options.enableLogging) {
          this.logger.success('Exit order executed successfully', exitTradeResult);
        }

        return exitTradeResult;

      } catch (error) {
        this.logger.error('Exit order execution failed', {
          symbol,
          exitType,
          attempt,
          maxRetries: this.options.maxRetries,
          error: error.message
        });

        if (attempt === this.options.maxRetries) {
          // Final attempt failed - return error result
          return {
            symbol,
            exitType,
            status: 'failed',
            error: error.message,
            attempts: attempt,
            timestamp: new Date().toISOString()
          };
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelayMs));
      }
    }
  }

  /**
   * Emergency stop all positions (panic sell)
   * @returns {Object} Emergency stop results
   */
  async emergencyStopAllPositions() {
    if (!this.options.emergencyStopEnabled) {
      this.logger.warning('Emergency stop is disabled');
      return { status: 'disabled' };
    }

    this.logger.warning('EMERGENCY STOP: Closing all positions immediately');
    
    try {
      const positions = await this.alpaca.getPositions();
      const emergencyResults = {
        positionsClosed: 0,
        errors: [],
        timestamp: new Date().toISOString()
      };

      for (const position of positions) {
        try {
          const currentQty = parseInt(position.qty);
          const absQty = Math.abs(currentQty);
          const side = currentQty > 0 ? 'sell' : 'buy';

          await this.alpaca.submitOrder({
            symbol: position.symbol,
            qty: absQty,
            side: side,
            type: 'market',
            time_in_force: 'day'
          });

          emergencyResults.positionsClosed++;
          
          // Clean up stored levels
          await this.positionStorage.removePositionLevels(position.symbol);
          
        } catch (error) {
          emergencyResults.errors.push({
            symbol: position.symbol,
            error: error.message
          });
        }
      }

      this.logger.warning('Emergency stop completed', emergencyResults);
      return emergencyResults;

    } catch (error) {
      this.logger.error('Emergency stop failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get monitoring status and statistics
   * @returns {Object} Monitoring status
   */
  async getMonitoringStatus() {
    try {
      const positions = await this.alpaca.getPositions();
      const storedLevelsCount = await this.positionStorage.getStoredPositionsCount();
      
      return {
        totalPositions: positions.length,
        positionsWithStoredLevels: storedLevelsCount,
        monitoringActive: true,
        lastCheckTimestamp: new Date().toISOString(),
        configuration: {
          priceBuffer: this.options.priceBuffer,
          maxRetries: this.options.maxRetries,
          emergencyStopEnabled: this.options.emergencyStopEnabled
        }
      };
    } catch (error) {
      this.logger.error('Failed to get monitoring status', error);
      return {
        monitoringActive: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}