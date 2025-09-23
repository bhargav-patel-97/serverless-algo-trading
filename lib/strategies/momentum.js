// lib/strategies/momentum.js - Momentum Trading Strategy
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
            // Get SPY data for market direction
            const spyData = await alpaca.getHistoricalData('SPY', '1Day', this.config.lookbackPeriod + 10);

            if (spyData.length < this.config.longMA + 1) {
                this.logger.warning('Insufficient SPY data for momentum analysis');
                return signals;
            }

            const spyPrices = spyData.map(bar => bar.close);

            // Calculate moving averages
            const shortMA = MovingAverages.getCurrentSMA(spyPrices, this.config.shortMA);
            const longMA = MovingAverages.getCurrentSMA(spyPrices, this.config.longMA);

            // Get previous values for crossover detection
            const prevShortMA = MovingAverages.getCurrentSMA(spyPrices.slice(0, -1), this.config.shortMA);
            const prevLongMA = MovingAverages.getCurrentSMA(spyPrices.slice(0, -1), this.config.longMA);

            this.logger.info('Momentum analysis', {
                shortMA: shortMA.toFixed(2),
                longMA: longMA.toFixed(2),
                trend: shortMA > longMA ? 'bullish' : 'bearish'
            });

            // Check for crossovers
            const bullishCrossover = MovingAverages.isMACrossover(shortMA, longMA, prevShortMA, prevLongMA);
            const bearishCrossover = MovingAverages.isMACrossunder(shortMA, longMA, prevShortMA, prevLongMA);

            if (bullishCrossover) {
                // Buy TQQQ (bullish momentum)
                const tqqqQuote = await alpaca.getQuote('TQQQ');

                signals.push({
                    symbol: 'TQQQ',
                    side: 'buy',
                    reason: 'bullish_ma_crossover',
                    currentPrice: (tqqqQuote.bid + tqqqQuote.ask) / 2,
                    positionSize: this.config.positionSize,
                    confidence: this.calculateConfidence(shortMA, longMA, spyPrices),
                    timestamp: new Date().toISOString()
                });

                this.logger.info('Bullish momentum signal generated', { symbol: 'TQQQ' });
            }

            if (bearishCrossover) {
                // Buy SQQQ (bearish momentum)
                const sqqqQuote = await alpaca.getQuote('SQQQ');

                signals.push({
                    symbol: 'SQQQ',
                    side: 'buy',
                    reason: 'bearish_ma_crossover',
                    currentPrice: (sqqqQuote.bid + sqqqQuote.ask) / 2,
                    positionSize: this.config.positionSize,
                    confidence: this.calculateConfidence(longMA, shortMA, spyPrices),
                    timestamp: new Date().toISOString()
                });

                this.logger.info('Bearish momentum signal generated', { symbol: 'SQQQ' });
            }

        } catch (error) {
            this.logger.error('Momentum strategy error', { error: error.message });
            throw error;
        }

        return signals;
    }

    calculateConfidence(strongerMA, weakerMA, prices) {
        // Calculate confidence based on MA separation and recent price action
        const separation = Math.abs(strongerMA - weakerMA) / weakerMA;
        const recentVolatility = this.calculateVolatility(prices.slice(-10));

        // Higher separation and lower volatility = higher confidence
        const confidence = Math.min(0.95, separation / recentVolatility);

        return Math.max(0.1, confidence); // Minimum 10% confidence
    }

    calculateVolatility(prices) {
        if (prices.length < 2) return 1;

        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;

        return Math.sqrt(variance);
    }
}