// Application Data
const appData = {
    "strategies": [
        {"name": "Momentum Strategy", "description": "Moving average crossover with trend following", "enabled": true, "parameters": {"ma_short": 20, "ma_long": 50, "min_volume": 100000, "position_size": 2}},
        {"name": "Mean Reversion", "description": "RSI-based oversold/overbought trading", "enabled": false, "parameters": {"rsi_period": 14, "oversold_threshold": 30, "overbought_threshold": 70, "position_size": 1.5}},
        {"name": "Regime Detection", "description": "Bull/bear market detection using SPY 200-day MA", "enabled": true, "parameters": {"lookback_period": 200, "bull_etf": "TQQQ", "bear_etf": "SQQQ", "position_size": 3}}
    ],
    "portfolio": {
        "cash": 98500,
        "total_value": 101200,
        "positions": [
            {"symbol": "TQQQ", "quantity": 50, "current_price": 54.2, "entry_price": 52.8, "unrealized_pnl": 70, "market_value": 2710},
            {"symbol": "Cash", "quantity": 1, "current_price": 98500, "entry_price": 98500, "unrealized_pnl": 0, "market_value": 98500}
        ],
        "daily_pnl": 285,
        "total_pnl": 1200
    },
    "recent_trades": [
        {"timestamp": "2025-09-23 09:35:00", "symbol": "TQQQ", "action": "BUY", "quantity": 50, "price": 52.8, "strategy": "Momentum", "pnl": null},
        {"timestamp": "2025-09-22 15:45:00", "symbol": "SQQQ", "action": "SELL", "quantity": 30, "price": 18.9, "strategy": "Regime Detection", "pnl": 45},
        {"timestamp": "2025-09-22 10:15:00", "symbol": "SQQQ", "action": "BUY", "quantity": 30, "price": 17.4, "strategy": "Regime Detection", "pnl": null}
    ],
    "performance_metrics": {
        "total_return": 1.2,
        "daily_return": 0.28,
        "sharpe_ratio": 1.85,
        "max_drawdown": -2.1,
        "win_rate": 0.67,
        "total_trades": 45
    },
    "system_status": {
        "api_connected": true,
        "last_update": "2025-09-23 09:47:12",
        "strategies_running": 2,
        "errors_24h": 1,
        "uptime": "99.8%"
    },
    "etf_symbols": ["TQQQ", "SQQQ", "UPRO", "SPXU", "TECL", "TECS", "FAS", "FAZ", "TNA", "TZA"],
    "log_entries": [
        {"timestamp": "2025-09-23 09:47:12", "level": "INFO", "message": "RSI for TQQQ: 68.5 - Approaching overbought territory", "strategy": "Mean Reversion"},
        {"timestamp": "2025-09-23 09:46:45", "level": "SUCCESS", "message": "Position opened: TQQQ 50 shares at $52.80", "strategy": "Momentum"},
        {"timestamp": "2025-09-23 09:45:30", "level": "WARNING", "message": "High volatility detected - reducing position sizes by 25%", "strategy": "Risk Management"},
        {"timestamp": "2025-09-23 09:44:15", "level": "INFO", "message": "MA crossover detected: 20-day MA crossed above 50-day MA for QQQ", "strategy": "Momentum"}
    ]
};

// Global variables
let performanceChart = null;
let backtestChart = null;
let currentLogLevel = 'all';

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    loadDashboardData();
    initializeStrategies();
    initializeETFGrid();
    initializeLogs();
    initializeCharts();
    initializeEventListeners();
    
    // Simulate real-time updates
    setInterval(updateRealTimeData, 5000);
});

// Navigation handling - FIXED
function initializeNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
            
            // Hide all tab contents
            const allTabs = document.querySelectorAll('.tab-content');
            allTabs.forEach(tab => {
                tab.classList.remove('active');
                tab.style.display = 'none';
            });
            
            // Show the selected tab
            const tabId = this.getAttribute('data-tab');
            const targetTab = document.getElementById(tabId);
            if (targetTab) {
                targetTab.classList.add('active');
                targetTab.style.display = 'block';
            }
        });
    });
    
    // Ensure dashboard tab is initially visible
    const dashboardTab = document.getElementById('dashboard');
    if (dashboardTab) {
        dashboardTab.style.display = 'block';
    }
}

// Load dashboard data
function loadDashboardData() {
    // Portfolio overview
    document.getElementById('totalValue').textContent = formatCurrency(appData.portfolio.total_value);
    document.getElementById('cashValue').textContent = formatCurrency(appData.portfolio.cash);
    document.getElementById('dailyPnl').textContent = formatCurrency(appData.portfolio.daily_pnl, true);
    document.getElementById('totalPnl').textContent = formatCurrency(appData.portfolio.total_pnl, true);
    
    // Performance metrics
    document.getElementById('totalReturn').textContent = appData.performance_metrics.total_return + '%';
    document.getElementById('sharpeRatio').textContent = appData.performance_metrics.sharpe_ratio;
    document.getElementById('maxDrawdown').textContent = appData.performance_metrics.max_drawdown + '%';
    document.getElementById('winRate').textContent = Math.round(appData.performance_metrics.win_rate * 100) + '%';
    
    // Load positions
    loadPositions();
    
    // Load recent trades
    loadRecentTrades();
    
    // Update system status
    updateSystemStatus();
}

// Load positions
function loadPositions() {
    const positionsTableBody = document.getElementById('positionsTableBody');
    const positionsDetailed = document.getElementById('positionsDetailed');
    
    if (positionsTableBody) {
        positionsTableBody.innerHTML = '';
        
        appData.portfolio.positions.forEach(position => {
            if (position.symbol !== 'Cash') {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${position.symbol}</strong></td>
                    <td>${position.quantity}</td>
                    <td>$${position.entry_price.toFixed(2)}</td>
                    <td>$${position.current_price.toFixed(2)}</td>
                    <td class="${position.unrealized_pnl >= 0 ? 'positive' : 'negative'}">
                        ${formatCurrency(position.unrealized_pnl, true)}
                    </td>
                    <td>$${position.market_value.toLocaleString()}</td>
                `;
                positionsTableBody.appendChild(row);
            }
        });
    }
    
    if (positionsDetailed) {
        positionsDetailed.innerHTML = '';
        
        appData.portfolio.positions.forEach(position => {
            if (position.symbol !== 'Cash') {
                const positionItem = document.createElement('div');
                positionItem.className = 'position-item';
                positionItem.innerHTML = `
                    <div class="position-header">
                        <div class="position-symbol">${position.symbol}</div>
                        <div class="position-actions">
                            <button class="btn btn--sm btn--secondary" onclick="closePosition('${position.symbol}')">Close</button>
                            <button class="btn btn--sm btn--outline" onclick="adjustPosition('${position.symbol}')">Adjust</button>
                        </div>
                    </div>
                    <div class="metric-row">
                        <div class="metric">
                            <label>Quantity</label>
                            <span class="value">${position.quantity}</span>
                        </div>
                        <div class="metric">
                            <label>Entry Price</label>
                            <span class="value">$${position.entry_price.toFixed(2)}</span>
                        </div>
                        <div class="metric">
                            <label>Current Price</label>
                            <span class="value">$${position.current_price.toFixed(2)}</span>
                        </div>
                        <div class="metric">
                            <label>Unrealized P&L</label>
                            <span class="value ${position.unrealized_pnl >= 0 ? 'positive' : 'negative'}">
                                ${formatCurrency(position.unrealized_pnl, true)}
                            </span>
                        </div>
                    </div>
                `;
                positionsDetailed.appendChild(positionItem);
            }
        });
    }
    
    updatePositionControls();
}

// Load recent trades
function loadRecentTrades() {
    const tradesTableBody = document.getElementById('tradesTableBody');
    if (tradesTableBody) {
        tradesTableBody.innerHTML = '';
        
        appData.recent_trades.forEach(trade => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatTime(trade.timestamp)}</td>
                <td><strong>${trade.symbol}</strong></td>
                <td class="${trade.action === 'BUY' ? 'buy-action' : 'sell-action'}">${trade.action}</td>
                <td>${trade.quantity}</td>
                <td>$${trade.price.toFixed(2)}</td>
                <td>${trade.strategy}</td>
                <td class="${trade.pnl && trade.pnl >= 0 ? 'positive' : trade.pnl ? 'negative' : ''}">
                    ${trade.pnl ? formatCurrency(trade.pnl, true) : '-'}
                </td>
            `;
            tradesTableBody.appendChild(row);
        });
    }
}

// Initialize strategies
function initializeStrategies() {
    // Strategy tabs
    const strategyTabs = document.querySelectorAll('.strategy-tab');
    const strategyConfigs = document.querySelectorAll('.strategy-config');
    
    strategyTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            strategyTabs.forEach(t => t.classList.remove('active'));
            strategyConfigs.forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            const strategyId = this.getAttribute('data-strategy') + 'Strategy';
            const targetConfig = document.getElementById(strategyId);
            if (targetConfig) {
                targetConfig.classList.add('active');
            }
        });
    });
    
    // Load strategy parameters
    appData.strategies.forEach(strategy => {
        if (strategy.name === 'Momentum Strategy') {
            const momentumEnabled = document.getElementById('momentumEnabled');
            const maShort = document.getElementById('maShort');
            const maLong = document.getElementById('maLong');
            const momentumPositionSize = document.getElementById('momentumPositionSize');
            
            if (momentumEnabled) momentumEnabled.checked = strategy.enabled;
            if (maShort) maShort.value = strategy.parameters.ma_short;
            if (maLong) maLong.value = strategy.parameters.ma_long;
            if (momentumPositionSize) momentumPositionSize.value = strategy.parameters.position_size;
        } else if (strategy.name === 'Mean Reversion') {
            const meanReversionEnabled = document.getElementById('meanReversionEnabled');
            const rsiPeriod = document.getElementById('rsiPeriod');
            const oversoldThreshold = document.getElementById('oversoldThreshold');
            const overboughtThreshold = document.getElementById('overboughtThreshold');
            
            if (meanReversionEnabled) meanReversionEnabled.checked = strategy.enabled;
            if (rsiPeriod) rsiPeriod.value = strategy.parameters.rsi_period;
            if (oversoldThreshold) oversoldThreshold.value = strategy.parameters.oversold_threshold;
            if (overboughtThreshold) overboughtThreshold.value = strategy.parameters.overbought_threshold;
        } else if (strategy.name === 'Regime Detection') {
            const regimeEnabled = document.getElementById('regimeEnabled');
            const lookbackPeriod = document.getElementById('lookbackPeriod');
            const bullEtf = document.getElementById('bullEtf');
            const bearEtf = document.getElementById('bearEtf');
            
            if (regimeEnabled) regimeEnabled.checked = strategy.enabled;
            if (lookbackPeriod) lookbackPeriod.value = strategy.parameters.lookback_period;
            if (bullEtf) bullEtf.value = strategy.parameters.bull_etf;
            if (bearEtf) bearEtf.value = strategy.parameters.bear_etf;
        }
    });
}

// Initialize ETF grid
function initializeETFGrid() {
    const etfGrid = document.getElementById('etfGrid');
    if (etfGrid) {
        etfGrid.innerHTML = '';
        
        appData.etf_symbols.forEach(symbol => {
            const etfElement = document.createElement('div');
            etfElement.className = 'etf-symbol';
            etfElement.textContent = symbol;
            etfElement.addEventListener('click', function() {
                this.classList.toggle('selected');
            });
            etfGrid.appendChild(etfElement);
        });
    }
}

// Initialize logs
function initializeLogs() {
    loadLogs();
    
    const logLevel = document.getElementById('logLevel');
    if (logLevel) {
        logLevel.addEventListener('change', function() {
            currentLogLevel = this.value;
            loadLogs();
        });
    }
    
    const clearLogs = document.getElementById('clearLogs');
    if (clearLogs) {
        clearLogs.addEventListener('click', function() {
            const logViewer = document.getElementById('logViewer');
            if (logViewer) {
                logViewer.innerHTML = '';
            }
        });
    }
}

// Load logs
function loadLogs() {
    const logViewer = document.getElementById('logViewer');
    if (logViewer) {
        logViewer.innerHTML = '';
        
        let filteredLogs = appData.log_entries;
        if (currentLogLevel !== 'all') {
            filteredLogs = appData.log_entries.filter(log => log.level === currentLogLevel);
        }
        
        filteredLogs.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            logEntry.innerHTML = `
                <div class="log-timestamp">${formatTime(log.timestamp)}</div>
                <div class="log-level ${log.level}">${log.level}</div>
                <div class="log-message">${log.message}</div>
                <div class="log-strategy">${log.strategy}</div>
            `;
            logViewer.appendChild(logEntry);
        });
        
        // Scroll to bottom
        logViewer.scrollTop = logViewer.scrollHeight;
    }
}

// Initialize charts
function initializeCharts() {
    // Performance chart
    const performanceCanvas = document.getElementById('performanceChart');
    if (performanceCanvas) {
        const performanceCtx = performanceCanvas.getContext('2d');
        const performanceData = generatePerformanceData();
        
        performanceChart = new Chart(performanceCtx, {
            type: 'line',
            data: {
                labels: performanceData.labels,
                datasets: [{
                    label: 'Portfolio Value',
                    data: performanceData.values,
                    borderColor: '#1FB8CD',
                    backgroundColor: 'rgba(31, 184, 205, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Backtest chart placeholder
    const backtestCanvas = document.getElementById('backtestChart');
    if (backtestCanvas) {
        const backtestCtx = backtestCanvas.getContext('2d');
        backtestChart = new Chart(backtestCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true
                    }
                }
            }
        });
    }
}

// Initialize event listeners
function initializeEventListeners() {
    // Emergency stop
    const emergencyStop = document.getElementById('emergencyStop');
    if (emergencyStop) {
        emergencyStop.addEventListener('click', function() {
            if (confirm('Are you sure you want to stop all trading activities?')) {
                showNotification('Emergency stop activated', 'warning');
            }
        });
    }
    
    // Save strategies
    const saveStrategies = document.getElementById('saveStrategies');
    if (saveStrategies) {
        saveStrategies.addEventListener('click', saveStrategiesHandler);
    }
    
    // Save risk settings
    const saveRisk = document.getElementById('saveRisk');
    if (saveRisk) {
        saveRisk.addEventListener('click', saveRiskSettings);
    }
    
    // Manual trading
    const orderType = document.getElementById('orderType');
    if (orderType) {
        orderType.addEventListener('change', function() {
            const limitPriceGroup = document.getElementById('limitPriceGroup');
            if (limitPriceGroup) {
                if (this.value === 'limit') {
                    limitPriceGroup.style.display = 'block';
                } else {
                    limitPriceGroup.style.display = 'none';
                }
            }
        });
    }
    
    const manualBuy = document.getElementById('manualBuy');
    if (manualBuy) {
        manualBuy.addEventListener('click', () => executeManualTrade('BUY'));
    }
    
    const manualSell = document.getElementById('manualSell');
    if (manualSell) {
        manualSell.addEventListener('click', () => executeManualTrade('SELL'));
    }
    
    // Run backtest
    const runBacktest = document.getElementById('runBacktest');
    if (runBacktest) {
        runBacktest.addEventListener('click', runBacktestHandler);
    }
}

// Helper functions
function formatCurrency(amount, showSign = false) {
    const formatted = '$' + Math.abs(amount).toLocaleString();
    if (showSign && amount !== 0) {
        return amount >= 0 ? '+' + formatted : '-' + formatted;
    }
    return formatted;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function generatePerformanceData() {
    const labels = [];
    const values = [];
    const baseValue = 100000;
    
    for (let i = 30; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString());
        
        // Generate realistic performance data
        const variation = (Math.random() - 0.5) * 2000;
        const dayReturn = baseValue + variation + (i * 40);
        values.push(Math.max(dayReturn, 95000));
    }
    
    return { labels, values };
}

function updateSystemStatus() {
    const status = appData.system_status;
    
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        lastUpdate.textContent = status.last_update;
    }
    
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusDot && statusText) {
        if (status.api_connected) {
            statusDot.style.backgroundColor = 'var(--color-success)';
            statusText.textContent = 'API Connected';
        } else {
            statusDot.style.backgroundColor = 'var(--color-error)';
            statusText.textContent = 'API Disconnected';
        }
    }
}

function updatePositionControls() {
    const positionControls = document.getElementById('positionControls');
    if (positionControls) {
        positionControls.innerHTML = '';
        
        appData.portfolio.positions.forEach(position => {
            if (position.symbol !== 'Cash') {
                const controlItem = document.createElement('div');
                controlItem.className = 'position-control-item';
                controlItem.innerHTML = `
                    <div class="position-control-info">
                        <div class="position-control-symbol">${position.symbol}</div>
                        <div class="position-control-details">${position.quantity} shares @ $${position.current_price.toFixed(2)}</div>
                    </div>
                    <div class="position-control-actions">
                        <button class="btn btn--sm btn--error" onclick="closePosition('${position.symbol}')">Close</button>
                    </div>
                `;
                positionControls.appendChild(controlItem);
            }
        });
    }
}

function saveStrategiesHandler() {
    // Collect strategy configuration
    const strategies = {
        momentum: {
            enabled: document.getElementById('momentumEnabled')?.checked || false,
            maShort: parseInt(document.getElementById('maShort')?.value || '20'),
            maLong: parseInt(document.getElementById('maLong')?.value || '50'),
            positionSize: parseFloat(document.getElementById('momentumPositionSize')?.value || '2')
        },
        meanReversion: {
            enabled: document.getElementById('meanReversionEnabled')?.checked || false,
            rsiPeriod: parseInt(document.getElementById('rsiPeriod')?.value || '14'),
            oversoldThreshold: parseInt(document.getElementById('oversoldThreshold')?.value || '30'),
            overboughtThreshold: parseInt(document.getElementById('overboughtThreshold')?.value || '70')
        },
        regime: {
            enabled: document.getElementById('regimeEnabled')?.checked || false,
            lookbackPeriod: parseInt(document.getElementById('lookbackPeriod')?.value || '200'),
            bullEtf: document.getElementById('bullEtf')?.value || 'TQQQ',
            bearEtf: document.getElementById('bearEtf')?.value || 'SQQQ'
        }
    };
    
    showNotification('Strategy configuration saved', 'success');
    console.log('Saving strategies:', strategies);
}

function saveRiskSettings() {
    const riskSettings = {
        maxDailyLoss: parseFloat(document.getElementById('maxDailyLoss')?.value || '5'),
        maxPositionSize: parseFloat(document.getElementById('maxPositionSize')?.value || '10'),
        stopLoss: parseFloat(document.getElementById('stopLoss')?.value || '3'),
        takeProfit: parseFloat(document.getElementById('takeProfit')?.value || '6')
    };
    
    showNotification('Risk settings updated', 'success');
    console.log('Saving risk settings:', riskSettings);
}

function executeManualTrade(action) {
    const symbol = document.getElementById('manualSymbol')?.value || 'TQQQ';
    const quantity = parseInt(document.getElementById('manualQuantity')?.value || '10');
    const orderType = document.getElementById('orderType')?.value || 'market';
    const limitPrice = orderType === 'limit' ? parseFloat(document.getElementById('limitPrice')?.value || '0') : null;
    
    const trade = {
        symbol,
        action,
        quantity,
        orderType,
        limitPrice
    };
    
    showNotification(`${action} order submitted for ${quantity} shares of ${symbol}`, 'success');
    console.log('Manual trade executed:', trade);
}

function closePosition(symbol) {
    if (confirm(`Are you sure you want to close your ${symbol} position?`)) {
        showNotification(`Closing ${symbol} position`, 'warning');
        console.log('Closing position:', symbol);
    }
}

function adjustPosition(symbol) {
    const newSize = prompt(`Enter new position size for ${symbol}:`);
    if (newSize) {
        showNotification(`Adjusting ${symbol} position to ${newSize} shares`, 'info');
        console.log('Adjusting position:', symbol, newSize);
    }
}

function runBacktestHandler() {
    const startDate = document.getElementById('backtestStart')?.value || '2024-01-01';
    const endDate = document.getElementById('backtestEnd')?.value || '2025-09-23';
    const initialCapital = parseInt(document.getElementById('initialCapital')?.value || '100000');
    
    showNotification('Running backtest...', 'info');
    
    // Simulate backtest results
    setTimeout(() => {
        const backtestData = generateBacktestData(startDate, endDate, initialCapital);
        updateBacktestChart(backtestData);
        showNotification('Backtest completed', 'success');
    }, 2000);
}

function generateBacktestData(startDate, endDate, initialCapital) {
    const labels = [];
    const values = [];
    
    let currentValue = initialCapital;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    for (let i = 0; i <= daysDiff; i += 7) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        labels.push(date.toLocaleDateString());
        
        const variation = (Math.random() - 0.45) * currentValue * 0.02;
        currentValue = Math.max(currentValue + variation, initialCapital * 0.7);
        values.push(Math.round(currentValue));
    }
    
    return { labels, values };
}

function updateBacktestChart(data) {
    if (backtestChart) {
        backtestChart.data.labels = data.labels;
        backtestChart.data.datasets = [{
            label: 'Backtest Results',
            data: data.values,
            borderColor: '#FFC185',
            backgroundColor: 'rgba(255, 193, 133, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
        }];
        backtestChart.update();
    }
}

function updateRealTimeData() {
    // Simulate real-time updates
    const now = new Date();
    const timeString = now.getFullYear() + '-' + 
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        lastUpdate.textContent = timeString;
    }
    
    // Add new log entry occasionally
    if (Math.random() < 0.3) {
        const newLog = {
            timestamp: timeString,
            level: ['INFO', 'SUCCESS', 'WARNING'][Math.floor(Math.random() * 3)],
            message: 'System monitoring update - all systems operational',
            strategy: 'System'
        };
        appData.log_entries.unshift(newLog);
        appData.log_entries = appData.log_entries.slice(0, 50); // Keep only last 50 logs
        
        if (currentLogLevel === 'all' || currentLogLevel === newLog.level) {
            loadLogs();
        }
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        transition: all 0.3s ease;
    `;
    
    switch (type) {
        case 'success':
            notification.style.backgroundColor = 'var(--color-success)';
            break;
        case 'error':
            notification.style.backgroundColor = 'var(--color-error)';
            break;
        case 'warning':
            notification.style.backgroundColor = 'var(--color-warning)';
            break;
        default:
            notification.style.backgroundColor = 'var(--color-info)';
    }
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}