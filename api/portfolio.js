// api/portfolio.js - Portfolio Management Endpoint
import { AlpacaApi } from '../lib/brokers/alpacaHybrid.js';
import { Logger } from '../lib/utils/logger.js';
import { RiskManager } from '../lib/utils/riskManager.js';

export default async function handler(req, res) {
    const logger = new Logger();

    try {
        // Initialize Alpaca API
        const alpaca = new AlpacaApi({
            keyId: process.env.ALPACA_API_KEY,
            secretKey: process.env.ALPACA_SECRET_KEY,
            paper: process.env.ALPACA_PAPER === 'true',
            baseUrl: process.env.ALPACA_PAPER === 'true' ? 
                'https://paper-api.alpaca.markets' : 
                'https://api.alpaca.markets'
        });

        const riskManager = new RiskManager({
            maxPositionSize: 0.05,
            maxDailyLoss: 0.02,
            maxDrawdown: 0.10
        });

        // Get account information
        const account = await alpaca.getAccount();

        // Get current positions
        const positions = await alpaca.getPositions();

        // Get recent orders
        const recentOrders = await alpaca.getOrders('all');
        const last10Orders = recentOrders.slice(0, 10);

        // Calculate performance metrics
        const performanceMetrics = await riskManager.calculatePerformanceMetrics(account, positions);

        // Calculate portfolio allocation
        const totalValue = parseFloat(account.portfolio_value);
        const cashValue = parseFloat(account.cash);
        const investedValue = totalValue - cashValue;

        // Calculate position details
        const positionDetails = await Promise.all(positions.map(async (position) => {
            try {
                const quote = await alpaca.getQuote(position.symbol);
                const currentPrice = (quote.bid + quote.ask) / 2;

                return {
                    symbol: position.symbol,
                    quantity: parseFloat(position.qty),
                    side: position.side,
                    entryPrice: parseFloat(position.avg_entry_price),
                    currentPrice: currentPrice,
                    marketValue: parseFloat(position.market_value),
                    unrealizedPL: parseFloat(position.unrealized_pl),
                    unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
                    allocation: (parseFloat(position.market_value) / totalValue) * 100,
                    dayChange: parseFloat(position.change_today || 0),
                    dayChangePercent: parseFloat(position.unrealized_intraday_plpc || 0) * 100
                };
            } catch (error) {
                logger.error(`Error getting quote for ${position.symbol}`, error);
                return {
                    symbol: position.symbol,
                    quantity: parseFloat(position.qty),
                    side: position.side,
                    entryPrice: parseFloat(position.avg_entry_price),
                    currentPrice: parseFloat(position.avg_entry_price), // Fallback
                    marketValue: parseFloat(position.market_value),
                    unrealizedPL: parseFloat(position.unrealized_pl),
                    unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
                    allocation: (parseFloat(position.market_value) / totalValue) * 100,
                    dayChange: parseFloat(position.change_today || 0),
                    dayChangePercent: parseFloat(position.unrealized_intraday_plpc || 0) * 100
                };
            }
        }));

        // Calculate risk metrics
        const riskMetrics = {
            portfolioValue: totalValue,
            cashBalance: cashValue,
            investedAmount: investedValue,
            buyingPower: parseFloat(account.buying_power),
            dayTradingBuyingPower: parseFloat(account.daytrading_buying_power),
            maintenanceMargin: parseFloat(account.maintenance_margin),
            portfolioDiversification: positions.length,
            largestPositionPercent: Math.max(...positionDetails.map(p => p.allocation)),
            totalUnrealizedPL: positionDetails.reduce((sum, p) => sum + p.unrealizedPL, 0),
            totalDayChange: positionDetails.reduce((sum, p) => sum + p.dayChange, 0)
        };

        // Format recent orders
        const formattedOrders = last10Orders.map(order => ({
            id: order.id,
            symbol: order.symbol,
            side: order.side,
            quantity: parseFloat(order.qty),
            orderType: order.order_type,
            timeInForce: order.time_in_force,
            status: order.status,
            submittedAt: order.submitted_at,
            filledAt: order.filled_at,
            filledQuantity: parseFloat(order.filled_qty || 0),
            filledPrice: parseFloat(order.filled_avg_price || 0)
        }));

        logger.info('Portfolio data retrieved successfully', {
            positionsCount: positions.length,
            totalValue: totalValue,
            unrealizedPL: riskMetrics.totalUnrealizedPL
        });

        return res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            account: {
                id: account.id,
                accountNumber: account.account_number,
                status: account.status,
                portfolioValue: totalValue,
                equity: parseFloat(account.equity),
                cash: cashValue,
                buyingPower: parseFloat(account.buying_power),
                patternDayTrader: account.pattern_day_trader,
                tradingBlocked: account.trading_blocked
            },
            positions: positionDetails,
            recentOrders: formattedOrders,
            performanceMetrics,
            riskMetrics,
            allocation: {
                cash: (cashValue / totalValue) * 100,
                invested: (investedValue / totalValue) * 100,
                byPosition: positionDetails.map(p => ({
                    symbol: p.symbol,
                    allocation: p.allocation
                }))
            }
        });

    } catch (error) {
        logger.error('Portfolio API error', { 
            error: error.message, 
            stack: error.stack 
        });

        return res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}