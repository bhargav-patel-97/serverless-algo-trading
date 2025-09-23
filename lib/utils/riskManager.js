// lib/utils/riskManager.js - Risk Management System
import { Logger } from './logger.js';

export class RiskManager {
    constructor(config) {
        this.config = {
            maxPositionSize: config.maxPositionSize || 0.05, // 5% max
            maxDailyLoss: config.maxDailyLoss || 0.02, // 2% max daily loss
            maxDrawdown: config.maxDrawdown || 0.10, // 10% max drawdown
            stopLossPercent: config.stopLossPercent || 0.03, // 3% stop loss
            takeProfitPercent: config.takeProfitPercent || 0.06, // 6% take profit
            minPositionSize: config.minPositionSize || 100, // $100 minimum
            maxConcurrentPositions: config.maxConcurrentPositions || 5
        };
        this.logger = new Logger();
    }

    async adjustSignal(signal, account, positions) {
        try {
            const equity = parseFloat(account.equity);

            // Check if we're at max concurrent positions
            if (positions.length >= this.config.maxConcurrentPositions && signal.side === 'buy') {
                this.logger.warning('Max concurrent positions reached', { 
                    current: positions.length,
                    max: this.config.maxConcurrentPositions 
                });
                return null;
            }

            // Calculate position size based on risk
            const riskAmount = equity * signal.positionSize;
            const maxRiskAmount = equity * this.config.maxPositionSize;
            const finalRiskAmount = Math.min(riskAmount, maxRiskAmount);

            // Check minimum position size
            if (finalRiskAmount < this.config.minPositionSize) {
                this.logger.warning('Position size below minimum', { 
                    calculated: finalRiskAmount,
                    minimum: this.config.minPositionSize 
                });
                return null;
            }

            // Calculate quantity based on current price
            const quantity = Math.floor(finalRiskAmount / signal.currentPrice);

            if (quantity <= 0) {
                this.logger.warning('Calculated quantity is zero or negative', { quantity });
                return null;
            }

            // Calculate stop loss and take profit levels
            let stopLoss, takeProfit;

            if (signal.side === 'buy') {
                stopLoss = signal.currentPrice * (1 - this.config.stopLossPercent);
                takeProfit = signal.currentPrice * (1 + this.config.takeProfitPercent);
            } else {
                stopLoss = signal.currentPrice * (1 + this.config.stopLossPercent);
                takeProfit = signal.currentPrice * (1 - this.config.takeProfitPercent);
            }

            this.logger.info('Signal adjusted by risk manager', {
                originalSignal: signal,
                adjustedQuantity: quantity,
                riskAmount: finalRiskAmount,
                stopLoss,
                takeProfit
            });

            return {
                ...signal,
                quantity,
                stopLoss,
                takeProfit,
                riskAmount: finalRiskAmount
            };

        } catch (error) {
            this.logger.error('Risk manager adjustment failed', { signal, error });
            throw error;
        }
    }

    async isDailyLossLimitExceeded(account, positions) {
        try {
            const equity = parseFloat(account.equity);
            const dayTradeEquity = parseFloat(account.last_equity || equity);
            const dailyPnL = equity - dayTradeEquity;
            const maxDailyLoss = dayTradeEquity * this.config.maxDailyLoss;

            if (dailyPnL < -maxDailyLoss) {
                this.logger.warning('Daily loss limit exceeded', {
                    dailyPnL,
                    maxDailyLoss,
                    currentEquity: equity,
                    previousEquity: dayTradeEquity
                });
                return true;
            }

            return false;
        } catch (error) {
            this.logger.error('Failed to check daily loss limit', error);
            return false; // Conservative approach - allow trading if check fails
        }
    }

    calculatePositionSize(accountEquity, riskPercent, entryPrice, stopLossPrice) {
        const riskAmount = accountEquity * riskPercent;
        const riskPerShare = Math.abs(entryPrice - stopLossPrice);

        if (riskPerShare <= 0) {
            throw new Error('Invalid stop loss price');
        }

        return Math.floor(riskAmount / riskPerShare);
    }

    async calculatePerformanceMetrics(account, positions) {
        try {
            const equity = parseFloat(account.equity);
            const dayTradeEquity = parseFloat(account.last_equity || equity);

            // Calculate unrealized P&L from positions
            let unrealizedPnL = 0;
            for (const position of positions) {
                unrealizedPnL += parseFloat(position.unrealized_pl || 0);
            }

            // Calculate daily return
            const dailyReturn = ((equity - dayTradeEquity) / dayTradeEquity) * 100;

            return {
                totalEquity: equity,
                dailyPnL: equity - dayTradeEquity,
                dailyReturn: dailyReturn,
                unrealizedPnL,
                positionCount: positions.length,
                buyingPower: parseFloat(account.buying_power),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Failed to calculate performance metrics', error);
            throw error;
        }
    }
}