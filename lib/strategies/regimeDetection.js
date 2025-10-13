// lib/strategies/regimeDetection.js - Enhanced Regime Detection Strategy with Serverless State Persistence
import { MovingAverages } from '../indicators/movingAverages.js';
import { Logger } from '../utils/logger.js';
import { getBullBearSymbols } from '../config/symbolConfig.js';
import { GoogleSheetsLogger } from '../utils/googleSheets.js';

export class RegimeDetectionStrategy {
  constructor(config) {
    // Get bull/bear symbols from configuration
    const symbolPair = getBullBearSymbols(config.baseSymbol);
    
    this.config = {
      enabled: config.enabled || false,
      name: config.name || `${config.baseSymbol}_RegimeDetection`,
      baseSymbol: config.baseSymbol || 'SPY',
      bullSymbol: config.bullSymbol || symbolPair.bullSymbol,
      bearSymbol: config.bearSymbol || symbolPair.bearSymbol,
      spyLookback: config.spyLookback || 200,
      positionSize: config.positionSize || 0.03,
      minConfirmationDays: config.minConfirmationDays || 3,
      volatilityAdjustment: config.volatilityAdjustment || true
    };

    this.logger = new Logger();
    
    // CRITICAL FIX: Initialize Google Sheets integration for regime persistence
    this.googleSheets = new GoogleSheetsLogger();
    
    // CRITICAL FIX: These will be loaded from Google Sheets in initializeRegimeState()
    this.currentRegime = null;
    this.regimeChangeDate = null;
    this.previousRegime = null; // This is what was missing!
    
    // Track if we've initialized state from Google Sheets
    this.stateInitialized = false;
  }

  getName() {
    return this.config.name;
  }

  isEnabled() {
    return this.config.enabled;
  }

  /**
   * CRITICAL FIX: Initialize regime state from Google Sheets for serverless persistence
   */
  async initializeRegimeState() {
    if (this.stateInitialized) {
      return; // Already initialized
    }

    try {
      this.logger.info('CRITICAL FIX: Initializing regime state from Google Sheets for serverless persistence', {
        strategy: this.getName(),
        baseSymbol: this.config.baseSymbol
      });

      // Initialize the RegimeState sheet if it doesn't exist
      await this.googleSheets.initializeRegimeStateSheet();

      // Get the last regime state from Google Sheets
      const lastRegimeState = await this.googleSheets.getRegimeState(
        this.config.baseSymbol,
        this.getName()
      );

      if (lastRegimeState) {
        this.previousRegime = lastRegimeState.regime;
        this.currentRegime = lastRegimeState.regime;
        this.regimeChangeDate = lastRegimeState.changeDate ? new Date(lastRegimeState.changeDate) : null;

        this.logger.info('CRITICAL FIX: Regime state loaded from Google Sheets', {
          strategy: this.getName(),
          baseSymbol: this.config.baseSymbol,
          previousRegime: this.previousRegime,
          currentRegime: this.currentRegime,
          changeDate: this.regimeChangeDate?.toISOString(),
          stateAge: this.regimeChangeDate ? 
            Math.round((Date.now() - new Date(lastRegimeState.timestamp).getTime()) / 1000 / 60) + ' minutes' : 
            'unknown'
        });
      } else {
        this.logger.info('CRITICAL FIX: No previous regime state found - starting fresh', {
          strategy: this.getName(),
          baseSymbol: this.config.baseSymbol
        });
        
        this.previousRegime = null;
        this.currentRegime = null;
        this.regimeChangeDate = null;
      }

      this.stateInitialized = true;
    } catch (error) {
      this.logger.error('CRITICAL FIX: Failed to initialize regime state from Google Sheets', {
        strategy: this.getName(),
        baseSymbol: this.config.baseSymbol,
        error: error.message
      });
      
      // Fallback to default state
      this.previousRegime = null;
      this.currentRegime = null;
      this.regimeChangeDate = null;
      this.stateInitialized = true;
    }
  }

  /**
   * CRITICAL FIX: Store regime state to Google Sheets for serverless persistence
   */
  async storeRegimeState(regime, regimeStrength, ma200, currentPrice) {
    try {
      const regimeData = {
        baseSymbol: this.config.baseSymbol,
        regime: regime,
        ma200: ma200,
        currentPrice: currentPrice,
        regimeStrength: regimeStrength,
        changeDate: this.regimeChangeDate ? this.regimeChangeDate.toISOString() : new Date().toISOString(),
        strategyName: this.getName()
      };

      const success = await this.googleSheets.storeRegimeState(regimeData);
      
      if (success) {
        this.logger.info('CRITICAL FIX: Regime state stored to Google Sheets for serverless persistence', {
          strategy: this.getName(),
          baseSymbol: this.config.baseSymbol,
          regime: regime,
          regimeStrength: regimeStrength
        });
      } else {
        this.logger.warning('CRITICAL FIX: Failed to store regime state to Google Sheets', {
          strategy: this.getName(),
          baseSymbol: this.config.baseSymbol,
          regime: regime
        });
      }
    } catch (error) {
      this.logger.error('CRITICAL FIX: Error storing regime state to Google Sheets', {
        strategy: this.getName(),
        baseSymbol: this.config.baseSymbol,
        regime: regime,
        error: error.message
      });
    }
  }

  async generateSignals(alpaca) {
    const signals = [];

    try {
      // CRITICAL FIX: Initialize regime state from Google Sheets before analysis
      await this.initializeRegimeState();

      this.logger.info(`Starting ${this.getName()} analysis for ${this.config.baseSymbol}`, {
        baseSymbol: this.config.baseSymbol,
        strategy: this.getName(),
        previousRegime: this.previousRegime,
        currentRegime: this.currentRegime
      });

      // Get base symbol data for regime detection
      const baseData = await alpaca.getHistoricalData(
        this.config.baseSymbol, 
        '1Day', 
        this.config.spyLookback + 10
      );

      if (baseData.length < this.config.spyLookback + 1) {
        this.logger.warning(`Insufficient ${this.config.baseSymbol} data for regime detection`, {
          strategy: this.getName()
        });
        return signals;
      }

      const basePrices = baseData.map(bar => bar.close);
      const currentPrice = basePrices[basePrices.length - 1];
      const ma200 = MovingAverages.getCurrentSMA(basePrices, this.config.spyLookback);

      // Determine current regime
      const newRegime = currentPrice > ma200 ? 'bull' : 'bear';

      // Calculate regime strength (distance from MA)
      const regimeStrength = Math.abs(currentPrice - ma200) / ma200;

      this.logger.info(`${this.config.baseSymbol} Regime Detection Analysis`, {
        basePrice: currentPrice.toFixed(2),
        ma200: ma200.toFixed(2),
        regime: newRegime,
        strength: (regimeStrength * 100).toFixed(2) + '%',
        previousRegime: this.previousRegime, // CRITICAL FIX: Now properly tracks previous regime
        currentRegime: this.currentRegime,
        strategy: this.getName()
      });

      // CRITICAL FIX: Check for regime change using properly persisted previous regime
      if (this.currentRegime !== newRegime) {
        this.logger.info('CRITICAL FIX: Regime change detected with proper state persistence', {
          from: this.currentRegime,
          to: newRegime,
          strength: regimeStrength,
          baseSymbol: this.config.baseSymbol,
          strategy: this.getName(),
          serverlessPersistence: true
        });

        // CRITICAL FIX: Update regime state variables
        this.previousRegime = this.currentRegime;
        this.currentRegime = newRegime;
        this.regimeChangeDate = new Date();

        // CRITICAL FIX: Store the new regime state to Google Sheets for future invocations
        await this.storeRegimeState(newRegime, regimeStrength, ma200, currentPrice);

        // Generate position switch signals
        if (newRegime === 'bull') {
          // Switch to bull ETF
          const bullQuote = await alpaca.getQuote(this.config.bullSymbol);
          const bullPrice = (bullQuote.bid + bullQuote.ask) / 2;

          signals.push({
            symbol: this.config.bullSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_regime_change_to_bull`,
            currentPrice: bullPrice,
            positionSize: this.adjustPositionSizeForVolatility(regimeStrength),
            confidence: this.calculateRegimeConfidence(regimeStrength, basePrices),
            regimeStrength: regimeStrength,
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            regimeChange: true,
            previousRegime: this.previousRegime
          });

          // Add sell signal for bear ETF if we have positions
          const bearQuote = await alpaca.getQuote(this.config.bearSymbol);
          const bearPrice = (bearQuote.bid + bearQuote.ask) / 2;

          signals.push({
            symbol: this.config.bearSymbol,
            side: 'sell',
            reason: `${this.config.baseSymbol}_regime_change_exit_bear`,
            currentPrice: bearPrice,
            positionSize: 0, // Will be determined by current position
            confidence: this.calculateRegimeConfidence(regimeStrength, basePrices),
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            regimeChange: true,
            previousRegime: this.previousRegime
          });
        } else {
          // Switch to bear ETF
          const bearQuote = await alpaca.getQuote(this.config.bearSymbol);
          const bearPrice = (bearQuote.bid + bearQuote.ask) / 2;

          signals.push({
            symbol: this.config.bearSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_regime_change_to_bear`,
            currentPrice: bearPrice,
            positionSize: this.adjustPositionSizeForVolatility(regimeStrength),
            confidence: this.calculateRegimeConfidence(regimeStrength, basePrices),
            regimeStrength: regimeStrength,
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            regimeChange: true,
            previousRegime: this.previousRegime
          });

          // Add sell signal for bull ETF if we have positions
          const bullQuote = await alpaca.getQuote(this.config.bullSymbol);
          const bullPrice = (bullQuote.bid + bullQuote.ask) / 2;

          signals.push({
            symbol: this.config.bullSymbol,
            side: 'sell',
            reason: `${this.config.baseSymbol}_regime_change_exit_bull`,
            currentPrice: bullPrice,
            positionSize: 0, // Will be determined by current position
            confidence: this.calculateRegimeConfidence(regimeStrength, basePrices),
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            regimeChange: true,
            previousRegime: this.previousRegime
          });
        }
      } else {
        // CRITICAL FIX: No regime change, but update current regime if it was null
        if (this.currentRegime === null) {
          this.currentRegime = newRegime;
          await this.storeRegimeState(newRegime, regimeStrength, ma200, currentPrice);
          
          this.logger.info('CRITICAL FIX: Initial regime state established and stored', {
            strategy: this.getName(),
            baseSymbol: this.config.baseSymbol,
            initialRegime: newRegime,
            serverlessPersistence: true
          });
        }

        // Check if we should add to positions in strong regimes
        if (regimeStrength > 0.05 && this.shouldAddToPosition()) { // 5% above/below MA
          const targetSymbol = newRegime === 'bull' ? this.config.bullSymbol : this.config.bearSymbol;
          const quote = await alpaca.getQuote(targetSymbol);
          const price = (quote.bid + quote.ask) / 2;

          signals.push({
            symbol: targetSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_strong_${newRegime}_regime_continuation`,
            currentPrice: price,
            positionSize: this.config.positionSize * 0.5, // Half position for continuation
            confidence: this.calculateRegimeConfidence(regimeStrength, basePrices),
            regimeStrength: regimeStrength,
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            regimeChange: false,
            previousRegime: this.previousRegime
          });

          this.logger.info(`Strong ${newRegime} regime continuation signal for ${this.config.baseSymbol}`, {
            symbol: targetSymbol,
            strength: regimeStrength,
            strategy: this.getName()
          });
        }
      }
    } catch (error) {
      this.logger.error(`${this.getName()} error`, { 
        error: error.message,
        baseSymbol: this.config.baseSymbol
      });
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
      previousRegime: this.previousRegime, // CRITICAL FIX: Now includes previous regime
      changeDate: this.regimeChangeDate,
      bullSymbol: this.config.bullSymbol,
      bearSymbol: this.config.bearSymbol,
      baseSymbol: this.config.baseSymbol,
      serverlessPersistence: true
    };
  }

  /**
   * CRITICAL FIX: Get regime change history for analysis
   */
  async getRegimeHistory(daysBack = 30) {
    try {
      return await this.googleSheets.getRegimeHistory(
        this.config.baseSymbol,
        this.getName(),
        daysBack
      );
    } catch (error) {
      this.logger.error('Failed to get regime history', {
        strategy: this.getName(),
        baseSymbol: this.config.baseSymbol,
        error: error.message
      });
      return [];
    }
  }

  /**
   * CRITICAL FIX: Force refresh regime state from Google Sheets (useful for debugging)
   */
  async refreshRegimeState() {
    this.stateInitialized = false;
    await this.initializeRegimeState();
    
    this.logger.info('CRITICAL FIX: Regime state refreshed from Google Sheets', {
      strategy: this.getName(),
      baseSymbol: this.config.baseSymbol,
      previousRegime: this.previousRegime,
      currentRegime: this.currentRegime
    });
  }
}