// lib/indicators/rsi.js - Relative Strength Index Calculations

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

        const rsiValues = [];

        // Calculate initial average gain and loss
        let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

        // Calculate first RSI value
        let rs = avgGain / (avgLoss === 0 ? 0.0001 : avgLoss);
        rsiValues.push(100 - (100 / (1 + rs)));

        // Calculate subsequent RSI values using smoothed averages
        for (let i = period; i < gains.length; i++) {
            avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
            avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
            
            rs = avgGain / (avgLoss === 0 ? 0.0001 : avgLoss);
            rsiValues.push(100 - (100 / (1 + rs)));
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

    static getSignal(prices, period = 14, oversoldThreshold = 30, overboughtThreshold = 70) {
        const currentRSI = this.getCurrentRSI(prices, period);
        
        if (this.isOversold(currentRSI, oversoldThreshold)) {
            return { signal: 'BUY', rsi: currentRSI, reason: 'Oversold condition' };
        } else if (this.isOverbought(currentRSI, overboughtThreshold)) {
            return { signal: 'SELL', rsi: currentRSI, reason: 'Overbought condition' };
        } else {
            return { signal: 'HOLD', rsi: currentRSI, reason: 'Neutral condition' };
        }
    }
}

// Named export for ESM compatibility
export { RSI };
