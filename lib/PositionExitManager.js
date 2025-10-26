/**  
 * Enhanced PositionExitManager.js - Advanced Take Profit/Stop Loss Monitoring System  
 * LOGGING FIX: Accepts shared GoogleSheetsLogger instance to prevent re-initialization
 * Now with persistent storage support for serverless environments  
 * Monitors all open positions and executes exit orders when conditions are met  
 * Integrates with the enhanced persistent position storage system  
 */  
import { Logger } from './utils/logger.js';  
import { PositionStorage } from './utils/positionStorage.js';  

export class PositionExitManager {  
  constructor(alpacaClient, options = {}) {  
    this.alpaca = alpacaClient;  
    this.logger = options.logger || new Logger();  

    // LOGGING FIX: Get shared sheetsLogger from options if provided
    const sheetsLogger = options.sheetsLogger || options.storageOptions?.sheetsLogger;

    // Enhanced: Initialize position storage with persistent backend  
    // LOGGING FIX: Pass shared sheetsLogger instance
    this.positionStorage = new PositionStorage({  
      logger: options.logger,  
      enableLogging: options.enableLogging !== false,  
      enablePersistence: true,
      sheetsLogger: sheetsLogger, // LOGGING FIX: Use shared instance
      ...options.storageOptions
    });  

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

    // LOGGING FIX: Only initialize if not already initialized
    if (!sheetsLogger) {
      this.initializePersistentStorage();
    }
  }  

  /**  
   * Initialize persistent storage backend  
   */  
  async initializePersistentStorage() {  
    try {  
      if (this.positionStorage && this.positionStorage.initializePersistentStorage) {  
        await this.positionStorage.initializePersistentStorage();  
        if (this.options.enableLogging) {  
          this.logger.info('Persistent storage initialized for PositionExitManager');  
        }  
      }  
    } catch (error) {  
      this.logger.error('Failed to initialize persistent storage in PositionExitManager', {  
        error: error.message  
      });  
    }  
  }  

  /**  
   * Main method to monitor all positions and execute exits when conditions are met  
   * Enhanced with persistent storage synchronization  
   * @returns {Object} Exit monitoring results  
   */  
  async monitorAndExecuteExits() {  
    if (this.options.enableLogging) {  
      this.logger.info('Starting position exit monitoring with persistent storage', {  
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
      persistentStorageSync: null,  
      timestamp: new Date().toISOString()  
    };  

    try {  
      // Enhanced: Synchronize with persistent storage first (important for serverless)
      // LOGGING FIX: Only sync if there's actual data, reduce log spam
      if (this.positionStorage && this.positionStorage.synchronizeWithPersistentStorage) {  
        try {  
          exitResults.persistentStorageSync = await this.positionStorage.synchronizeWithPersistentStorage();  
          // LOGGING FIX: Only log if there were actual changes
          if (exitResults.persistentStorageSync.synchronized > 0 && this.options.enableLogging) {  
            this.logger.info('Position storage synchronized with persistent backend', exitResults.persistentStorageSync);  
          }  
        } catch (syncError) {  
          this.logger.error('Failed to synchronize with persistent storage', {  
            error: syncError.message  
          });  
          exitResults.persistentStorageSync = { error: syncError.message };  
        }  
      }  

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

      // Enhanced: Clean up orphaned exit levels  
      try {  
        const cleanupResult = await this.cleanupOrphanedExitLevels(positions);  
        exitResults.cleanupResult = cleanupResult;  
      } catch (cleanupError) {  
        this.logger.error('Failed to cleanup orphaned exit levels', {  
          error: cleanupError.message  
        });  
      }  

      if (this.options.enableLogging) {  
        this.logger.info('Position exit monitoring completed', {  
          positionsMonitored: exitResults.positionsMonitored,
          exitOrdersExecuted: exitResults.exitOrdersExecuted
        });  
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
   * Enhanced with persistent storage retrieval  
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
      // Enhanced: Get stored TP/SL levels from persistent storage  
      const storedLevels = await this.positionStorage.getPositionLevels(symbol);  

      if (!storedLevels) {  
        if (this.options.enableLogging) {  
          this.logger.warning('No stored TP/SL levels found for position', {  
            symbol,  
            side,  
            message: 'Position may have been opened before TP/SL system was implemented or storage failed'  
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
          storedTakeProfit: storedLevels.takeProfit  
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
   * Execute exit order with retry logic and persistent storage cleanup  
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

        // Enhanced: Clean up stored position levels from persistent storage  
        try {  
          const cleanupSuccess = await this.positionStorage.removePositionLevels(symbol);  
          exitTradeResult.persistentStorageCleanup = cleanupSuccess;  

          if (this.options.enableLogging) {  
            this.logger.info('Position levels cleaned up from persistent storage', {  
              symbol,  
              cleanupSuccess  
            });  
          }  
        } catch (cleanupError) {  
          this.logger.error('Failed to cleanup position levels from persistent storage', {  
            symbol,  
            error: cleanupError.message  
          });  
          exitTradeResult.persistentStorageCleanup = false;  
          exitTradeResult.cleanupError = cleanupError.message;  
        }  

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
   * Emergency stop all positions (panic sell) with persistent storage cleanup  
   * @returns {Object} Emergency stop results  
   */  
  async emergencyStopAllPositions() {  
    if (!this.options.emergencyStopEnabled) {  
      this.logger.warning('Emergency stop is disabled');  
      return { status: 'disabled' };  
    }  

    this.logger.warning('EMERGENCY STOP: Closing all positions immediately with persistent storage cleanup');  

    try {  
      const positions = await this.alpaca.getPositions();  
      const emergencyResults = {  
        positionsClosed: 0,  
        persistentStorageCleanedUp: 0,  
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

          // Enhanced: Clean up stored levels from persistent storage  
          try {  
            const cleanupSuccess = await this.positionStorage.removePositionLevels(position.symbol);  
            if (cleanupSuccess) {  
              emergencyResults.persistentStorageCleanedUp++;  
            }  
          } catch (cleanupError) {  
            this.logger.error('Failed to cleanup position levels during emergency stop', {  
              symbol: position.symbol,  
              error: cleanupError.message  
            });  
          }  
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
   * Enhanced monitoring status and statistics with persistent storage information  
   * @returns {Object} Monitoring status  
   */  
  async getMonitoringStatus() {  
    try {  
      const positions = await this.alpaca.getPositions();  
      const storedLevelsCount = await this.positionStorage.getStoredPositionsCount();  
      const storageStats = await this.positionStorage.getStorageStats();  

      return {  
        totalPositions: positions.length,  
        positionsWithStoredLevels: storedLevelsCount,  
        monitoringActive: true,  
        lastCheckTimestamp: new Date().toISOString(),  
        configuration: {  
          priceBuffer: this.options.priceBuffer,  
          maxRetries: this.options.maxRetries,  
          emergencyStopEnabled: this.options.emergencyStopEnabled  
        },  
        persistentStorage: {  
          enabled: this.positionStorage.sheetsLogger?.enabled || false,  
          stats: storageStats,  
          coverage: positions.length > 0   
            ? Math.round((storedLevelsCount / positions.length) * 100)  
            : 100  
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

  /**  
   * Enhanced cleanup method for orphaned exit levels  
   * @param {Array} currentPositions - Current Alpaca positions  
   * @returns {Object} Cleanup results  
   */  
  async cleanupOrphanedExitLevels(currentPositions) {  
    try {  
      const currentSymbols = new Set(currentPositions.map(p => p.symbol));  
      const storedSymbols = await this.positionStorage.getAllStoredSymbols();  

      let cleanedCount = 0;  
      const cleanedSymbols = [];  

      for (const symbol of storedSymbols) {  
        if (!currentSymbols.has(symbol)) {  
          const success = await this.positionStorage.removePositionLevels(symbol);  
          if (success) {  
            cleanedCount++;  
            cleanedSymbols.push(symbol);  
          }  
        }  
      }  

      const result = {  
        cleanedCount,  
        cleanedSymbols,  
        currentPositions: currentPositions.length,  
        storedLevels: storedSymbols.length,  
        remainingStoredLevels: storedSymbols.length - cleanedCount,  
        timestamp: new Date().toISOString()  
      };  

      if (this.options.enableLogging && cleanedCount > 0) {  
        this.logger.info('Orphaned exit levels cleaned up from persistent storage', result);  
      }  

      return result;  
    } catch (error) {  
      this.logger.error('Failed to cleanup orphaned exit levels', {  
        error: error.message  
      });  
      return {  
        error: error.message,  
        cleanedCount: 0,  
        timestamp: new Date().toISOString()  
      };  
    }  
  }  
}
