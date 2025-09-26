// lib/utils/logger.js - Enhanced Logging System with Google Sheets Integration
export class Logger {
  constructor(context = 'AlgoTrading') {
    this.context = context;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.sheetsLogger = null; // Will be set externally to avoid circular imports
    this.logBuffer = []; // Buffer for batch logging
    this.bufferSize = parseInt(process.env.LOG_BUFFER_SIZE) || 10;
    this.bufferTimeout = parseInt(process.env.LOG_BUFFER_TIMEOUT) || 30000; // 30 seconds
    this.bufferTimer = null;
  }

  // Set the Google Sheets logger reference
  setSheetsLogger(sheetsLogger) {
    this.sheetsLogger = sheetsLogger;
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  log(level, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      context: this.context,
      message,
      data: typeof data === 'object' ? data : { data },
      strategy: data.strategy || null,
      symbol: data.symbol || null,
      orderId: data.orderId || null
    };

    // Always log to console for serverless environment
    console.log(JSON.stringify(logEntry));

    // Add to buffer for Google Sheets logging
    if (this.sheetsLogger && this.shouldPersistLog(level)) {
      this.addToBuffer(logEntry);
    }

    return logEntry;
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  debug(message, data) {
    if (this.shouldLog('debug')) {
      return this.log('debug', message, data);
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  info(message, data) {
    if (this.shouldLog('info')) {
      return this.log('info', message, data);
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  warning(message, data) {
    if (this.shouldLog('warning')) {
      return this.log('warning', message, data);
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  error(message, data) {
    if (this.shouldLog('error')) {
      return this.log('error', message, data);
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  success(message, data) {
    if (this.shouldLog('info')) {
      return this.log('success', message, data);
    }
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  shouldLog(level) {
    const levels = ['debug', 'info', 'warning', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  // EXISTING FUNCTIONALITY - PRESERVED
  setContext(context) {
    this.context = context;
  }

  // NEW FUNCTIONALITY - Determine if log should be persisted to Google Sheets
  shouldPersistLog(level) {
    const persistLevels = ['info', 'warning', 'error', 'success'];
    return persistLevels.includes(level.toLowerCase());
  }

  // NEW FUNCTIONALITY - Add log to buffer for batch processing
  addToBuffer(logEntry) {
    this.logBuffer.push(logEntry);
    
    // Flush buffer if it's full
    if (this.logBuffer.length >= this.bufferSize) {
      this.flushBuffer();
    } else if (!this.bufferTimer) {
      // Set timer to flush buffer periodically
      this.bufferTimer = setTimeout(() => {
        this.flushBuffer();
      }, this.bufferTimeout);
    }
  }

  // NEW FUNCTIONALITY - Flush log buffer to Google Sheets
  async flushBuffer() {
    if (this.logBuffer.length === 0 || !this.sheetsLogger) {
      return;
    }

    const logsToFlush = [...this.logBuffer];
    this.logBuffer = []; // Clear buffer
    
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }

    try {
      await this.sheetsLogger.logBatchEntries(logsToFlush);
    } catch (error) {
      console.error('Failed to flush log buffer to Google Sheets:', error.message);
      // Don't re-add to buffer to avoid infinite loops
    }
  }

  // NEW FUNCTIONALITY - Force flush buffer (useful for end of execution)
  async forceFlush() {
    await this.flushBuffer();
  }

  // NEW FUNCTIONALITY - Create structured log entry for trading events
  logTrade(tradeData) {
    return this.info('Trade execution', {
      symbol: tradeData.symbol,
      side: tradeData.side,
      quantity: tradeData.quantity,
      price: tradeData.price,
      strategy: tradeData.strategy,
      orderId: tradeData.orderId,
      type: 'trade'
    });
  }

  // NEW FUNCTIONALITY - Log strategy signal
  logSignal(signalData) {
    return this.info('Strategy signal generated', {
      symbol: signalData.symbol,
      strategy: signalData.strategy,
      signal: signalData.signal,
      confidence: signalData.confidence,
      type: 'signal'
    });
  }

  // NEW FUNCTIONALITY - Log system event
  logSystem(eventData) {
    return this.info('System event', {
      event: eventData.event,
      status: eventData.status,
      details: eventData.details,
      type: 'system'
    });
  }

  // NEW FUNCTIONALITY - Log error with enhanced context
  logError(error, context = {}) {
    return this.error('System error', {
      errorMessage: error.message,
      errorStack: error.stack,
      context: context,
      type: 'error'
    });
  }
}