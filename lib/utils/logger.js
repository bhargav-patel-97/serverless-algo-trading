// lib/utils/logger.js - Logging System
export class Logger {
    constructor(context = 'AlgoTrading') {
        this.context = context;
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }

    log(level, message, data = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            context: this.context,
            message,
            data: typeof data === 'object' ? data : { data }
        };

        // In serverless environment, use console for logs
        console.log(JSON.stringify(logEntry));

        return logEntry;
    }

    debug(message, data) {
        if (this.shouldLog('debug')) {
            return this.log('debug', message, data);
        }
    }

    info(message, data) {
        if (this.shouldLog('info')) {
            return this.log('info', message, data);
        }
    }

    warning(message, data) {
        if (this.shouldLog('warning')) {
            return this.log('warning', message, data);
        }
    }

    error(message, data) {
        if (this.shouldLog('error')) {
            return this.log('error', message, data);
        }
    }

    success(message, data) {
        if (this.shouldLog('info')) {
            return this.log('success', message, data);
        }
    }

    shouldLog(level) {
        const levels = ['debug', 'info', 'warning', 'error'];
        const currentLevelIndex = levels.indexOf(this.logLevel);
        const messageLevelIndex = levels.indexOf(level);

        return messageLevelIndex >= currentLevelIndex;
    }

    setContext(context) {
        this.context = context;
    }
}