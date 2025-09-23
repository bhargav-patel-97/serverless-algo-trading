// lib/indicators/macd.js - MACD Indicator
import { MovingAverages } from './movingAverages.js';

export class MACD {
    static calculate(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (prices.length < slowPeriod + signalPeriod) {
            throw new Error('Insufficient data for MACD calculation');
        }

        // Calculate fast and slow EMAs
        const fastEMA = MovingAverages.ema(prices, fastPeriod);
        const slowEMA = MovingAverages.ema(prices, slowPeriod);

        // Align arrays (slowEMA starts later)
        const startIndex = slowPeriod - fastPeriod;
        const alignedFastEMA = fastEMA.slice(startIndex);

        // Calculate MACD line (fast EMA - slow EMA)
        const macdLine = [];
        for (let i = 0; i < slowEMA.length; i++) {
            macdLine.push(alignedFastEMA[i] - slowEMA[i]);
        }

        // Calculate signal line (EMA of MACD line)
        const signalLine = MovingAverages.ema(macdLine, signalPeriod);

        // Calculate histogram (MACD - Signal)
        const histogram = [];
        const histogramStartIndex = macdLine.length - signalLine.length;

        for (let i = 0; i < signalLine.length; i++) {
            const macdValue = macdLine[histogramStartIndex + i];
            histogram.push(macdValue - signalLine[i]);
        }

        return {
            macd: macdLine.slice(histogramStartIndex),
            signal: signalLine,
            histogram: histogram
        };
    }

    static getCurrentMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const result = this.calculate(prices, fastPeriod, slowPeriod, signalPeriod);
        return {
            macd: result.macd[result.macd.length - 1],
            signal: result.signal[result.signal.length - 1],
            histogram: result.histogram[result.histogram.length - 1]
        };
    }

    static isBullishCrossover(current, previous) {
        // MACD line crosses above signal line
        return current.macd > current.signal && previous.macd <= previous.signal;
    }

    static isBearishCrossover(current, previous) {
        // MACD line crosses below signal line  
        return current.macd < current.signal && previous.macd >= previous.signal;
    }

    static isDivergence(prices, macdValues, type = 'bullish') {
        if (prices.length < 10 || macdValues.length < 10) {
            return false;
        }

        const recentPrices = prices.slice(-10);
        const recentMACD = macdValues.slice(-10);

        if (type === 'bullish') {
            // Price makes lower lows, MACD makes higher lows
            const priceMinIndex = recentPrices.indexOf(Math.min(...recentPrices));
            const macdMinIndex = recentMACD.indexOf(Math.min(...recentMACD));

            return priceMinIndex > macdMinIndex; // Price low is more recent
        } else {
            // Price makes higher highs, MACD makes lower highs
            const priceMaxIndex = recentPrices.indexOf(Math.max(...recentPrices));
            const macdMaxIndex = recentMACD.indexOf(Math.max(...recentMACD));

            return priceMaxIndex > macdMaxIndex; // Price high is more recent
        }
    }

    static getSignalStrength(current) {
        // Strength based on histogram magnitude and MACD position
        const histogramStrength = Math.abs(current.histogram);
        const macdStrength = Math.abs(current.macd);

        // Normalize to 0-1 scale (adjust multiplier based on typical values)
        return Math.min(1, (histogramStrength + macdStrength) * 100);
    }
}