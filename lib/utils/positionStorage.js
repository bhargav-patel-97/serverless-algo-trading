/**
 * positionStorage.js - Position Metadata Storage System
 * Handles persistent storage of take profit/stop loss levels for open positions
 * Optimized for serverless environment with in-memory caching
 */

import { Logger } from './logger.js';

export class PositionStorage {
  constructor(options = {}) {
    this.logger = options.logger || new Logger();
    this.cache = new Map(); // In-memory cache for performance
    this.options = {
      enableLogging: options.enableLogging !== false,
      maxCacheSize: options.maxCacheSize || 1000,
      cacheExpiryMs: options.cacheExpiryMs || 86400000, // 24 hours default
      ...options
    };

    // Initialize cleanup interval for expired cache entries
    this.startCacheCleanup();
  }

  /**
   * Store take profit and stop loss levels for a position
   * @param {string} symbol - Trading symbol
   * @param {Object} levels - TP/SL levels and metadata
   * @returns {boolean} Success status
   */
  async storePositionLevels(symbol, levels) {
    try {
      const positionData = {
        symbol,
        stopLoss: parseFloat(levels.stopLoss) || null,
        takeProfit: parseFloat(levels.takeProfit) || null,
        entryPrice: parseFloat(levels.entryPrice) || null,
        side: levels.side || null, // 'long' or 'short'
        quantity: parseInt(levels.quantity) || null,
        strategy: levels.strategy || null,
        orderId: levels.orderId || null,
        timestamp: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        expires: new Date(Date.now() + this.options.cacheExpiryMs).toISOString()
      };

      // Validate required fields
      if (!positionData.stopLoss && !positionData.takeProfit) {
        throw new Error('At least one of stopLoss or takeProfit must be provided');
      }

      // Store in cache
      this.cache.set(symbol, positionData);

      if (this.options.enableLogging) {
        this.logger.info('Position levels stored', {
          symbol,
          stopLoss: positionData.stopLoss,
          takeProfit: positionData.takeProfit,
          entryPrice: positionData.entryPrice,
          strategy: positionData.strategy
        });
      }

      // Clean up cache if it gets too large
      if (this.cache.size > this.options.maxCacheSize) {
        await this.cleanupExpiredEntries();
      }

      return true;

    } catch (error) {
      this.logger.error('Failed to store position levels', {
        symbol,
        levels,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Retrieve take profit and stop loss levels for a position
   * @param {string} symbol - Trading symbol
   * @returns {Object|null} Stored levels or null if not found
   */
  async getPositionLevels(symbol) {
    try {
      // Check cache first
      const cachedData = this.cache.get(symbol);
      
      if (!cachedData) {
        if (this.options.enableLogging) {
          this.logger.info('No stored levels found for symbol', { symbol });
        }
        return null;
      }

      // Check if data has expired
      if (new Date(cachedData.expires) < new Date()) {
        this.cache.delete(symbol);
        if (this.options.enableLogging) {
          this.logger.info('Stored levels expired and removed', { symbol });
        }
        return null;
      }

      if (this.options.enableLogging) {
        this.logger.info('Retrieved stored levels', {
          symbol,
          stopLoss: cachedData.stopLoss,
          takeProfit: cachedData.takeProfit,
          age: Math.round((Date.now() - new Date(cachedData.timestamp).getTime()) / 1000 / 60) + ' minutes'
        });
      }

      return {
        symbol: cachedData.symbol,
        stopLoss: cachedData.stopLoss,
        takeProfit: cachedData.takeProfit,
        entryPrice: cachedData.entryPrice,
        side: cachedData.side,
        quantity: cachedData.quantity,
        strategy: cachedData.strategy,
        orderId: cachedData.orderId,
        timestamp: cachedData.timestamp,
        lastUpdated: cachedData.lastUpdated
      };

    } catch (error) {
      this.logger.error('Failed to retrieve position levels', {
        symbol,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Update existing position levels
   * @param {string} symbol - Trading symbol
   * @param {Object} updates - Fields to update
   * @returns {boolean} Success status
   */
  async updatePositionLevels(symbol, updates) {
    try {
      const existingData = this.cache.get(symbol);
      
      if (!existingData) {
        this.logger.warning('Cannot update non-existent position levels', { symbol });
        return false;
      }

      // Merge updates with existing data
      const updatedData = {
        ...existingData,
        ...updates,
        lastUpdated: new Date().toISOString()
      };

      // Validate that we still have at least one exit level
      if (!updatedData.stopLoss && !updatedData.takeProfit) {
        throw new Error('Cannot remove both stopLoss and takeProfit');
      }

      this.cache.set(symbol, updatedData);

      if (this.options.enableLogging) {
        this.logger.info('Position levels updated', {
          symbol,
          updates,
          newStopLoss: updatedData.stopLoss,
          newTakeProfit: updatedData.takeProfit
        });
      }

      return true;

    } catch (error) {
      this.logger.error('Failed to update position levels', {
        symbol,
        updates,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Remove position levels (called when position is closed)
   * @param {string} symbol - Trading symbol
   * @returns {boolean} Success status
   */
  async removePositionLevels(symbol) {
    try {
      const existed = this.cache.has(symbol);
      this.cache.delete(symbol);

      if (this.options.enableLogging) {
        this.logger.info('Position levels removed', {
          symbol,
          existed
        });
      }

      return true;

    } catch (error) {
      this.logger.error('Failed to remove position levels', {
        symbol,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get all stored position symbols
   * @returns {Array} Array of symbols with stored levels
   */
  async getAllStoredSymbols() {
    try {
      const symbols = Array.from(this.cache.keys());
      
      if (this.options.enableLogging) {
        this.logger.info('Retrieved all stored symbols', {
          count: symbols.length,
          symbols
        });
      }

      return symbols;

    } catch (error) {
      this.logger.error('Failed to get all stored symbols', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get count of stored positions
   * @returns {number} Number of positions with stored levels
   */
  async getStoredPositionsCount() {
    return this.cache.size;
  }

  /**
   * Get comprehensive storage statistics
   * @returns {Object} Storage statistics
   */
  async getStorageStats() {
    try {
      const now = new Date();
      let expiredCount = 0;
      let validCount = 0;
      const strategies = new Set();
      const sides = new Set();

      this.cache.forEach((data, symbol) => {
        if (new Date(data.expires) < now) {
          expiredCount++;
        } else {
          validCount++;
          if (data.strategy) strategies.add(data.strategy);
          if (data.side) sides.add(data.side);
        }
      });

      return {
        totalEntries: this.cache.size,
        validEntries: validCount,
        expiredEntries: expiredCount,
        uniqueStrategies: Array.from(strategies),
        positionSides: Array.from(sides),
        cacheSize: this.cache.size,
        maxCacheSize: this.options.maxCacheSize,
        cacheUsagePercent: Math.round((this.cache.size / this.options.maxCacheSize) * 100),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get storage stats', {
        error: error.message
      });
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredEntries() {
    try {
      const now = new Date();
      let cleanedCount = 0;

      for (const [symbol, data] of this.cache.entries()) {
        if (new Date(data.expires) < now) {
          this.cache.delete(symbol);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0 && this.options.enableLogging) {
        this.logger.info('Cache cleanup completed', {
          entriesRemoved: cleanedCount,
          remainingEntries: this.cache.size
        });
      }

      return cleanedCount;

    } catch (error) {
      this.logger.error('Cache cleanup failed', {
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Start automatic cache cleanup interval
   */
  startCacheCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Run cleanup every hour
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredEntries();
    }, 3600000);

    if (this.options.enableLogging) {
      this.logger.info('Cache cleanup interval started', {
        intervalMs: 3600000
      });
    }
  }

  /**
   * Stop automatic cache cleanup interval
   */
  stopCacheCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      
      if (this.options.enableLogging) {
        this.logger.info('Cache cleanup interval stopped');
      }
    }
  }

  /**
   * Clear all cached data (for testing or emergency situations)
   * @returns {number} Number of entries cleared
   */
  async clearAllData() {
    const entriesCleared = this.cache.size;
    this.cache.clear();

    if (this.options.enableLogging) {
      this.logger.warning('All cached position data cleared', {
        entriesCleared
      });
    }

    return entriesCleared;
  }

  /**
   * Bulk update positions from external source
   * @param {Array} positionsData - Array of position level objects
   * @returns {Object} Bulk update results
   */
  async bulkStorePositions(positionsData) {
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    try {
      for (const positionData of positionsData) {
        if (!positionData.symbol) {
          results.failed++;
          results.errors.push('Missing symbol in position data');
          continue;
        }

        const success = await this.storePositionLevels(positionData.symbol, positionData);
        if (success) {
          results.successful++;
        } else {
          results.failed++;
        }
      }

      if (this.options.enableLogging) {
        this.logger.info('Bulk position storage completed', results);
      }

      return results;

    } catch (error) {
      this.logger.error('Bulk position storage failed', {
        error: error.message
      });
      results.errors.push(error.message);
      return results;
    }
  }

  /**
   * Export all position data for backup or analysis
   * @returns {Array} Array of all position data
   */
  async exportAllData() {
    try {
      const exportData = [];
      
      this.cache.forEach((data, symbol) => {
        exportData.push({
          ...data,
          exportTimestamp: new Date().toISOString()
        });
      });

      if (this.options.enableLogging) {
        this.logger.info('Position data exported', {
          entriesExported: exportData.length
        });
      }

      return exportData;

    } catch (error) {
      this.logger.error('Data export failed', {
        error: error.message
      });
      return [];
    }
  }
}