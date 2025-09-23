// lib/indicators/rsi.js - Relative Strength Index
export class RSI {
    static calculate(prices, period = 14) {
        if (prices.length < period + 1) {
            throw new Error('Insufficient data for RSI calculation');
        }

        const gains = [];
        const losses = [];

        // Calculate price changes
        for (let i = 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }

        // Calculate initial averages
        let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

        const rsiValues = [];

        // Calculate RSI for each period
        for (let i = period; i < gains.length; i++) {
            // Smoothed moving average
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

            const rs = avgGain / avgLoss;
            const rsi = 100 - (100 / (1 + rs));

            rsiValues.push(rsi);
        }

        return rsiValues;
    }

    static getCurrentRSI(prices, period = 14) {
        const rsiValues = this.calculate(prices, period);
        return rsiValues[rsiValues.length - 1];
    }

    static isOversold(rsi, threshold = 30) {
        return rsi < threshold;
    }

    static isOverbought(rsi, threshold = 70) {
        return rsi > threshold;
    }
}