
# Serverless Algorithmic Trading System

A sophisticated algorithmic trading system built for Vercel serverless functions, designed to trade leveraged ETFs using proven quantitative strategies.

## Features

### 🚀 **Multiple Trading Strategies**
- **Momentum Strategy**: Moving average crossovers with trend following
- **Mean Reversion**: RSI-based oversold/overbought trading  
- **Regime Detection**: Bull/bear market identification using SPY 200-day MA

### 🛡️ **Comprehensive Risk Management**
- Position sizing based on account equity and volatility
- Stop-loss and take-profit automation
- Daily loss limits and maximum drawdown protection
- Concurrent position limits

### 📊 **Real-time Monitoring & Logging**
- Google Sheets integration for trade and performance logging
- Structured JSON logging for debugging and analysis
- Real-time portfolio tracking and performance metrics

### ⚡ **Serverless Architecture**
- Deployed on Vercel serverless functions
- Scalable and cost-effective
- Zero infrastructure management

## Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo>
cd serverless-algo-trading
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
# Alpaca Trading API (Get from https://app.alpaca.markets/)
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_PAPER=true

# Google Sheets API (Create service account)
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
```

### 3. Deploy to Vercel
```bash
npm run deploy
```

### 4. Set up Automated Execution
Configure a cron job or webhook to call your `/api/trade` endpoint:
```bash
# Example: Every 30 minutes during market hours
curl -X POST https://your-app.vercel.app/api/trade
```

## Trading Strategies

### Momentum Strategy
- **Signal Generation**: 20-day MA crossing above/below 50-day MA on SPY
- **Execution**: Buy TQQQ on bullish crossover, SQQQ on bearish crossover
- **Risk**: 2% of portfolio per position
- **Best For**: Trending markets with clear directional momentum

### Mean Reversion Strategy  
- **Signal Generation**: RSI below 30 (oversold) or above 70 (overbought)
- **Execution**: Buy TQQQ when oversold, SQQQ when overbought
- **Risk**: 1.5% of portfolio per position
- **Best For**: Range-bound, oscillating markets

### Regime Detection Strategy
- **Signal Generation**: SPY price vs 200-day moving average
- **Execution**: TQQQ in bull markets, SQQQ in bear markets
- **Risk**: 3% of portfolio per position  
- **Best For**: Long-term trend identification and positioning

## Risk Management

The system implements multiple layers of risk control:

### Position Sizing
```javascript
// 1% risk per trade with 3% stop loss
const riskAmount = accountEquity * 0.01;
const positionSize = riskAmount / (entryPrice * 0.03);
```

### Daily Loss Limits
- Maximum 2% daily loss before trading halts
- Real-time P&L monitoring and position tracking

### Stop Loss & Take Profit
- Automatic stop loss at 3% below entry
- Take profit target at 6% above entry (2:1 reward/risk ratio)

### Portfolio Limits
- Maximum 5% in any single position
- Maximum 5 concurrent positions
- Minimum $100 position size

## Leveraged ETF Selection

The system focuses on liquid, high-volume leveraged ETFs:

| Symbol | Description | Leverage | Underlying |
|--------|-------------|----------|------------|
| TQQQ   | 3x Nasdaq Bull | 3x | QQQ |
| SQQQ   | 3x Nasdaq Bear | -3x | QQQ |
| UPRO   | 3x S&P Bull | 3x | SPY |
| SPXU   | 3x S&P Bear | -3x | SPY |

**Why Leveraged ETFs?**
- Amplified returns from small price movements
- Lower capital requirements for significant exposure  
- Built-in daily rebalancing reduces volatility decay concerns for short-term trades

## API Endpoints

### `POST /api/trade`
Main trading execution endpoint. Runs all enabled strategies and executes trades.

**Response:**
```json
{
  "status": "success",
  "tradesExecuted": 2,
  "trades": [...],
  "performanceMetrics": {...},
  "timestamp": "2025-09-23T09:47:12Z"
}
```

### `GET /api/portfolio`
Returns current portfolio status and positions.

### `GET /api/logs`
Retrieves recent trading logs and system status.

### `POST /api/backtest`
Runs historical backtesting on specified strategies and time periods.

## Performance Monitoring

### Google Sheets Integration
Automatically logs:
- **Trades Sheet**: All buy/sell orders with timestamps, prices, and P&L
- **Performance Sheet**: Daily equity, returns, and risk metrics

### Key Metrics Tracked
- Total return and daily P&L
- Sharpe ratio and maximum drawdown
- Win rate and average trade duration
- Risk-adjusted returns

## Development and Testing

### Local Development
```bash
npm run dev
# Access at http://localhost:3000
```

### Testing Strategies
```bash
# Run backtest on historical data
curl -X POST http://localhost:3000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategy": "momentum", "start": "2024-01-01", "end": "2024-12-31"}'
```

### Paper Trading
Always start with paper trading (ALPACA_PAPER=true) to validate strategies before using real money.

## Security Best Practices

- Store API keys in Vercel environment variables
- Use Google service accounts with minimal permissions
- Enable Alpaca IP whitelisting if available
- Monitor logs for suspicious activity
- Set up alerts for unusual trading patterns

## Deployment Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cron Job      │───▶│  Vercel         │───▶│   Alpaca API    │
│   (Trigger)     │    │  Serverless     │    │   (Execution)   │
└─────────────────┘    │  Function       │    └─────────────────┘
                       └─────────┬───────┘
                                 │
                                 ▼
                       ┌─────────────────┐
                       │  Google Sheets  │
                       │    (Logging)    │
                       └─────────────────┘
```

## Troubleshooting

### Common Issues

**API Connection Errors**
- Verify Alpaca API keys are correct
- Check paper vs live trading configuration
- Ensure IP whitelisting if enabled

**Google Sheets Errors** 
- Verify service account has edit permissions
- Check private key formatting (escape newlines)
- Ensure spreadsheet ID is correct

**Strategy Not Executing**
- Check if strategy is enabled in environment variables
- Verify minimum data requirements are met
- Review logs for specific error messages

### Debug Mode
Set `LOG_LEVEL=debug` to enable detailed logging for troubleshooting.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with paper trading
4. Submit a pull request with detailed description

## Disclaimer

This software is for educational and research purposes. Trading involves substantial risk of loss. Past performance does not guarantee future results. Always test strategies thoroughly with paper trading before using real money.

## License

MIT License - see LICENSE file for details.
