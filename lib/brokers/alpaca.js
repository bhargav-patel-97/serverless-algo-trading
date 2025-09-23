// lib/brokers/alpaca.js - Fixed Alpaca API Integration
import Alpaca from '@alpacahq/alpaca-trade-api';
import { Logger } from '../utils/logger.js';

export class AlpacaApi {
    constructor(config) {
        this.alpaca = new Alpaca(config);
        this.logger = new Logger();
        this.config = config;
    }

    async getAccount() {
        try {
            return await this.alpaca.getAccount();
        } catch (error) {
            this.logger.error('Failed to get account info', error);
            throw error;
        }
    }

    async getPositions() {
        try {
            return await this.alpaca.getPositions();
        } catch (error) {
            this.logger.error('Failed to get positions', error);
            throw error;
        }
    }

    async getOrders(status = 'open') {
        try {
            return await this.alpaca.getOrders({ status });
        } catch (error) {
            this.logger.error('Failed to get orders', error);
            throw error;
        }
    }

    async submitOrder(orderData) {
        try {
            this.logger.info('Submitting order', orderData);

            const order = await this.alpaca.createOrder({
                symbol: orderData.symbol,
                qty: orderData.qty,
                side: orderData.side,
                type: orderData.type || 'market',
                time_in_force: orderData.time_in_force || 'day'
            });

            this.logger.success('Order submitted successfully', { 
                orderId: order.id,
                symbol: order.symbol,
                qty: order.qty,
                side: order.side
            });

            return order;
        } catch (error) {
            this.logger.error('Failed to submit order', { 
                orderData,
                error: error.message 
            });
            throw error;
        }
    }

    async cancelOrder(orderId) {
        try {
            await this.alpaca.cancelOrder(orderId);
            this.logger.info('Order cancelled', { orderId });
        } catch (error) {
            this.logger.error('Failed to cancel order', { orderId, error });
            throw error;
        }
    }

    async getHistoricalData(symbol, timeframe = '1Day', limit = 100) {
        try {
            // Fix: Don't use asof parameter, let Alpaca use the latest available data
            // Also handle market hours and weekends properly

            const now = new Date();
            let endDate = new Date(now);

            // If it's weekend or after market hours, get data from last trading day
            if (now.getDay() === 0) { // Sunday
                endDate.setDate(endDate.getDate() - 2); // Friday
            } else if (now.getDay() === 6) { // Saturday  
                endDate.setDate(endDate.getDate() - 1); // Friday
            } else if (now.getHours() < 9 || (now.getHours() >= 16 && now.getMinutes() >= 30)) {
                // Before market open or after market close, use previous day
                endDate.setDate(endDate.getDate() - 1);
            }

            // Format date properly for Alpaca API (YYYY-MM-DD)
            const endDateStr = endDate.toISOString().split('T')[0];

            this.logger.info('Requesting historical data', {
                symbol,
                timeframe,
                limit,
                endDate: endDateStr
            });

            const bars = await this.alpaca.getBarsV2(symbol, {
                timeframe: timeframe,
                limit: limit,
                // Remove asof parameter - let Alpaca handle this
                end: endDateStr
            });

            const data = [];
            for await (const bar of bars) {
                data.push({
                    timestamp: bar.Timestamp,
                    open: bar.OpenPrice,
                    high: bar.HighPrice,
                    low: bar.LowPrice,
                    close: bar.ClosePrice,
                    volume: bar.Volume
                });
            }

            this.logger.info('Historical data retrieved successfully', {
                symbol,
                bars: data.length,
                dateRange: data.length > 0 ? {
                    from: data[0].timestamp,
                    to: data[data.length - 1].timestamp
                } : null
            });

            return data.reverse(); // Most recent first
        } catch (error) {
            this.logger.error('Failed to get historical data', { 
                symbol, 
                timeframe,
                limit,
                error: error.message,
                stack: error.stack
            });

            // Return empty array instead of throwing to prevent strategy crashes
            return [];
        }
    }

    async getQuote(symbol) {
        try {
            const quote = await this.alpaca.getLatestQuote(symbol);
            return {
                symbol,
                bid: quote.BidPrice,
                ask: quote.AskPrice,
                bidSize: quote.BidSize,
                askSize: quote.AskSize,
                timestamp: quote.Timestamp
            };
        } catch (error) {
            this.logger.error('Failed to get quote', { symbol, error: error.message });

            // Fallback: try to get last trade price
            try {
                const trade = await this.alpaca.getLatestTrade(symbol);
                const price = trade.Price;
                return {
                    symbol,
                    bid: price * 0.999,
                    ask: price * 1.001,
                    bidSize: 100,
                    askSize: 100,
                    timestamp: trade.Timestamp
                };
            } catch (tradeError) {
                this.logger.error('Failed to get trade data as fallback', { symbol, error: tradeError.message });
                throw error;
            }
        }
    }

    // Add method to check if market is open
    async isMarketOpen() {
        try {
            const clock = await this.alpaca.getClock();
            return clock.is_open;
        } catch (error) {
            this.logger.error('Failed to get market status', error);

            // Fallback: check based on time (rough estimate)
            const now = new Date();
            const day = now.getDay();
            const hour = now.getHours();
            const minute = now.getMinutes();

            // Monday = 1, Friday = 5
            if (day < 1 || day > 5) return false;

            // Rough market hours: 9:30 AM - 4:00 PM ET
            const timeMinutes = hour * 60 + minute;
            const marketOpen = 9 * 60 + 30; // 9:30 AM
            const marketClose = 16 * 60; // 4:00 PM

            return timeMinutes >= marketOpen && timeMinutes < marketClose;
        }
    }
}