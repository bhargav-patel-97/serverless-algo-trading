// lib/strategies/momentum.js - Enhanced Momentum Trading Strategy with Dynamic Symbol Support
import { MovingAverages } from '../indicators/movingAverages.js';
import { Logger } from '../utils/logger.js';
import { getBullBearSymbols } from '../config/symbolConfig.js';

export class MomentumStrategy {
  constructor(config) {
    // Get bull/bear symbols from configuration
    const symbolPair = getBullBearSymbols(config.baseSymbol);
    
    this.config = {
      enabled: config.enabled || false,
      name: config.name || `${config.baseSymbol}_Momentum`,
      baseSymbol: config.baseSymbol || 'SPY',
      symbols: config.symbols || [symbolPair.bullSymbol, symbolPair.bearSymbol], // [bull, bear]
      lookbackPeriod: config.lookbackPeriod || 50,
      shortMA: config.shortMA || 20,
      longMA: config.longMA || 50,
      positionSize: config.positionSize || 0.02,
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
      // Check if market is open
      const isMarketOpen = await alpaca.isMarketOpen();
      this.logger.info('Market status check', { 
        isMarketOpen,
        strategy: this.getName(),
        baseSymbol: this.config.baseSymbol
      });

      // Get base symbol data for market direction
      this.logger.info(`Requesting ${this.config.baseSymbol} historical data`, {
        lookbackPeriod: this.config.lookbackPeriod + 10,
        strategy: this.getName()
      });

      const baseData = await alpaca.getHistoricalData(
        this.config.baseSymbol, 
        '1Day', 
        this.config.lookbackPeriod + 10
      );

      if (!baseData || baseData.length === 0) {
        this.logger.warning(`No ${this.config.baseSymbol} data received - markets may be closed or data unavailable`, {
          strategy: this.getName()
        });
        return signals;
      }

      if (baseData.length < this.config.longMA + 1) {
        this.logger.warning(`Insufficient ${this.config.baseSymbol} data for momentum analysis`, {
          received: baseData.length,
          required: this.config.longMA + 1,
          strategy: this.getName()
        });
        return signals;
      }

      const basePrices = baseData.map(bar => bar.close);
      this.logger.info(`${this.config.baseSymbol} data analysis`, {
        barsReceived: baseData.length,
        dateRange: {
          from: baseData[0].timestamp,
          to: baseData[baseData.length - 1].timestamp
        },
        latestPrice: basePrices[basePrices.length - 1],
        strategy: this.getName()
      });

      // Calculate moving averages
      let shortMA, longMA, prevShortMA, prevLongMA;
      try {
        shortMA = MovingAverages.getCurrentSMA(basePrices, this.config.shortMA);
        longMA = MovingAverages.getCurrentSMA(basePrices, this.config.longMA);
        
        // Get previous values for crossover detection
        prevShortMA = MovingAverages.getCurrentSMA(basePrices.slice(0, -1), this.config.shortMA);
        prevLongMA = MovingAverages.getCurrentSMA(basePrices.slice(0, -1), this.config.longMA);
      } catch (maError) {
        this.logger.error('Moving average calculation failed', {
          error: maError.message,
          pricesLength: basePrices.length,
          shortMA: this.config.shortMA,
          longMA: this.config.longMA,
          strategy: this.getName()
        });
        return signals;
      }

      this.logger.info(`${this.config.baseSymbol} Momentum analysis`, {
        shortMA: shortMA.toFixed(2),
        longMA: longMA.toFixed(2),
        prevShortMA: prevShortMA.toFixed(2),
        prevLongMA: prevLongMA.toFixed(2),
        trend: shortMA > longMA ? 'bullish' : 'bearish',
        strategy: this.getName()
      });

      // Check for crossovers
      const bullishCrossover = MovingAverages.isMACrossover(shortMA, longMA, prevShortMA, prevLongMA);
      const bearishCrossover = MovingAverages.isMACrossunder(shortMA, longMA, prevShortMA, prevLongMA);

      if (bullishCrossover) {
        this.logger.info(`Bullish crossover detected on ${this.config.baseSymbol} - generating bull ETF buy signal`, {
          strategy: this.getName()
        });

        // Get the bull ETF (first symbol in array)
        const bullSymbol = this.config.symbols[0];
        try {
          const bullQuote = await alpaca.getQuote(bullSymbol);
          signals.push({
            symbol: bullSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_bullish_ma_crossover`,
            currentPrice: (bullQuote.bid + bullQuote.ask) / 2,
            positionSize: this.config.positionSize,
            confidence: this.calculateConfidence(shortMA, longMA, basePrices),
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            maData: {
              shortMA: shortMA.toFixed(2),
              longMA: longMA.toFixed(2),
              separation: ((shortMA - longMA) / longMA * 100).toFixed(2) + '%'
            }
          });

          this.logger.info('Bullish momentum signal generated', { 
            symbol: bullSymbol,
            price: ((bullQuote.bid + bullQuote.ask) / 2).toFixed(2),
            baseSymbol: this.config.baseSymbol,
            strategy: this.getName()
          });
        } catch (quoteError) {
          this.logger.error(`Failed to get ${bullSymbol} quote`, { 
            error: quoteError.message,
            strategy: this.getName()
          });
        }
      }

      if (bearishCrossover) {
        this.logger.info(`Bearish crossover detected on ${this.config.baseSymbol} - generating bear ETF buy signal`, {
          strategy: this.getName()
        });

        // Get the bear ETF (second symbol in array)
        const bearSymbol = this.config.symbols[1];
        try {
          const bearQuote = await alpaca.getQuote(bearSymbol);
          signals.push({
            symbol: bearSymbol,
            side: 'buy',
            reason: `${this.config.baseSymbol}_bearish_ma_crossover`,
            currentPrice: (bearQuote.bid + bearQuote.ask) / 2,
            positionSize: this.config.positionSize,
            confidence: this.calculateConfidence(longMA, shortMA, basePrices),
            timestamp: new Date().toISOString(),
            baseSymbol: this.config.baseSymbol,
            maData: {
              shortMA: shortMA.toFixed(2),
              longMA: longMA.toFixed(2),
              separation: ((longMA - shortMA) / shortMA * 100).toFixed(2) + '%'
            }
          });

          this.logger.info('Bearish momentum signal generated', { 
            symbol: bearSymbol,
            price: ((bearQuote.bid + bearQuote.ask) / 2).toFixed(2),
            baseSymbol: this.config.baseSymbol,
            strategy: this.getName()
          });
        } catch (quoteError) {
          this.logger.error(`Failed to get ${bearSymbol} quote`, { 
            error: quoteError.message,
            strategy: this.getName()
          });
        }
      }

      if (!bullishCrossover && !bearishCrossover) {
        this.logger.info(`No crossover signals detected on ${this.config.baseSymbol}`, {
          shortMA: shortMA.toFixed(2),
          longMA: longMA.toFixed(2),
          trend: shortMA > longMA ? 'bullish' : 'bearish',
          strategy: this.getName()
        });
      }

    } catch (error) {
      this.logger.error(`${this.getName()} error`, { 
        error: error.message,
        stack: error.stack,
        baseSymbol: this.config.baseSymbol
      });
      // Don't throw error - return empty signals array to prevent system crash
    }

    this.logger.info(`${this.getName()} completed`, { 
      signalsGenerated: signals.length,
      baseSymbol: this.config.baseSymbol
    });
    return signals;
  }

  calculateConfidence(strongerMA, weakerMA, prices) {
    try {
      // Calculate confidence based on MA separation and recent price action
      const separation = Math.abs(strongerMA - weakerMA) / weakerMA;
      const recentVolatility = this.calculateVolatility(prices.slice(-10));
      
      // Higher separation and lower volatility = higher confidence
      const confidence = Math.min(0.95, separation / recentVolatility);
      return Math.max(0.1, confidence); // Minimum 10% confidence
    } catch (error) {
      this.logger.error('Confidence calculation error', { 
        error: error.message,
        strategy: this.getName()
      });
      return 0.5; // Default 50% confidence
    }
  }

  calculateVolatility(prices) {
    try {
      if (prices.length < 2) return 1;
      
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
      }
      
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
      
      return Math.sqrt(variance);
    } catch (error) {
      this.logger.error('Volatility calculation error', { 
        error: error.message,
        strategy: this.getName()
      });
      return 1; // Default volatility
    }
  }
}