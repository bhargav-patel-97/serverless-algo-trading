// lib/strategies/meanReversion.js - Enhanced Mean Reversion Strategy with Dynamic Symbol Support
import { RSI } from '../indicators/rsi.js';
import { Logger } from '../utils/logger.js';
import { getBullBearSymbols } from '../config/symbolConfig.js';

export class MeanReversionStrategy {
  constructor(config) {
    // Get bull/bear symbols from configuration
    const symbolPair = getBullBearSymbols(config.baseSymbol);
    
    this.config = {
      enabled: config.enabled || false,
      name: config.name || `${config.baseSymbol}_MeanReversion`,
      baseSymbol: config.baseSymbol || 'SPY',
      symbols: config.symbols || [symbolPair.bullSymbol, symbolPair.bearSymbol], // [bull, bear]
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
    return this.config.name;
  }

  isEnabled() {
    return this.config.enabled;
  }

  async generateSignals(alpaca) {
    const signals = [];

    try {
      this.logger.info(`Starting ${this.getName()} analysis for ${this.config.baseSymbol}`, {
        baseSymbol: this.config.baseSymbol,
        strategy: this.getName()
      });

      // Analyze the base symbol for RSI signals
      const historicalData = await alpaca.getHistoricalData(
        this.config.baseSymbol, 
        '1Day', 
        this.config.lookbackPeriod
      );

      if (historicalData.length < this.config.rsiPeriod + 5) {
        this.logger.warning(`Insufficient data for ${this.config.baseSymbol} RSI analysis`, {
          strategy: this.getName()
        });
        return signals;
      }

      const prices = historicalData.map(bar => bar.close);
      const currentRSI = RSI.getCurrentRSI(prices, this.config.rsiPeriod);
      const currentPrice = prices[prices.length - 1];

      this.logger.info(`${this.config.baseSymbol} RSI Analysis`, {
        rsi: currentRSI.toFixed(2),
        price: currentPrice.toFixed(2),
        oversoldThreshold: this.config.oversoldThreshold,
        overboughtThreshold: this.config.overboughtThreshold,
        strategy: this.getName()
      });

      // Check for oversold condition (buy bull ETF signal)
      if (RSI.isOversold(currentRSI, this.config.oversoldThreshold)) {
        const bullSymbol = this.config.symbols[0]; // First symbol is bull ETF
        try {
          const quote = await alpaca.getQuote(bullSymbol);
          const currentQuotePrice = (quote.bid + quote.ask) / 2;

          signals.push({
            symbol: bullSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_rsi_oversold`,
            currentPrice: currentQuotePrice,
            positionSize: this.config.positionSize,
            confidence: this.calculateOversoldConfidence(currentRSI),
            rsi: currentRSI,
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol
          });

          this.logger.info(`Oversold signal generated for ${bullSymbol} based on ${this.config.baseSymbol}`, {
            rsi: currentRSI,
            threshold: this.config.oversoldThreshold,
            strategy: this.getName()
          });
        } catch (quoteError) {
          this.logger.error(`Failed to get ${bullSymbol} quote`, { 
            error: quoteError.message,
            strategy: this.getName()
          });
        }
      }

      // Check for overbought condition (buy bear ETF signal)
      if (RSI.isOverbought(currentRSI, this.config.overboughtThreshold)) {
        const bearSymbol = this.config.symbols[1]; // Second symbol is bear ETF
        try {
          const quote = await alpaca.getQuote(bearSymbol);
          const currentQuotePrice = (quote.bid + quote.ask) / 2;

          signals.push({
            symbol: bearSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_rsi_overbought`,
            currentPrice: currentQuotePrice,
            positionSize: this.config.positionSize,
            confidence: this.calculateOverboughtConfidence(currentRSI),
            rsi: currentRSI,
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol
          });

          this.logger.info(`Overbought signal generated for ${bearSymbol} based on ${this.config.baseSymbol}`, {
            rsi: currentRSI,
            threshold: this.config.overboughtThreshold,
            strategy: this.getName()
          });
        } catch (quoteError) {
          this.logger.error(`Failed to get ${bearSymbol} quote`, { 
            error: quoteError.message,
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
          this.config.baseSymbol, // Use base symbol for exit analysis
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
            reason: `${this.config.baseSymbol}_rsi_normalized_from_oversold`,
            quantity: Math.abs(parseFloat(position.qty))
          });
        } else if (position.side === 'short' && currentRSI < 50) {
          exitSignals.push({
            symbol: position.symbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_rsi_normalized_from_overbought`,
            quantity: Math.abs(parseFloat(position.qty))
          });
        }

      } catch (error) {
        this.logger.error(`Error checking exit conditions for ${position.symbol}`, {
          error: error.message,
          strategy: this.getName()
        });
      }
    }

    return exitSignals;
  }
}