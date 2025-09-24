// lib/services/marketDataService.js - Hybrid Real Market Data Service
import { Logger } from '../utils/logger.js';

export class MarketDataService {
    constructor() {
        this.logger = new Logger();
        this.dataSources = {
            finnhub: {
                name: 'Finnhub',
                baseUrl: 'https://finnhub.io/api/v1',
                apiKey: process.env.FINNHUB_API_KEY,
                rateLimit: 60, // 60 calls per minute on free tier
                features: ['realtime', 'historical', 'quotes']
            },
            alphavantage: {
                name: 'Alpha Vantage',
                baseUrl: 'https://www.alphavantage.co/query',
                apiKey: process.env.ALPHA_VANTAGE_API_KEY,
                rateLimit: 25, // 25 calls per day on free tier (500 on free subscription)
                features: ['historical', 'quotes', 'indicators']
            },
            yahooFinance: {
                name: 'Yahoo Finance',
                baseUrl: 'https://query1.finance.yahoo.com/v8/finance/chart',
                apiKey: null, // No API key required
                rateLimit: 2000, // 2000 calls per hour
                features: ['realtime', 'historical', 'quotes']
            },
            twelveData: {
                name: 'Twelve Data',
                baseUrl: 'https://api.twelvedata.com',
                apiKey: process.env.TWELVE_DATA_API_KEY,
                rateLimit: 800, // 800 calls per day on free tier
                features: ['realtime', 'historical', 'quotes', 'indicators']
            },
            polygon: {
                name: 'Polygon.io',
                baseUrl: 'https://api.polygon.io',
                apiKey: process.env.POLYGON_API_KEY,
                rateLimit: 5, // 5 calls per minute on free tier
                features: ['historical', 'quotes'] // Real-time requires paid plan
            }
        };

        // Track API usage for rate limiting
        this.apiUsage = {};
        this.initializeUsageTracking();
    }

    initializeUsageTracking() {
        for (const [key, source] of Object.entries(this.dataSources)) {
            this.apiUsage[key] = {
                calls: 0,
                lastReset: Date.now(),
                resetInterval: 60 * 60 * 1000 // 1 hour
            };
        }
    }

    canMakeAPICall(sourceName) {
        const usage = this.apiUsage[sourceName];
        const source = this.dataSources[sourceName];

        if (!usage || !source) return false;

        // Reset usage if interval has passed
        const now = Date.now();
        if (now - usage.lastReset > usage.resetInterval) {
            usage.calls = 0;
            usage.lastReset = now;
        }

        return usage.calls < source.rateLimit;
    }

    recordAPICall(sourceName) {
        if (this.apiUsage[sourceName]) {
            this.apiUsage[sourceName].calls++;
        }
    }

    async getHistoricalData(symbol, limit = 100) {
        this.logger.info('Fetching real market data', { symbol, limit });

        // Try data sources in order of preference
        const sources = ['yahooFinance', 'finnhub', 'twelveData', 'alphavantage', 'polygon'];

        for (const sourceName of sources) {
            if (!this.canMakeAPICall(sourceName)) {
                this.logger.warning(`Rate limit reached for ${sourceName}`, { 
                    sourceName,
                    usage: this.apiUsage[sourceName]
                });
                continue;
            }

            try {
                let data;
                switch (sourceName) {
                    case 'yahooFinance':
                        data = await this.getYahooFinanceData(symbol, limit);
                        break;
                    case 'finnhub':
                        data = await this.getFinnhubData(symbol, limit);
                        break;
                    case 'twelveData':
                        data = await this.getTwelveData(symbol, limit);
                        break;
                    case 'alphavantage':
                        data = await this.getAlphaVantageData(symbol, limit);
                        break;
                    case 'polygon':
                        data = await this.getPolygonData(symbol, limit);
                        break;
                }

                if (data && data.length > 0) {
                    this.recordAPICall(sourceName);
                    this.logger.info('Real market data retrieved successfully', {
                        symbol,
                        source: sourceName,
                        bars: data.length,
                        dateRange: {
                            from: data[0]?.timestamp,
                            to: data[data.length - 1]?.timestamp
                        }
                    });
                    return data;
                }
            } catch (error) {
                this.logger.error(`${sourceName} data fetch failed`, {
                    symbol,
                    source: sourceName,
                    error: error.message
                });
            }
        }

        // Fallback to realistic simulated data if all sources fail
        this.logger.warning('All real data sources failed, using simulated data', { symbol });
        return await this.generateRealisticFallbackData(symbol, limit);
    }

    async getYahooFinanceData(symbol, limit) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const period1 = now - (limit * 24 * 60 * 60 * 1.5); // Extra buffer for weekends

            const url = `${this.dataSources.yahooFinance.baseUrl}/${symbol}?period1=${period1}&period2=${now}&interval=1d&includePrePost=false`;

            this.logger.info('Requesting Yahoo Finance data', { symbol, url: url.substring(0, 100) + '...' });

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.chart?.result?.[0]) {
                throw new Error('No data returned from Yahoo Finance');
            }

            const result = data.chart.result[0];
            const timestamps = result.timestamp;
            const quotes = result.indicators.quote[0];

            if (!timestamps || !quotes) {
                throw new Error('Invalid data structure from Yahoo Finance');    
            }

            const historicalData = [];

            for (let i = 0; i < timestamps.length; i++) {
                if (quotes.close[i] && quotes.close[i] > 0) {
                    historicalData.push({
                        timestamp: new Date(timestamps[i] * 1000).toISOString(),
                        open: parseFloat(quotes.open[i]?.toFixed(2) || quotes.close[i]?.toFixed(2)),
                        high: parseFloat(quotes.high[i]?.toFixed(2) || quotes.close[i]?.toFixed(2)),
                        low: parseFloat(quotes.low[i]?.toFixed(2) || quotes.close[i]?.toFixed(2)),
                        close: parseFloat(quotes.close[i]?.toFixed(2)),
                        volume: parseInt(quotes.volume[i] || 0)
                    });
                }
            }

            return historicalData.reverse().slice(0, limit); // Most recent first, limit results

        } catch (error) {
            this.logger.error('Yahoo Finance data fetch failed', {
                symbol,
                error: error.message
            });
            throw error;
        }
    }

    async getFinnhubData(symbol, limit) {
        if (!this.dataSources.finnhub.apiKey) {
            throw new Error('Finnhub API key not configured');
        }

        try {
            const to = Math.floor(Date.now() / 1000);
            const from = to - (limit * 24 * 60 * 60 * 1.5); // Extra buffer

            const url = `${this.dataSources.finnhub.baseUrl}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${this.dataSources.finnhub.apiKey}`;

            this.logger.info('Requesting Finnhub data', { symbol });

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Finnhub API error: ${response.status}`);
            }

            const data = await response.json();

            if (data.s !== 'ok' || !data.t || data.t.length === 0) {
                throw new Error('No data returned from Finnhub');
            }

            const historicalData = [];

            for (let i = 0; i < data.t.length; i++) {
                historicalData.push({
                    timestamp: new Date(data.t[i] * 1000).toISOString(),
                    open: parseFloat(data.o[i].toFixed(2)),
                    high: parseFloat(data.h[i].toFixed(2)),
                    low: parseFloat(data.l[i].toFixed(2)),
                    close: parseFloat(data.c[i].toFixed(2)),
                    volume: parseInt(data.v[i] || 0)
                });
            }

            return historicalData.reverse().slice(0, limit);

        } catch (error) {
            this.logger.error('Finnhub data fetch failed', {
                symbol,
                error: error.message
            });
            throw error;
        }
    }

    async getTwelveData(symbol, limit) {
        if (!this.dataSources.twelveData.apiKey) {
            throw new Error('Twelve Data API key not configured');
        }

        try {
            const url = `${this.dataSources.twelveData.baseUrl}/time_series?symbol=${symbol}&interval=1day&outputsize=${limit}&apikey=${this.dataSources.twelveData.apiKey}`;

            this.logger.info('Requesting Twelve Data', { symbol });

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Twelve Data API error: ${response.status}`);
            }

            const data = await response.json();

            if (data.status === 'error' || !data.values || data.values.length === 0) {
                throw new Error(data.message || 'No data returned from Twelve Data');
            }

            const historicalData = data.values.map(item => ({
                timestamp: new Date(item.datetime + 'T16:00:00Z').toISOString(),
                open: parseFloat(item.open),
                high: parseFloat(item.high),
                low: parseFloat(item.low),
                close: parseFloat(item.close),
                volume: parseInt(item.volume || 0)
            }));

            return historicalData.slice(0, limit); // Already in reverse chronological order

        } catch (error) {
            this.logger.error('Twelve Data fetch failed', {
                symbol,
                error: error.message
            });
            throw error;
        }
    }

    async getAlphaVantageData(symbol, limit) {
        if (!this.dataSources.alphavantage.apiKey) {
            throw new Error('Alpha Vantage API key not configured');
        }

        try {
            const url = `${this.dataSources.alphavantage.baseUrl}?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${this.dataSources.alphavantage.apiKey}&outputsize=compact`;

            this.logger.info('Requesting Alpha Vantage data', { symbol });

            const response = await fetch(url);
            const data = await response.json();

            if (data['Error Message'] || data['Note']) {
                throw new Error(data['Error Message'] || data['Note'] || 'Alpha Vantage API limit reached');
            }

            const timeSeries = data['Time Series (Daily)'];
            if (!timeSeries) {
                throw new Error('No time series data returned from Alpha Vantage');
            }

            const historicalData = [];
            const dates = Object.keys(timeSeries).slice(0, limit);

            for (const date of dates) {
                const dayData = timeSeries[date];
                historicalData.push({
                    timestamp: new Date(date + 'T16:00:00Z').toISOString(),
                    open: parseFloat(dayData['1. open']),
                    high: parseFloat(dayData['2. high']),
                    low: parseFloat(dayData['3. low']),
                    close: parseFloat(dayData['4. close']),
                    volume: parseInt(dayData['5. volume'])
                });
            }

            return historicalData;

        } catch (error) {
            this.logger.error('Alpha Vantage data fetch failed', {
                symbol,
                error: error.message
            });
            throw error;
        }
    }

    async getPolygonData(symbol, limit) {
        if (!this.dataSources.polygon.apiKey) {
            throw new Error('Polygon API key not configured');
        }

        try {
            const to = new Date().toISOString().split('T')[0];
            const from = new Date(Date.now() - (limit * 24 * 60 * 60 * 1000 * 1.5)).toISOString().split('T')[0];

            const url = `${this.dataSources.polygon.baseUrl}/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=${limit}&apikey=${this.dataSources.polygon.apiKey}`;

            this.logger.info('Requesting Polygon data', { symbol });

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Polygon API error: ${response.status}`);
            }

            const data = await response.json();

            if (data.status !== 'OK' || !data.results || data.results.length === 0) {
                throw new Error('No data returned from Polygon');
            }

            const historicalData = data.results.map(item => ({
                timestamp: new Date(item.t).toISOString(),
                open: parseFloat(item.o.toFixed(2)),
                high: parseFloat(item.h.toFixed(2)),
                low: parseFloat(item.l.toFixed(2)),
                close: parseFloat(item.c.toFixed(2)),
                volume: parseInt(item.v || 0)
            }));

            return historicalData.slice(0, limit);

        } catch (error) {
            this.logger.error('Polygon data fetch failed', {
                symbol,
                error: error.message
            });
            throw error;
        }
    }

    async getCurrentQuote(symbol) {
        this.logger.info('Fetching real-time quote', { symbol });

        // Try real-time sources first
        const realtimeSources = ['finnhub', 'yahooFinance', 'twelveData'];

        for (const sourceName of realtimeSources) {
            if (!this.canMakeAPICall(sourceName)) {
                continue;
            }

            try {
                let quote;
                switch (sourceName) {
                    case 'finnhub':
                        quote = await this.getFinnhubQuote(symbol);
                        break;
                    case 'yahooFinance':
                        quote = await this.getYahooFinanceQuote(symbol);
                        break;
                    case 'twelveData':
                        quote = await this.getTwelveDataQuote(symbol);
                        break;
                }

                if (quote) {
                    this.recordAPICall(sourceName);
                    this.logger.info('Real-time quote retrieved', {
                        symbol,
                        source: sourceName,
                        price: quote.ask
                    });
                    return quote;
                }
            } catch (error) {
                this.logger.error(`${sourceName} quote fetch failed`, {
                    symbol,
                    error: error.message
                });
            }
        }

        // Fallback to historical data for quote
        try {
            const historicalData = await this.getHistoricalData(symbol, 1);
            if (historicalData && historicalData.length > 0) {
                const latestBar = historicalData[0];
                return {
                    symbol,
                    bid: latestBar.close * 0.9995,
                    ask: latestBar.close * 1.0005,
                    bidSize: 100,
                    askSize: 100,
                    timestamp: latestBar.timestamp
                };
            }
        } catch (error) {
            this.logger.error('Historical fallback for quote failed', { symbol, error: error.message });
        }

        throw new Error(`Unable to get quote for ${symbol} from any source`);
    }

    async getFinnhubQuote(symbol) {
        if (!this.dataSources.finnhub.apiKey) {
            throw new Error('Finnhub API key not configured');
        }

        const url = `${this.dataSources.finnhub.baseUrl}/quote?symbol=${symbol}&token=${this.dataSources.finnhub.apiKey}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Finnhub quote API error: ${response.status}`);

        const data = await response.json();

        if (!data.c || data.c <= 0) {
            throw new Error('Invalid quote data from Finnhub');
        }

        return {
            symbol,
            bid: data.c * 0.9995,
            ask: data.c * 1.0005,
            bidSize: 100,
            askSize: 100,
            timestamp: new Date().toISOString()
        };
    }

    async getYahooFinanceQuote(symbol) {
        const url = `${this.dataSources.yahooFinance.baseUrl}/${symbol}?range=1d&interval=1m`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) throw new Error(`Yahoo Finance quote API error: ${response.status}`);

        const data = await response.json();

        if (!data.chart?.result?.[0]) {
            throw new Error('No quote data from Yahoo Finance');
        }

        const result = data.chart.result[0];
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice || meta.previousClose;

        if (!currentPrice || currentPrice <= 0) {
            throw new Error('Invalid quote data from Yahoo Finance');
        }

        return {
            symbol,
            bid: currentPrice * 0.9995,
            ask: currentPrice * 1.0005,
            bidSize: 100,
            askSize: 100,
            timestamp: new Date().toISOString()
        };
    }

    async getTwelveDataQuote(symbol) {
        if (!this.dataSources.twelveData.apiKey) {
            throw new Error('Twelve Data API key not configured');
        }

        const url = `${this.dataSources.twelveData.baseUrl}/quote?symbol=${symbol}&apikey=${this.dataSources.twelveData.apiKey}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Twelve Data quote API error: ${response.status}`);

        const data = await response.json();

        if (data.status === 'error' || !data.close || parseFloat(data.close) <= 0) {
            throw new Error(data.message || 'Invalid quote data from Twelve Data');
        }

        const price = parseFloat(data.close);

        return {
            symbol,
            bid: price * 0.9995,
            ask: price * 1.0005,
            bidSize: 100,
            askSize: 100,
            timestamp: new Date().toISOString()
        };
    }

    async generateRealisticFallbackData(symbol, limit) {
        this.logger.info('Generating realistic fallback data', { symbol, limit });

        // Use actual base prices from recent market data
        const basePrices = {
            'SPY': 428.50,
            'QQQ': 367.25,
            'TQQQ': 46.15,
            'SQQQ': 17.80,
            'IWM': 186.45,
            'UPRO': 56.20,
            'SPXU': 11.85,
            'TNA': 59.30,
            'TZA': 21.75,
            'TECL': 29.40,
            'TECS': 8.25,
            'FAS': 86.50,
            'FAZ': 24.30
        };

        let basePrice = basePrices[symbol.toUpperCase()] || 100.00;

        const data = [];
        const now = new Date();

        for (let i = limit; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);

            // Skip weekends
            if (date.getDay() === 0 || date.getDay() === 6) {
                continue;
            }

            // Generate realistic price movement
            const volatility = this.getVolatilityForSymbol(symbol);
            const drift = 0.0003; // Slight upward bias
            const randomChange = (Math.random() - 0.5) * 2 * volatility + drift;

            basePrice = basePrice * (1 + randomChange);

            const open = basePrice;
            const high = basePrice * (1 + Math.random() * 0.008);
            const low = basePrice * (1 - Math.random() * 0.008);
            const close = low + Math.random() * (high - low);
            const volume = this.getVolumeForSymbol(symbol) * (0.7 + Math.random() * 0.6);

            data.push({
                timestamp: new Date(date.setHours(16, 0, 0, 0)).toISOString(),
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
                volume: Math.floor(volume)
            });
        }

        this.logger.info('Realistic fallback data generated', {
            symbol,
            bars: data.length,
            source: 'Simulated (realistic patterns)',
            priceRange: {
                start: data[0]?.close,
                end: data[data.length - 1]?.close
            }
        });

        return data.reverse();
    }

    getVolatilityForSymbol(symbol) {
        const volatilities = {
            'SPY': 0.012,
            'QQQ': 0.015,
            'TQQQ': 0.045,  // 3x leveraged
            'SQQQ': 0.045,
            'UPRO': 0.036,  // 3x leveraged
            'SPXU': 0.036
        };
        return volatilities[symbol.toUpperCase()] || 0.020;
    }

    getVolumeForSymbol(symbol) {
        const volumes = {
            'SPY': 45000000,
            'QQQ': 42000000,
            'TQQQ': 28000000,
            'SQQQ': 15000000,
            'UPRO': 8000000,
            'SPXU': 3500000
        };
        return volumes[symbol.toUpperCase()] || 1500000;
    }

    getDataSourceStatus() {
        const status = {};

        for (const [key, source] of Object.entries(this.dataSources)) {
            const usage = this.apiUsage[key];
            status[key] = {
                name: source.name,
                configured: source.apiKey !== null && source.apiKey !== undefined,
                calls: usage.calls,
                limit: source.rateLimit,
                remaining: Math.max(0, source.rateLimit - usage.calls),
                resetTime: new Date(usage.lastReset + usage.resetInterval).toISOString(),
                features: source.features
            };
        }

        return status;
    }
}