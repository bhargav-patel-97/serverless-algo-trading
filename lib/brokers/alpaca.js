// lib/brokers/alpaca.js - Alpaca API Integration
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
            const bars = await this.alpaca.getBarsV2(symbol, {
                timeframe,
                limit,
                asof: new Date().toISOString()
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

            return data.reverse(); // Most recent first
        } catch (error) {
            this.logger.error('Failed to get historical data', { symbol, error });
            throw error;
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
            this.logger.error('Failed to get quote', { symbol, error });
            throw error;
        }
    }
}