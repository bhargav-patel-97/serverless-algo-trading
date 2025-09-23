// lib/strategies/regimeDetection.js - Regime Detection Strategy
import { MovingAverages } from '../indicators/movingAverages.js';
import { Logger } from '../utils/logger.js';

export class RegimeDetectionStrategy {
    constructor(config) {
        this.config = {
            enabled: config.enabled || false,
            bullSymbol: config.bullSymbol || 'TQQQ',
            bearSymbol: config.bearSymbol || 'SQQQ',
            spyLookback: config.spyLookback || 200,
            positionSize: config.positionSize || 0.03,
            minConfirmationDays: config.minConfirmationDays || 3,
            volatilityAdjustment: config.volatilityAdjustment || true
        };
        this.logger = new Logger();
        this.currentRegime = null;
        this.regimeChangeDate = null;
    }

    getName() {
        return 'Regime Detection Strategy';
    }

    isEnabled() {
        return this.config.enabled;
    }

    async generateSignals(alpaca) {
        const signals = [];

        try {
            // Get SPY data for regime detection
            const spyData = await alpaca.getHistoricalData('SPY', '1Day', this.config.spyLookback + 10);

            if (spyData.length < this.config.spyLookback + 1) {
                this.logger.warning('Insufficient SPY data for regime detection');
                return signals;
            }

            const spyPrices = spyData.map(bar => bar.close);
            const currentPrice = spyPrices[spyPrices.length - 1];
            const ma200 = MovingAverages.getCurrentSMA(spyPrices, this.config.spyLookback);

            // Determine current regime
            const newRegime = currentPrice > ma200 ? 'bull' : 'bear';

            // Calculate regime strength (distance from MA)
            const regimeStrength = Math.abs(currentPrice - ma200) / ma200;

            this.logger.info('Regime Detection Analysis', {
                spyPrice: currentPrice.toFixed(2),
                ma200: ma200.toFixed(2),
                regime: newRegime,
                strength: (regimeStrength * 100).toFixed(2) + '%',
                previousRegime: this.currentRegime
            });

            // Check for regime change
            if (this.currentRegime !== newRegime) {
                this.logger.info('Regime change detected', {
                    from: this.currentRegime,
                    to: newRegime,
                    strength: regimeStrength
                });

                this.currentRegime = newRegime;
                this.regimeChangeDate = new Date();

                // Generate position switch signals
                if (newRegime === 'bull') {
                    // Switch to bull ETF
                    const bullQuote = await alpaca.getQuote(this.config.bullSymbol);
                    const bullPrice = (bullQuote.bid + bullQuote.ask) / 2;

                    signals.push({
                        symbol: this.config.bullSymbol,
                        side: 'buy',
                        reason: 'regime_change_to_bull',
                        currentPrice: bullPrice,
                        positionSize: this.adjustPositionSizeForVolatility(regimeStrength),
                        confidence: this.calculateRegimeConfidence(regimeStrength, spyPrices),
                        regimeStrength: regimeStrength,
                        timestamp: new Date().toISOString()
                    });

                    // Add sell signal for bear ETF if we have positions
                    const bearQuote = await alpaca.getQuote(this.config.bearSymbol);
                    const bearPrice = (bearQuote.bid + bearQuote.ask) / 2;

                    signals.push({
                        symbol: this.config.bearSymbol,
                        side: 'sell',
                        reason: 'regime_change_exit_bear',
                        currentPrice: bearPrice,
                        positionSize: 0, // Will be determined by current position
                        confidence: this.calculateRegimeConfidence(regimeStrength, spyPrices),
                        timestamp: new Date().toISOString()
                    });

                } else {
                    // Switch to bear ETF
                    const bearQuote = await alpaca.getQuote(this.config.bearSymbol);
                    const bearPrice = (bearQuote.bid + bearQuote.ask) / 2;

                    signals.push({
                        symbol: this.config.bearSymbol,
                        side: 'buy',
                        reason: 'regime_change_to_bear',
                        currentPrice: bearPrice,
                        positionSize: this.adjustPositionSizeForVolatility(regimeStrength),
                        confidence: this.calculateRegimeConfidence(regimeStrength, spyPrices),
                        regimeStrength: regimeStrength,
                        timestamp: new Date().toISOString()
                    });

                    // Add sell signal for bull ETF if we have positions
                    const bullQuote = await alpaca.getQuote(this.config.bullSymbol);
                    const bullPrice = (bullQuote.bid + bullQuote.ask) / 2;

                    signals.push({
                        symbol: this.config.bullSymbol,
                        side: 'sell',
                        reason: 'regime_change_exit_bull',
                        currentPrice: bullPrice,
                        positionSize: 0, // Will be determined by current position
                        confidence: this.calculateRegimeConfidence(regimeStrength, spyPrices),
                        timestamp: new Date().toISOString()
                    });
                }
            } else {
                // No regime change, but check if we should add to positions in strong regimes
                if (regimeStrength > 0.05 && this.shouldAddToPosition()) { // 5% above/below MA
                    const targetSymbol = newRegime === 'bull' ? this.config.bullSymbol : this.config.bearSymbol;
                    const quote = await alpaca.getQuote(targetSymbol);
                    const price = (quote.bid + quote.ask) / 2;

                    signals.push({
                        symbol: targetSymbol,
                        side: 'buy',
                        reason: `strong_${newRegime}_regime_continuation`,
                        currentPrice: price,
                        positionSize: this.config.positionSize * 0.5, // Half position for continuation
                        confidence: this.calculateRegimeConfidence(regimeStrength, spyPrices),
                        regimeStrength: regimeStrength,
                        timestamp: new Date().toISOString()
                    });

                    this.logger.info(`Strong ${newRegime} regime continuation signal`, {
                        symbol: targetSymbol,
                        strength: regimeStrength
                    });
                }
            }

        } catch (error) {
            this.logger.error('Regime detection strategy error', { error: error.message });
            throw error;
        }

        return signals;
    }

    adjustPositionSizeForVolatility(regimeStrength) {
        if (!this.config.volatilityAdjustment) {
            return this.config.positionSize;
        }

        // Reduce position size in uncertain regimes (close to MA)
        if (regimeStrength < 0.02) { // Less than 2% from MA
            return this.config.positionSize * 0.5;
        } else if (regimeStrength < 0.05) { // Less than 5% from MA
            return this.config.positionSize * 0.75;
        } else {
            return this.config.positionSize; // Full position in strong regimes
        }
    }

    calculateRegimeConfidence(regimeStrength, prices) {
        // Higher confidence with stronger regime signals and trend consistency
        const baseConfidence = Math.min(0.9, 0.5 + (regimeStrength * 5)); // 50-90% based on strength

        // Check trend consistency over last 5 days
        const recentPrices = prices.slice(-6); // Last 6 prices for 5 changes
        let consistentTrend = 0;

        for (let i = 1; i < recentPrices.length; i++) {
            if (this.currentRegime === 'bull' && recentPrices[i] > recentPrices[i-1]) {
                consistentTrend++;
            } else if (this.currentRegime === 'bear' && recentPrices[i] < recentPrices[i-1]) {
                consistentTrend++;
            }
        }

        const trendConfidence = consistentTrend / 5; // 0-1 based on trend consistency
        return Math.min(0.95, baseConfidence * (0.8 + 0.2 * trendConfidence));
    }

    shouldAddToPosition() {
        // Only add to positions if regime change was recent (within 5 days)
        if (!this.regimeChangeDate) return false;

        const daysSinceChange = (Date.now() - this.regimeChangeDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceChange <= 5;
    }

    getCurrentRegime() {
        return {
            regime: this.currentRegime,
            changeDate: this.regimeChangeDate,
            bullSymbol: this.config.bullSymbol,
            bearSymbol: this.config.bearSymbol
        };
    }
}