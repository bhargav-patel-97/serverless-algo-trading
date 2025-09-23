// lib/strategies/meanReversion.js - Mean Reversion Strategy
import { RSI } from '../indicators/rsi.js';
import { Logger } from '../utils/logger.js';

export class MeanReversionStrategy {
    constructor(config) {
        this.config = {
            enabled: config.enabled || false,
            symbols: config.symbols || ['TQQQ', 'SQQQ'],
            rsiPeriod: config.rsiPeriod || 14,
            oversoldThreshold: config.oversoldThreshold || 30,
            overboughtThreshold: config.overboughtThreshold || 70,
            positionSize: config.positionSize || 0.015,
            lookbackPeriod: config.lookbackPeriod || 50,
            minVolume: config.minVolume || 100000
        };
        this.logger = new Logger();
    }

    getName() {
        return 'Mean Reversion Strategy';
    }

    isEnabled() {
        return this.config.enabled;
    }

    async generateSignals(alpaca) {
        const signals = [];

        try {
            for (const symbol of this.config.symbols) {
                const historicalData = await alpaca.getHistoricalData(
                    symbol, 
                    '1Day', 
                    this.config.lookbackPeriod
                );

                if (historicalData.length < this.config.rsiPeriod + 5) {
                    this.logger.warning(`Insufficient data for ${symbol} RSI analysis`);
                    continue;
                }

                const prices = historicalData.map(bar => bar.close);
                const currentRSI = RSI.getCurrentRSI(prices, this.config.rsiPeriod);
                const currentPrice = prices[prices.length - 1];

                // Get current quote for more accurate pricing
                const quote = await alpaca.getQuote(symbol);
                const currentQuotePrice = (quote.bid + quote.ask) / 2;

                this.logger.info(`${symbol} RSI Analysis`, {
                    rsi: currentRSI.toFixed(2),
                    price: currentQuotePrice.toFixed(2),
                    oversoldThreshold: this.config.oversoldThreshold,
                    overboughtThreshold: this.config.overboughtThreshold
                });

                // Check for oversold condition (buy signal)
                if (RSI.isOversold(currentRSI, this.config.oversoldThreshold)) {
                    signals.push({
                        symbol: symbol,
                        side: 'buy',
                        reason: 'rsi_oversold',
                        currentPrice: currentQuotePrice,
                        positionSize: this.config.positionSize,
                        confidence: this.calculateOversoldConfidence(currentRSI),
                        rsi: currentRSI,
                        timestamp: new Date().toISOString()
                    });

                    this.logger.info(`Oversold signal generated for ${symbol}`, {
                        rsi: currentRSI,
                        threshold: this.config.oversoldThreshold
                    });
                }

                // Check for overbought condition (sell signal for TQQQ, buy signal for SQQQ)
                if (RSI.isOverbought(currentRSI, this.config.overboughtThreshold)) {
                    const side = symbol === 'TQQQ' ? 'sell' : 'buy';

                    signals.push({
                        symbol: symbol,
                        side: side,
                        reason: 'rsi_overbought',
                        currentPrice: currentQuotePrice,
                        positionSize: this.config.positionSize,
                        confidence: this.calculateOverboughtConfidence(currentRSI),
                        rsi: currentRSI,
                        timestamp: new Date().toISOString()
                    });

                    this.logger.info(`Overbought signal generated for ${symbol}`, {
                        rsi: currentRSI,
                        threshold: this.config.overboughtThreshold,
                        side
                    });
                }
            }

        } catch (error) {
            this.logger.error('Mean reversion strategy error', { error: error.message });
            throw error;
        }

        return signals;
    }

    calculateOversoldConfidence(rsi) {
        // Higher confidence as RSI gets lower below oversold threshold
        const distanceFromThreshold = Math.max(0, this.config.oversoldThreshold - rsi);
        const maxDistance = this.config.oversoldThreshold; // Max possible distance
        const confidence = 0.5 + (distanceFromThreshold / maxDistance) * 0.4; // 50-90% confidence

        return Math.min(0.95, Math.max(0.1, confidence));
    }

    calculateOverboughtConfidence(rsi) {
        // Higher confidence as RSI gets higher above overbought threshold
        const distanceFromThreshold = Math.max(0, rsi - this.config.overboughtThreshold);
        const maxDistance = 100 - this.config.overboughtThreshold; // Max possible distance
        const confidence = 0.5 + (distanceFromThreshold / maxDistance) * 0.4; // 50-90% confidence

        return Math.min(0.95, Math.max(0.1, confidence));
    }

    async checkExitConditions(alpaca, positions) {
        const exitSignals = [];

        for (const position of positions) {
            if (!this.config.symbols.includes(position.symbol)) {
                continue; // Not our position
            }

            try {
                const historicalData = await alpaca.getHistoricalData(
                    position.symbol, 
                    '1Day', 
                    this.config.lookbackPeriod
                );

                const prices = historicalData.map(bar => bar.close);
                const currentRSI = RSI.getCurrentRSI(prices, this.config.rsiPeriod);

                // Exit conditions: RSI returns to normal range
                if (position.side === 'long' && currentRSI > 50) {
                    exitSignals.push({
                        symbol: position.symbol,
                        side: 'sell',
                        reason: 'rsi_normalized_from_oversold',
                        quantity: Math.abs(parseFloat(position.qty))
                    });
                } else if (position.side === 'short' && currentRSI < 50) {
                    exitSignals.push({
                        symbol: position.symbol,
                        side: 'buy',
                        reason: 'rsi_normalized_from_overbought',
                        quantity: Math.abs(parseFloat(position.qty))
                    });
                }

            } catch (error) {
                this.logger.error(`Error checking exit conditions for ${position.symbol}`, error);
            }
        }

        return exitSignals;
    }
}