// lib/strategies/momentum.js - Fixed Momentum Trading Strategy
import { MovingAverages } from '../indicators/movingAverages.js';
import { Logger } from '../utils/logger.js';

export class MomentumStrategy {
    constructor(config) {
        this.config = {
            enabled: config.enabled || false,
            symbols: config.symbols || ['TQQQ', 'SQQQ'],
            lookbackPeriod: config.lookbackPeriod || 50,
            shortMA: config.shortMA || 20,
            longMA: config.longMA || 50,
            positionSize: config.positionSize || 0.02,
            minVolume: config.minVolume || 100000
        };
        this.logger = new Logger();
    }

    getName() {
        return 'Momentum Strategy';
    }

    isEnabled() {
        return this.config.enabled;
    }

    async generateSignals(alpaca) {
        const signals = [];

        try {
            // Check if market is open (optional check)
            const isMarketOpen = await alpaca.isMarketOpen();
            this.logger.info('Market status check', { isMarketOpen });

            // Get SPY data for market direction with better error handling
            this.logger.info('Requesting SPY historical data', {
                lookbackPeriod: this.config.lookbackPeriod + 10
            });

            const spyData = await alpaca.getHistoricalData('SPY', '1Day', this.config.lookbackPeriod + 10);

            if (!spyData || spyData.length === 0) {
                this.logger.warning('No SPY data received - markets may be closed or data unavailable');
                return signals;
            }

            if (spyData.length < this.config.longMA + 1) {
                this.logger.warning('Insufficient SPY data for momentum analysis', {
                    received: spyData.length,
                    required: this.config.longMA + 1
                });
                return signals;
            }

            const spyPrices = spyData.map(bar => bar.close);

            this.logger.info('SPY data analysis', {
                barsReceived: spyData.length,
                dateRange: {
                    from: spyData[0].timestamp,
                    to: spyData[spyData.length - 1].timestamp
                },
                latestPrice: spyPrices[spyPrices.length - 1]
            });

            // Calculate moving averages with error handling
            let shortMA, longMA, prevShortMA, prevLongMA;

            try {
                shortMA = MovingAverages.getCurrentSMA(spyPrices, this.config.shortMA);
                longMA = MovingAverages.getCurrentSMA(spyPrices, this.config.longMA);

                // Get previous values for crossover detection
                prevShortMA = MovingAverages.getCurrentSMA(spyPrices.slice(0, -1), this.config.shortMA);
                prevLongMA = MovingAverages.getCurrentSMA(spyPrices.slice(0, -1), this.config.longMA);
            } catch (maError) {
                this.logger.error('Moving average calculation failed', {
                    error: maError.message,
                    pricesLength: spyPrices.length,
                    shortMA: this.config.shortMA,
                    longMA: this.config.longMA
                });
                return signals;
            }

            this.logger.info('Momentum analysis', {
                shortMA: shortMA.toFixed(2),
                longMA: longMA.toFixed(2),
                prevShortMA: prevShortMA.toFixed(2),
                prevLongMA: prevLongMA.toFixed(2),
                trend: shortMA > longMA ? 'bullish' : 'bearish'
            });

            // Check for crossovers
            const bullishCrossover = MovingAverages.isMACrossover(shortMA, longMA, prevShortMA, prevLongMA);
            const bearishCrossover = MovingAverages.isMACrossunder(shortMA, longMA, prevShortMA, prevLongMA);

            if (bullishCrossover) {
                this.logger.info('Bullish crossover detected - generating TQQQ buy signal');

                try {
                    const tqqqQuote = await alpaca.getQuote('TQQQ');

                    signals.push({
                        symbol: 'TQQQ',
                        side: 'buy',
                        reason: 'bullish_ma_crossover',
                        currentPrice: (tqqqQuote.bid + tqqqQuote.ask) / 2,
                        positionSize: this.config.positionSize,
                        confidence: this.calculateConfidence(shortMA, longMA, spyPrices),
                        timestamp: new Date().toISOString(),
                        maData: {
                            shortMA: shortMA.toFixed(2),
                            longMA: longMA.toFixed(2),
                            separation: ((shortMA - longMA) / longMA * 100).toFixed(2) + '%'
                        }
                    });

                    this.logger.info('Bullish momentum signal generated', { 
                        symbol: 'TQQQ',
                        price: ((tqqqQuote.bid + tqqqQuote.ask) / 2).toFixed(2)
                    });
                } catch (quoteError) {
                    this.logger.error('Failed to get TQQQ quote', { error: quoteError.message });
                }
            }

            if (bearishCrossover) {
                this.logger.info('Bearish crossover detected - generating SQQQ buy signal');

                try {
                    const sqqqQuote = await alpaca.getQuote('SQQQ');

                    signals.push({
                        symbol: 'SQQQ',
                        side: 'buy',
                        reason: 'bearish_ma_crossover',
                        currentPrice: (sqqqQuote.bid + sqqqQuote.ask) / 2,
                        positionSize: this.config.positionSize,
                        confidence: this.calculateConfidence(longMA, shortMA, spyPrices),
                        timestamp: new Date().toISOString(),
                        maData: {
                            shortMA: shortMA.toFixed(2),
                            longMA: longMA.toFixed(2),
                            separation: ((longMA - shortMA) / shortMA * 100).toFixed(2) + '%'
                        }
                    });

                    this.logger.info('Bearish momentum signal generated', { 
                        symbol: 'SQQQ',
                        price: ((sqqqQuote.bid + sqqqQuote.ask) / 2).toFixed(2)
                    });
                } catch (quoteError) {
                    this.logger.error('Failed to get SQQQ quote', { error: quoteError.message });
                }
            }

            if (!bullishCrossover && !bearishCrossover) {
                this.logger.info('No crossover signals detected', {
                    shortMA: shortMA.toFixed(2),
                    longMA: longMA.toFixed(2),
                    trend: shortMA > longMA ? 'bullish' : 'bearish'
                });
            }

        } catch (error) {
            this.logger.error('Momentum strategy error', { 
                error: error.message,
                stack: error.stack
            });
            // Don't throw error - return empty signals array to prevent system crash
        }

        this.logger.info('Momentum strategy completed', { 
            signalsGenerated: signals.length 
        });

        return signals;
    }

    calculateConfidence(strongerMA, weakerMA, prices) {
        try {
            // Calculate confidence based on MA separation and recent price action
            const separation = Math.abs(strongerMA - weakerMA) / weakerMA;
            const recentVolatility = this.calculateVolatility(prices.slice(-10));

            // Higher separation and lower volatility = higher confidence
            const confidence = Math.min(0.95, separation / recentVolatility);

            return Math.max(0.1, confidence); // Minimum 10% confidence
        } catch (error) {
            this.logger.error('Confidence calculation error', { error: error.message });
            return 0.5; // Default 50% confidence
        }
    }

    calculateVolatility(prices) {
        try {
            if (prices.length < 2) return 1;

            const returns = [];
            for (let i = 1; i < prices.length; i++) {
                returns.push((prices[i] - prices[i-1]) / prices[i-1]);
            }

            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;

            return Math.sqrt(variance);
        } catch (error) {
            this.logger.error('Volatility calculation error', { error: error.message });
            return 1; // Default volatility
        }
    }
}