// api/test-sheets.js - Google Sheets Connection Test
import { GoogleSheetsLogger } from '../lib/utils/googleSheets.js';
import { AlpacaApi } from '../lib/brokers/alpacaHybrid.js';

export default async function handler(req, res) {
    const results = {
        timestamp: new Date().toISOString(),
        tests: {},
        environment: {},
        status: 'success'
    };

    try {
        // Test environment variables
        results.environment = {
            alpaca: {
                hasApiKey: !!process.env.ALPACA_API_KEY,
                hasSecretKey: !!process.env.ALPACA_SECRET_KEY,
                isPaperTrading: process.env.ALPACA_PAPER === 'true'
            },
            googleSheets: {
                hasClientEmail: !!process.env.GOOGLE_CLIENT_EMAIL,
                hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
                hasSpreadsheetId: !!process.env.GOOGLE_SPREADSHEET_ID,
                clientEmailSample: process.env.GOOGLE_CLIENT_EMAIL ? 
                    process.env.GOOGLE_CLIENT_EMAIL.substring(0, 20) + '...' : 
                    'NOT SET'
            },
            strategies: {
                momentumEnabled: process.env.MOMENTUM_ENABLED === 'true',
                meanReversionEnabled: process.env.MEAN_REVERSION_ENABLED === 'true',
                regimeDetectionEnabled: process.env.REGIME_DETECTION_ENABLED === 'true'
            }
        };

        // Test Alpaca Connection
        try {
            const alpaca = new AlpacaApi({
                keyId: process.env.ALPACA_API_KEY,
                secretKey: process.env.ALPACA_SECRET_KEY,
                paper: process.env.ALPACA_PAPER === 'true',
                baseUrl: process.env.ALPACA_PAPER === 'true' ? 
                    'https://paper-api.alpaca.markets' : 
                    'https://api.alpaca.markets'
            });

            const account = await alpaca.getAccount();
            const isMarketOpen = await alpaca.isMarketOpen();

            results.tests.alpaca = {
                success: true,
                account: {
                    id: account.id,
                    status: account.status,
                    equity: parseFloat(account.equity),
                    buyingPower: parseFloat(account.buying_power)
                },
                market: {
                    isOpen: isMarketOpen
                }
            };
        } catch (alpacaError) {
            results.tests.alpaca = {
                success: false,
                error: alpacaError.message
            };
            results.status = 'partial_failure';
        }

        // Test Google Sheets Connection
        try {
            const sheetsLogger = new GoogleSheetsLogger();
            const sheetsTest = await sheetsLogger.testConnection();

            results.tests.googleSheets = {
                success: sheetsTest.success,
                enabled: sheetsLogger.enabled,
                title: sheetsTest.title || null,
                error: sheetsTest.error || null
            };

            if (!sheetsTest.success) {
                results.status = 'partial_failure';
            }
        } catch (sheetsError) {
            results.tests.googleSheets = {
                success: false,
                enabled: false,
                error: sheetsError.message
            };
            results.status = 'partial_failure';
        }

        // Test Historical Data (the main issue from logs)
        try {
            const alpaca = new AlpacaApi({
                keyId: process.env.ALPACA_API_KEY,
                secretKey: process.env.ALPACA_SECRET_KEY,
                paper: process.env.ALPACA_PAPER === 'true',
                baseUrl: process.env.ALPACA_PAPER === 'true' ? 
                    'https://paper-api.alpaca.markets' : 
                    'https://api.alpaca.markets'
            });

            const spyData = await alpaca.getHistoricalData('SPY', '1Day', 10);

            results.tests.historicalData = {
                success: true,
                symbol: 'SPY',
                barsReceived: spyData.length,
                latestData: spyData.length > 0 ? {
                    timestamp: spyData[0].timestamp,
                    close: spyData[0].close
                } : null
            };
        } catch (historyError) {
            results.tests.historicalData = {
                success: false,
                error: historyError.message,
                symbol: 'SPY'
            };
            results.status = 'partial_failure';
        }

        // Overall status
        if (results.status === 'success') {
            results.message = 'All systems operational!';
        } else {
            results.message = 'Some systems have issues - check individual test results';
        }

        return res.json(results);

    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString(),
            stack: error.stack
        });
    }
}