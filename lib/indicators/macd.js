// lib/indicators/atr.js - Average True Range
export class ATR {
    static calculate(ohlcData, period = 14) {
        if (ohlcData.length < period + 1) {
            throw new Error('Insufficient data for ATR calculation');
        }

        const trueRanges = [];

        // Calculate True Range for each period
        for (let i = 1; i < ohlcData.length; i++) {
            const current = ohlcData[i];
            const previous = ohlcData[i - 1];

            const tr1 = current.high - current.low;
            const tr2 = Math.abs(current.high - previous.close);
            const tr3 = Math.abs(current.low - previous.close);

            const trueRange = Math.max(tr1, tr2, tr3);
            trueRanges.push(trueRange);
        }

        const atrValues = [];

        // Calculate initial ATR (simple average of first period)
        let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
        atrValues.push(atr);

        // Calculate smoothed ATR using Wilder's smoothing method
        for (let i = period; i < trueRanges.length; i++) {
            atr = (atr * (period - 1) + trueRanges[i]) / period;
            atrValues.push(atr);
        }

        return atrValues;
    }

    static getCurrentATR(ohlcData, period = 14) {
        const atrValues = this.calculate(ohlcData, period);
        return atrValues[atrValues.length - 1];
    }

    static calculateVolatilityMultiplier(currentATR, averageATR) {
        // Returns multiplier for position sizing based on volatility
        if (averageATR === 0) return 1;

        const volatilityRatio = currentATR / averageATR;

        // Reduce position size when volatility is high
        if (volatilityRatio > 1.5) return 0.5;
        if (volatilityRatio > 1.2) return 0.75;
        if (volatilityRatio < 0.8) return 1.2;

        return 1;
    }

    static calculateStopLoss(entryPrice, atr, multiplier = 2, side = 'buy') {
        if (side === 'buy') {
            return entryPrice - (atr * multiplier);
        } else {
            return entryPrice + (atr * multiplier);
        }
    }

    static isHighVolatility(currentATR, historicalATR, threshold = 1.5) {
        return currentATR > (historicalATR * threshold);
    }

    static getVolatilityRank(atrValues, lookbackPeriod = 50) {
        if (atrValues.length < lookbackPeriod + 1) {
            return 0.5; // Default middle rank if insufficient data
        }

        const recentATR = atrValues[atrValues.length - 1];
        const historicalATRs = atrValues.slice(-lookbackPeriod - 1, -1);

        // Count how many historical values are below current ATR
        const belowCount = historicalATRs.filter(atr => atr < recentATR).length;

        // Return percentile rank (0 = lowest volatility, 1 = highest volatility)
        return belowCount / historicalATRs.length;
    }
}