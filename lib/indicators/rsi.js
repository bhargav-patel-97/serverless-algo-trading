// lib/indicators/movingAverages.js - Moving Average Calculations
export class MovingAverages {
    static sma(prices, period) {
        if (prices.length < period) {
            throw new Error('Insufficient data for SMA calculation');
        }

        const smaValues = [];
        for (let i = period - 1; i < prices.length; i++) {
            const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            smaValues.push(sum / period);
        }
        return smaValues;
    }

    static ema(prices, period) {
        if (prices.length < period) {
            throw new Error('Insufficient data for EMA calculation');
        }

        const multiplier = 2 / (period + 1);
        const emaValues = [];

        // Start with SMA for first value
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        emaValues.push(ema);

        // Calculate EMA for remaining values
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
            emaValues.push(ema);
        }

        return emaValues;
    }

    static getCurrentSMA(prices, period) {
        const smaValues = this.sma(prices, period);
        return smaValues[smaValues.length - 1];
    }

    static getCurrentEMA(prices, period) {
        const emaValues = this.ema(prices, period);
        return emaValues[emaValues.length - 1];
    }

    static isMACrossover(shortMA, longMA, prevShortMA, prevLongMA) {
        // Bullish crossover: short MA crosses above long MA
        return shortMA > longMA && prevShortMA <= prevLongMA;
    }

    static isMACrossunder(shortMA, longMA, prevShortMA, prevLongMA) {
        // Bearish crossover: short MA crosses below long MA
        return shortMA < longMA && prevShortMA >= prevLongMA;
    }
}