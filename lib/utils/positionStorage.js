/**  
 * positionStorage.js - Enhanced Position Metadata Storage System  
 * LOGGING FIX: Accepts shared GoogleSheetsLogger instance to prevent re-initialization
 * Now with Google Sheets persistence for serverless environment compatibility  
 * Maintains in-memory caching for performance with persistent backend storage  
 */  
import { Logger } from './logger.js';  
import { GoogleSheetsLogger } from './googleSheets.js';  

export class PositionStorage {  
  constructor(options = {}) {  
    this.logger = options.logger || new Logger();  
    this.cache = new Map(); // In-memory cache for performance  

    // LOGGING FIX: Use shared GoogleSheetsLogger instance if provided, otherwise create new
    this.sheetsLogger = options.sheetsLogger || new GoogleSheetsLogger();

    this.options = {  
      enableLogging: options.enableLogging !== false,  
      maxCacheSize: options.maxCacheSize || 1000,  
      cacheExpiryMs: options.cacheExpiryMs || 86400000, // 24 hours default  
      enablePersistence: options.enablePersistence !== false,  
      ...options  
    };  

    // LOGGING FIX: Only initialize if not already initialized
    if (!options.sheetsLogger) {
      this.initializePersistentStorage();
    }

    // Initialize cleanup interval for expired cache entries  
    this.startCacheCleanup();  
  }  

  /**  
   * Initialize persistent storage backend (Google Sheets)  
   */  
  async initializePersistentStorage() {  
    if (!this.options.enablePersistence || !this.sheetsLogger.enabled) {  
      if (this.options.enableLogging) {  
        this.logger.warning('Persistent storage disabled - using memory-only mode');  
      }  
      return;  
    }  

    try {  
      // LOGGING FIX: Only initialize if not already done
      if (!this.sheetsLogger.initialized) {
        await this.sheetsLogger.initializePositionLevelsSheet();  
        this.sheetsLogger.initialized = true;
        if (this.options.enableLogging) {  
          this.logger.info('Persistent position storage initialized via Google Sheets');  
        }
      }  
    } catch (error) {  
      this.logger.error('Failed to initialize persistent storage', {  
        error: error.message  
      });  
    }  
  }  

  /**  
   * Store take profit and stop loss levels for a position  
   * Now with persistent backend storage  
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

      // Store in memory cache for fast access  
      this.cache.set(symbol, positionData);  

      // Store in persistent backend (Google Sheets) for serverless persistence  
      let persistentStoreSuccess = true;  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          persistentStoreSuccess = await this.sheetsLogger.storePositionLevels(symbol, levels);  
        } catch (persistentError) {  
          // LOGGING FIX: Only log errors, not successful operations
          this.logger.error('Failed to store in persistent backend, continuing with cache only', {  
            symbol,  
            error: persistentError.message  
          });  
          persistentStoreSuccess = false;  
        }  
      }  

      // LOGGING FIX: Only log if explicitly enabled at storage level
      if (this.options.enableLogging) {  
        this.logger.info('Position levels stored', {  
          symbol,  
          stopLoss: positionData.stopLoss,  
          takeProfit: positionData.takeProfit,  
          entryPrice: positionData.entryPrice,  
          strategy: positionData.strategy,  
          storedInCache: true,  
          storedInPersistent: persistentStoreSuccess  
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
   * Checks cache first, then persistent storage if not found  
   * @param {string} symbol - Trading symbol  
   * @returns {Object|null} Stored levels or null if not found  
   */  
  async getPositionLevels(symbol) {  
    try {  
      // Check cache first for performance  
      const cachedData = this.cache.get(symbol);  

      if (cachedData && new Date(cachedData.expires) >= new Date()) {  
        // LOGGING FIX: Only log if explicitly enabled
        if (this.options.enableLogging) {  
          this.logger.info('Retrieved stored levels from cache', {  
            symbol,  
            stopLoss: cachedData.stopLoss,  
            takeProfit: cachedData.takeProfit,  
            source: 'cache'  
          });  
        }  
        return this.formatPositionData(cachedData);  
      }  

      // Cache miss or expired - check persistent storage  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          const persistentData = await this.sheetsLogger.getPositionLevels(symbol);  

          if (persistentData) {  
            // Store in cache for future fast access  
            const cacheData = {  
              ...persistentData,  
              expires: new Date(Date.now() + this.options.cacheExpiryMs).toISOString()  
            };  
            this.cache.set(symbol, cacheData);  

            // LOGGING FIX: Only log if explicitly enabled
            if (this.options.enableLogging) {  
              this.logger.info('Retrieved stored levels from persistent storage and cached', {  
                symbol,  
                stopLoss: persistentData.stopLoss,  
                takeProfit: persistentData.takeProfit,  
                source: 'persistent_storage'  
              });  
            }  
            return this.formatPositionData(persistentData);  
          }  
        } catch (persistentError) {  
          this.logger.error('Failed to retrieve from persistent storage', {  
            symbol,  
            error: persistentError.message  
          });  
        }  
      }  

      // Remove expired cache entry  
      if (cachedData) {  
        this.cache.delete(symbol);  
        // LOGGING FIX: Only log if explicitly enabled
        if (this.options.enableLogging) {  
          this.logger.info('Removed expired cache entry', { symbol });  
        }  
      }  

      // LOGGING FIX: Only log if explicitly enabled
      if (this.options.enableLogging) {  
        this.logger.info('No stored levels found for symbol', { symbol });  
      }  
      return null;  

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
   * Updates both cache and persistent storage  
   * @param {string} symbol - Trading symbol  
   * @param {Object} updates - Fields to update  
   * @returns {boolean} Success status  
   */  
  async updatePositionLevels(symbol, updates) {  
    try {  
      // Get existing data from cache or persistent storage  
      let existingData = this.cache.get(symbol);  

      if (!existingData && this.options.enablePersistence && this.sheetsLogger.enabled) {  
        const persistentData = await this.sheetsLogger.getPositionLevels(symbol);  
        if (persistentData) {  
          existingData = persistentData;  
        }  
      }  

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

      // Update cache  
      this.cache.set(symbol, updatedData);  

      // Update persistent storage  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          await this.sheetsLogger.storePositionLevels(symbol, updatedData);  
        } catch (persistentError) {  
          this.logger.error('Failed to update persistent storage', {  
            symbol,  
            error: persistentError.message  
          });  
        }  
      }  

      // LOGGING FIX: Only log if explicitly enabled
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
   * Removes from both cache and persistent storage  
   * @param {string} symbol - Trading symbol  
   * @returns {boolean} Success status  
   */  
  async removePositionLevels(symbol) {  
    try {  
      const existedInCache = this.cache.has(symbol);  

      // Remove from cache  
      this.cache.delete(symbol);  

      // Remove from persistent storage  
      let removedFromPersistent = false;  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          removedFromPersistent = await this.sheetsLogger.removePositionLevels(symbol);  
        } catch (persistentError) {  
          this.logger.error('Failed to remove from persistent storage', {  
            symbol,  
            error: persistentError.message  
          });  
        }  
      }  

      // LOGGING FIX: Only log if explicitly enabled
      if (this.options.enableLogging) {  
        this.logger.info('Position levels removed', {  
          symbol,  
          existedInCache,  
          removedFromPersistent  
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
   * Combines cache and persistent storage  
   * @returns {Array} Array of symbols with stored levels  
   */  
  async getAllStoredSymbols() {  
    try {  
      const symbols = new Set();  

      // Add symbols from cache  
      this.cache.forEach((data, symbol) => {  
        if (new Date(data.expires) >= new Date()) {  
          symbols.add(symbol);  
        }  
      });  

      // Add symbols from persistent storage  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          const persistentSymbols = await this.sheetsLogger.getAllStoredSymbols();  
          persistentSymbols.forEach(symbol => symbols.add(symbol));  
        } catch (persistentError) {  
          this.logger.error('Failed to get symbols from persistent storage', {  
            error: persistentError.message  
          });  
        }  
      }  

      const symbolArray = Array.from(symbols);  
      // LOGGING FIX: Only log if explicitly enabled
      if (this.options.enableLogging) {  
        this.logger.info('Retrieved all stored symbols', {  
          count: symbolArray.length,  
          symbols: symbolArray  
        });  
      }  

      return symbolArray;  
    } catch (error) {  
      this.logger.error('Failed to get all stored symbols', {  
        error: error.message  
      });  
      return [];  
    }  
  }  

  /**  
   * Get count of stored positions  
   * Prioritizes persistent storage count for accuracy  
   * @returns {number} Number of positions with stored levels  
   */  
  async getStoredPositionsCount() {  
    try {  
      // Try to get count from persistent storage first (more accurate)  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          const persistentCount = await this.sheetsLogger.getStoredPositionsCount();  
          if (persistentCount >= 0) {  
            return persistentCount;  
          }  
        } catch (persistentError) {  
          this.logger.error('Failed to get count from persistent storage', {  
            error: persistentError.message  
          });  
        }  
      }  

      // Fallback to cache count  
      let cacheCount = 0;  
      const now = new Date();  
      this.cache.forEach((data) => {  
        if (new Date(data.expires) >= now) {  
          cacheCount++;  
        }  
      });  

      return cacheCount;  
    } catch (error) {  
      this.logger.error('Failed to get stored positions count', {  
        error: error.message  
      });  
      return 0;  
    }  
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

      // Cache stats  
      this.cache.forEach((data, symbol) => {  
        if (new Date(data.expires) < now) {  
          expiredCount++;  
        } else {  
          validCount++;  
          if (data.strategy) strategies.add(data.strategy);  
          if (data.side) sides.add(data.side);  
        }  
      });  

      // Persistent storage stats  
      let persistentCount = 0;  
      if (this.options.enablePersistence && this.sheetsLogger.enabled) {  
        try {  
          persistentCount = await this.sheetsLogger.getStoredPositionsCount();  
        } catch (persistentError) {  
          this.logger.error('Failed to get persistent storage stats', {  
            error: persistentError.message  
          });  
        }  
      }  

      return {  
        cache: {  
          totalEntries: this.cache.size,  
          validEntries: validCount,  
          expiredEntries: expiredCount,  
          cacheUsagePercent: Math.round((this.cache.size / this.options.maxCacheSize) * 100)  
        },  
        persistent: {  
          totalEntries: persistentCount,  
          enabled: this.options.enablePersistence && this.sheetsLogger.enabled  
        },  
        analysis: {  
          uniqueStrategies: Array.from(strategies),  
          positionSides: Array.from(sides),  
          totalStoredPositions: Math.max(validCount, persistentCount)  
        },  
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
   * Format position data for consistent output  
   * @param {Object} data - Raw position data  
   * @returns {Object} Formatted position data  
   */  
  formatPositionData(data) {  
    return {  
      symbol: data.symbol,  
      stopLoss: data.stopLoss,  
      takeProfit: data.takeProfit,  
      entryPrice: data.entryPrice,  
      side: data.side,  
      quantity: data.quantity,  
      strategy: data.strategy,  
      orderId: data.orderId,  
      timestamp: data.timestamp,  
      lastUpdated: data.lastUpdated  
    };  
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

      // LOGGING FIX: Only log if explicitly enabled and cleanups occurred
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

    // LOGGING FIX: Only log once if explicitly enabled
    if (this.options.enableLogging && !this.cleanupStarted) {  
      this.logger.info('Cache cleanup interval started', {  
        intervalMs: 3600000  
      });  
      this.cleanupStarted = true;
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

  /**  
   * Synchronize cache with persistent storage  
   * Useful for ensuring consistency after serverless cold starts  
   */  
  async synchronizeWithPersistentStorage() {  
    if (!this.options.enablePersistence || !this.sheetsLogger.enabled) {  
      return { synchronized: 0, message: 'Persistent storage disabled' };  
    }  

    try {  
      const persistentSymbols = await this.sheetsLogger.getAllStoredSymbols();  
      let synchronized = 0;  

      for (const symbol of persistentSymbols) {  
        if (!this.cache.has(symbol)) {  
          const persistentData = await this.sheetsLogger.getPositionLevels(symbol);  
          if (persistentData) {  
            const cacheData = {  
              ...persistentData,  
              expires: new Date(Date.now() + this.options.cacheExpiryMs).toISOString()  
            };  
            this.cache.set(symbol, cacheData);  
            synchronized++;  
          }  
        }  
      }  

      // LOGGING FIX: Only log if synchronization occurred and logging is enabled
      if (synchronized > 0 && this.options.enableLogging) {  
        this.logger.info('Cache synchronized with persistent storage', {  
          synchronized,  
          totalPersistent: persistentSymbols.length,  
          totalCache: this.cache.size  
        });  
      }  

      return { synchronized, totalPersistent: persistentSymbols.length };  
    } catch (error) {  
      this.logger.error('Failed to synchronize with persistent storage', {  
        error: error.message  
      });  
      return { synchronized: 0, error: error.message };  
    }  
  }  
}
