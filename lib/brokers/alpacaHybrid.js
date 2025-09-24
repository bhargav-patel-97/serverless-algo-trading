// lib/brokers/alpacaHybrid.js - Hybrid Alpaca API with Real Market Data
import Alpaca from '@alpacahq/alpaca-trade-api';
import { MarketDataService } from '../services/marketDataService.js';
import { Logger } from '../utils/logger.js';

export class AlpacaHybridApi {
    constructor(config) {
        this.alpaca = new Alpaca(config);
        this.marketData = new MarketDataService();
        this.logger = new Logger();
        this.config = config;

        this.logger.info('Hybrid Alpaca API initialized', {
            mode: config.paper ? 'Paper Trading' : 'Live Trading',
            dataSource: 'Real market data from free APIs'
        });
    }

    // Account and position management uses Alpaca directly
    async getAccount() {
        try {
            const account = await this.alpaca.getAccount();
            this.logger.info('Account info retrieved from Alpaca', {
                equity: parseFloat(account.equity),
                buyingPower: parseFloat(account.buying_power),
                status: account.status
            });
            return account;
        } catch (error) {
            this.logger.error('Failed to get account info from Alpaca', error);
            throw error;
        }
    }

    async getPositions() {
        try {
            const positions = await this.alpaca.getPositions();
            this.logger.info('Positions retrieved from Alpaca', {
                count: positions.length,
                symbols: positions.map(p => p.symbol)
            });
            return positions;
        } catch (error) {
            this.logger.error('Failed to get positions from Alpaca', error);
            throw error;
        }
    }

    async getOrders(status = 'open') {
        try {
            return await this.alpaca.getOrders({ status });
        } catch (error) {
            this.logger.error('Failed to get orders from Alpaca', error);
            throw error;
        }
    }

    // Trading execution uses Alpaca
    async submitOrder(orderData) {
        try {
            this.logger.info('Submitting order to Alpaca', {
                symbol: orderData.symbol,
                qty: orderData.qty,
                side: orderData.side,
                type: orderData.type || 'market'
            });

            const order = await this.alpaca.createOrder({
                symbol: orderData.symbol,
                qty: orderData.qty,
                side: orderData.side,
                type: orderData.type || 'market',
                time_in_force: orderData.time_in_force || 'day'
            });

            this.logger.success('Order submitted successfully to Alpaca', { 
                orderId: order.id,
                symbol: order.symbol,
                qty: order.qty,
                side: order.side,
                status: order.status
            });

            return order;
        } catch (error) {
            this.logger.error('Failed to submit order to Alpaca', { 
                orderData,
                error: error.message 
            });
            throw error;
        }
    }

    async cancelOrder(orderId) {
        try {
            await this.alpaca.cancelOrder(orderId);
            this.logger.info('Order cancelled in Alpaca', { orderId });
        } catch (error) {
            this.logger.error('Failed to cancel order in Alpaca', { orderId, error });
            throw error;
        }
    }

    // Market data uses real external APIs instead of Alpaca
    async getHistoricalData(symbol, timeframe = '1Day', limit = 100) {
        try {
            this.logger.info('Fetching historical data from real market sources', {
                symbol,
                timeframe,
                limit,
                source: 'Free market APIs (not Alpaca)'
            });

            // Use MarketDataService for real market data
            const data = await this.marketData.getHistoricalData(symbol, limit);

            if (data && data.length > 0) {
                this.logger.info('Real historical data retrieved successfully', {
                    symbol,
                    bars: data.length,
                    source: 'External market data APIs',
                    dateRange: {
                        from: data[data.length - 1]?.timestamp,
                        to: data[0]?.timestamp
                    },
                    latestPrice: data[0]?.close
                });

                return data;
            } else {
                this.logger.warning('No historical data available', { symbol });
                return [];
            }

        } catch (error) {
            this.logger.error('Failed to get historical data from market sources', {
                symbol,
                timeframe,
                limit,
                error: error.message
            });

            // Return empty array instead of throwing to prevent strategy crashes
            return [];
        }
    }

    // Real-time quotes use external APIs for accurate pricing
    async getQuote(symbol) {
        try {
            this.logger.info('Fetching real-time quote from market sources', {
                symbol,
                source: 'Free market APIs (not Alpaca)'
            });

            // Use MarketDataService for real-time quotes
            const quote = await this.marketData.getCurrentQuote(symbol);

            if (quote) {
                this.logger.info('Real-time quote retrieved successfully', {
                    symbol: quote.symbol,
                    price: ((quote.bid + quote.ask) / 2).toFixed(2),
                    spread: (quote.ask - quote.bid).toFixed(4),
                    source: 'External market data APIs'
                });

                return quote;
            }

        } catch (error) {
            this.logger.error('Failed to get quote from market sources, trying Alpaca fallback', {
                symbol,
                error: error.message
            });

            // Fallback to Alpaca if external sources fail
            try {
                const alpacaQuote = await this.alpaca.getLatestQuote(symbol);

                const quote = {
                    symbol,
                    bid: alpacaQuote.BidPrice || 0,
                    ask: alpacaQuote.AskPrice || 0,
                    bidSize: alpacaQuote.BidSize || 0,
                    askSize: alpacaQuote.AskSize || 0,
                    timestamp: alpacaQuote.Timestamp || new Date().toISOString()
                };

                this.logger.info('Quote retrieved from Alpaca fallback', {
                    symbol: quote.symbol,
                    price: ((quote.bid + quote.ask) / 2).toFixed(2),
                    source: 'Alpaca API (fallback)'
                });

                return quote;

            } catch (alpacaError) {
                this.logger.error('Alpaca quote fallback also failed', {
                    symbol,
                    error: alpacaError.message
                });

                // Last resort: get latest price from historical data
                try {
                    const historicalData = await this.getHistoricalData(symbol, 1);
                    if (historicalData && historicalData.length > 0) {
                        const latestBar = historicalData[0];
                        const price = latestBar.close;

                        const quote = {
                            symbol,
                            bid: price * 0.9995,
                            ask: price * 1.0005,
                            bidSize: 100,
                            askSize: 100,
                            timestamp: latestBar.timestamp
                        };

                        this.logger.info('Quote derived from historical data', {
                            symbol: quote.symbol,
                            price: price.toFixed(2),
                            source: 'Historical data (last resort)'
                        });

                        return quote;
                    }
                } catch (historicalError) {
                    this.logger.error('All quote sources failed', {
                        symbol,
                        error: historicalError.message
                    });
                }

                throw new Error(`Unable to get quote for ${symbol} from any source`);
            }
        }
    }

    // Market status can use Alpaca or external source
    async isMarketOpen() {
        try {
            // Try Alpaca first for market status
            const clock = await this.alpaca.getClock();
            const isOpen = clock.is_open;

            this.logger.info('Market status retrieved from Alpaca', {
                isOpen,
                nextOpen: clock.next_open,
                nextClose: clock.next_close
            });

            return isOpen;
        } catch (error) {
            this.logger.error('Failed to get market status from Alpaca, using fallback', error);

            // Fallback: check based on time (rough estimate)
            const now = new Date();
            const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
            const hour = now.getUTCHours();
            const minute = now.getUTCMinutes();

            // Convert to EST (UTC-5) or EDT (UTC-4) - simplified to UTC-5
            const estHour = (hour - 5 + 24) % 24;

            // Monday = 1, Friday = 5
            if (day < 1 || day > 5) {
                this.logger.info('Market closed - weekend', { day });
                return false;
            }

            // Market hours: 9:30 AM - 4:00 PM EST
            const timeMinutes = estHour * 60 + minute;
            const marketOpen = 9 * 60 + 30; // 9:30 AM
            const marketClose = 16 * 60; // 4:00 PM

            const isOpen = timeMinutes >= marketOpen && timeMinutes < marketClose;

            this.logger.info('Market status estimated from time', {
                isOpen,
                estTime: `${estHour}:${minute.toString().padStart(2, '0')}`,
                source: 'Time-based estimation'
            });

            return isOpen;
        }
    }

    // Enhanced order submission with real-time price validation
    async submitOrderWithPriceValidation(orderData) {
        try {
            // Get real-time quote to validate price
            const quote = await this.getQuote(orderData.symbol);
            const currentPrice = (quote.bid + quote.ask) / 2;

            // Add price validation for market orders
            if (orderData.type === 'market' || !orderData.type) {
                const maxPriceDeviation = 0.02; // 2% max deviation allowed

                if (orderData.estimatedPrice) {
                    const priceDeviation = Math.abs(currentPrice - orderData.estimatedPrice) / orderData.estimatedPrice;

                    if (priceDeviation > maxPriceDeviation) {
                        this.logger.warning('Price moved significantly since signal generation', {
                            symbol: orderData.symbol,
                            estimatedPrice: orderData.estimatedPrice,
                            currentPrice,
                            deviation: (priceDeviation * 100).toFixed(2) + '%'
                        });

                        // Could implement price protection here
                        // For now, we'll proceed but log the deviation
                    }
                }

                // Log the current market conditions
                this.logger.info('Order price validation completed', {
                    symbol: orderData.symbol,
                    currentPrice: currentPrice.toFixed(2),
                    side: orderData.side,
                    spread: (quote.ask - quote.bid).toFixed(4),
                    marketConditions: 'Validated against real-time quote'
                });
            }

            // Submit order to Alpaca
            return await this.submitOrder(orderData);

        } catch (error) {
            this.logger.error('Order submission with price validation failed', {
                orderData,
                error: error.message
            });
            throw error;
        }
    }

    // Get comprehensive data source status
    getDataSourceInfo() {
        const marketDataStatus = this.marketData.getDataSourceStatus();

        return {
            tradingExecution: {
                broker: 'Alpaca Markets',
                mode: this.config.paper ? 'Paper Trading' : 'Live Trading',
                status: 'Connected'
            },
            marketData: {
                primary: 'External Real Market Data APIs',
                sources: marketDataStatus,
                fallback: 'Alpaca API (when external fails)'
            },
            advantages: [
                'Real market prices for strategy decisions',
                'Alpaca execution for reliable order handling',
                'Multiple data source redundancy',
                'Rate limiting and usage optimization',
                'Automatic failover between sources'
            ]
        };
    }

    // Health check method
    async performHealthCheck() {
        const healthCheck = {
            timestamp: new Date().toISOString(),
            alpaca: { status: 'unknown' },
            marketData: { status: 'unknown' },
            overall: 'unknown'
        };

        try {
            // Test Alpaca connection
            await this.alpaca.getAccount();
            healthCheck.alpaca = {
                status: 'connected',
                service: 'Alpaca Markets API',
                capabilities: ['Trading', 'Account Management', 'Position Tracking']
            };
        } catch (error) {
            healthCheck.alpaca = {
                status: 'failed',
                error: error.message
            };
        }

        try {
            // Test market data sources
            const testSymbol = 'SPY';
            const quote = await this.marketData.getCurrentQuote(testSymbol);
            healthCheck.marketData = {
                status: 'connected',
                service: 'External Market Data APIs',
                capabilities: ['Real-time Quotes', 'Historical Data'],
                testQuote: {
                    symbol: testSymbol,
                    price: ((quote.bid + quote.ask) / 2).toFixed(2)
                },
                sources: this.marketData.getDataSourceStatus()
            };
        } catch (error) {
            healthCheck.marketData = {
                status: 'degraded',
                error: error.message,
                fallback: 'Will use Alpaca data if needed'
            };
        }

        // Overall status
        if (healthCheck.alpaca.status === 'connected' && healthCheck.marketData.status === 'connected') {
            healthCheck.overall = 'healthy';
        } else if (healthCheck.alpaca.status === 'connected') {
            healthCheck.overall = 'degraded';
        } else {
            healthCheck.overall = 'unhealthy';
        }

        this.logger.info('Health check completed', healthCheck);
        return healthCheck;
    }
}