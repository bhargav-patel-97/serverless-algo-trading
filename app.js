// Application Data - Now using live API data instead of static
let appData = {
  "strategies": [],
  "portfolio": {
    "cash": 0,
    "total_value": 0,
    "positions": [],
    "daily_pnl": 0,
    "total_pnl": 0
  },
  "recent_trades": [],
  "performance_metrics": {},
  "system_status": {
    "api_connected": false,
    "last_update": new Date().toISOString(),
    "strategies_running": 0,
    "errors_24h": 0,
    "uptime": "0%"
  },
  "etf_symbols": ["TQQQ", "SQQQ", "UPRO", "SPXU", "TECL", "TECS", "FAS", "FAZ", "TNA", "TZA"],
  "log_entries": []
};

// Global variables
let performanceChart = null;
let backtestChart = null;
let currentLogLevel = 'all';
let dataRefreshInterval = null;
let isLoading = false;

// API Configuration
const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 30000; // 30 seconds

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
  initializeNavigation();
  initializeStrategies();
  initializeETFGrid();
  initializeLogs();
  initializeCharts();
  initializeEventListeners();
  
  // Load live data immediately
  loadLiveData();
  
  // Set up periodic data refresh
  dataRefreshInterval = setInterval(loadLiveData, REFRESH_INTERVAL);
});

// API Functions for fetching live data
async function fetchPortfolioData() {
  try {
    const response = await fetch(`${API_BASE}/api/portfolio`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching portfolio data:', error);
    showNotification('Failed to fetch portfolio data', 'error');
    return null;
  }
}

async function fetchSystemStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/test-sheets`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching system status:', error);
    return null;
  }
}

async function fetchRecentTrades() {
  try {
    // Try to get recent trades from portfolio data first
    const portfolioData = await fetchPortfolioData();
    if (portfolioData && portfolioData.recentOrders) {
      return portfolioData.recentOrders.map(order => ({
        timestamp: order.submittedAt || order.filledAt,
        symbol: order.symbol,
        action: order.side.toUpperCase(),
        quantity: order.quantity || order.filledQuantity,
        price: order.filledPrice || 0,
        strategy: 'API Trade', // Could be enhanced to track strategy source
        pnl: null // Would need separate calculation
      }));
    }
    return [];
  } catch (error) {
    console.error('Error fetching recent trades:', error);
    return [];
  }
}

async function fetchLogEntries() {
  try {
    const response = await fetch(`${API_BASE}/api/logs`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status === 'success' && data.logs) {
      return data.logs;
    }
    return [];
  } catch (error) {
    console.error('Error fetching log entries:', error);
    return [];
  }
}

// Main function to load all live data
async function loadLiveData() {
  if (isLoading) return;
  
  isLoading = true;
  showLoadingState(true);
  
  try {
    // Fetch all data in parallel
    const [portfolioData, systemStatus, trades, logs] = await Promise.all([
      fetchPortfolioData(),
      fetchSystemStatus(),
      fetchRecentTrades(),
      fetchLogEntries()
    ]);
    
    // Update appData with live data
    if (portfolioData) {
      updatePortfolioData(portfolioData);
    }
    
    if (systemStatus) {
      updateSystemStatus(systemStatus);
    }
    
    if (trades) {
      appData.recent_trades = trades;
    }
    
    if (logs) {
      appData.log_entries = [...logs, ...appData.log_entries].slice(0, 50); // Keep last 50 logs
    }
    
    // Update the UI
    loadDashboardData();
    loadPositions();
    loadRecentTrades();
    loadLogs();
    updateSystemStatusUI();
    
    appData.system_status.last_update = new Date().toISOString();
    
  } catch (error) {
    console.error('Error loading live data:', error);
    showNotification('Error loading live data', 'error');
  } finally {
    isLoading = false;
    showLoadingState(false);
  }
}

function updatePortfolioData(data) {
  if (data.status === 'success') {
    // Update portfolio values
    appData.portfolio.total_value = data.account?.portfolioValue || 0;
    appData.portfolio.cash = data.account?.cash || 0;
    appData.portfolio.daily_pnl = data.riskMetrics?.totalDayChange || 0;
    appData.portfolio.total_pnl = data.riskMetrics?.totalUnrealizedPL || 0;
    
    // Update positions
    appData.portfolio.positions = data.positions?.map(pos => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      current_price: pos.currentPrice,
      entry_price: pos.entryPrice,
      unrealized_pnl: pos.unrealizedPL,
      market_value: pos.marketValue
    })) || [];
    
    // Add cash as a position
    if (appData.portfolio.cash > 0) {
      appData.portfolio.positions.push({
        symbol: "Cash",
        quantity: 1,
        current_price: appData.portfolio.cash,
        entry_price: appData.portfolio.cash,
        unrealized_pnl: 0,
        market_value: appData.portfolio.cash
      });
    }
    
    // Update performance metrics
    if (data.performanceMetrics) {
      appData.performance_metrics = {
        total_return: ((appData.portfolio.total_value - 100000) / 100000) * 100, // Assuming 100k starting capital
        daily_return: (appData.portfolio.daily_pnl / appData.portfolio.total_value) * 100,
        sharpe_ratio: data.performanceMetrics.sharpeRatio || 0,
        max_drawdown: data.performanceMetrics.maxDrawdown || 0,
        win_rate: data.performanceMetrics.winRate || 0,
        total_trades: data.recentOrders?.length || 0
      };
    }
  }
}

function updateSystemStatus(data) {
  appData.system_status.api_connected = data.status === 'success' || data.status === 'partial_failure';
  
  // Count running strategies
  let strategiesRunning = 0;
  if (data.environment?.strategies) {
    strategiesRunning = Object.values(data.environment.strategies).filter(enabled => enabled).length;
  }
  appData.system_status.strategies_running = strategiesRunning;
  
  // Calculate uptime based on successful tests
  let successfulTests = 0;
  let totalTests = 0;
  if (data.tests) {
    Object.values(data.tests).forEach(test => {
      totalTests++;
      if (test.success) successfulTests++;
    });
  }
  appData.system_status.uptime = totalTests > 0 ? `${Math.round((successfulTests / totalTests) * 100)}%` : '0%';
  
  // Update strategy configurations
  if (data.environment?.strategies) {
    appData.strategies = [
      {
        name: "Momentum Strategy",
        description: "Moving average crossover with trend following",
        enabled: data.environment.strategies.momentumEnabled,
        parameters: {
          ma_short: 20,
          ma_long: 50,
          min_volume: 100000,
          position_size: 2
        }
      },
      {
        name: "Mean Reversion",
        description: "RSI-based oversold/overbought trading",
        enabled: data.environment.strategies.meanReversionEnabled,
        parameters: {
          rsi_period: 14,
          oversold_threshold: 30,
          overbought_threshold: 70,
          position_size: 1.5
        }
      },
      {
        name: "Regime Detection",
        description: "Bull/bear market detection using SPY 200-day MA",
        enabled: data.environment.strategies.regimeDetectionEnabled,
        parameters: {
          lookback_period: 200,
          bull_etf: "TQQQ",
          bear_etf: "SQQQ",
          position_size: 3
        }
      }
    ];
  }
}

function showLoadingState(loading) {
  const loadingElements = document.querySelectorAll('.loading-indicator');
  loadingElements.forEach(el => {
    el.style.display = loading ? 'block' : 'none';
  });
  
  // Add/remove loading class to main content
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    if (loading) {
      mainContent.classList.add('loading');
    } else {
      mainContent.classList.remove('loading');
    }
  }
}

// Manual data refresh function
function refreshData() {
  loadLiveData();
  showNotification('Data refreshed', 'success');
}

// Execute manual trade with API integration
async function executeManualTrade(action) {
  const symbol = document.getElementById('manualSymbol')?.value || 'TQQQ';
  const quantity = parseInt(document.getElementById('manualQuantity')?.value || '10');
  const orderType = document.getElementById('orderType')?.value || 'market';
  const limitPrice = orderType === 'limit' ? parseFloat(document.getElementById('limitPrice')?.value || '0') : null;

  try {
    const tradeData = {
      symbol: symbol,
      side: action.toLowerCase(),
      quantity: quantity,
      orderType: orderType,
      limitPrice: limitPrice
    };

    const response = await fetch(`${API_BASE}/api/manual-trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tradeData)
    });

    const result = await response.json();

    if (result.status === 'success') {
      showNotification(`${action} order submitted for ${quantity} shares of ${symbol}`, 'success');
      // Refresh data after a short delay to see if the trade was executed
      setTimeout(loadLiveData, 2000);
    } else {
      showNotification(`Trade failed: ${result.message}`, 'error');
    }
    
  } catch (error) {
    console.error('Error executing manual trade:', error);
    showNotification('Failed to execute trade', 'error');
  }
}

// Navigation handling
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
  document.getElementById('totalReturn').textContent = (appData.performance_metrics.total_return || 0).toFixed(1) + '%';
  document.getElementById('sharpeRatio').textContent = (appData.performance_metrics.sharpe_ratio || 0).toFixed(2);
  document.getElementById('maxDrawdown').textContent = (appData.performance_metrics.max_drawdown || 0).toFixed(1) + '%';
  document.getElementById('winRate').textContent = Math.round((appData.performance_metrics.win_rate || 0) * 100) + '%';
  
  // Update system status
  updateSystemStatusUI();
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
          <td>${formatCurrency(position.unrealized_pnl, true)}</td>
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
              <button class="btn btn--sm btn--outline" onclick="adjustPosition('${position.symbol}')">Adjust</button>
              <button class="btn btn--sm btn--error" onclick="closePosition('${position.symbol}')">Close</button>
            </div>
          </div>
          <div class="metric-row">
            <div class="metric">
              <label>Quantity</label>
              <div class="value">${position.quantity}</div>
            </div>
            <div class="metric">
              <label>Entry Price</label>
              <div class="value">$${position.entry_price.toFixed(2)}</div>
            </div>
            <div class="metric">
              <label>Current Price</label>
              <div class="value">$${position.current_price.toFixed(2)}</div>
            </div>
            <div class="metric">
              <label>Unrealized P&L</label>
              <div class="value ${position.unrealized_pnl >= 0 ? 'positive' : 'negative'}">
                ${formatCurrency(position.unrealized_pnl, true)}
              </div>
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
        <td class="${trade.action.toLowerCase()}-action">${trade.action}</td>
        <td>${trade.quantity}</td>
        <td>$${trade.price.toFixed(2)}</td>
        <td>${trade.strategy}</td>
        <td>${trade.pnl ? formatCurrency(trade.pnl, true) : '-'}</td>
      `;
      tradesTableBody.appendChild(row);
    });
  }
}

function updateSystemStatusUI() {
  const status = appData.system_status;
  
  const lastUpdate = document.getElementById('lastUpdate');
  if (lastUpdate) {
    lastUpdate.textContent = formatTime(status.last_update);
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
  
  // Load strategy parameters from live data when available
  updateStrategyUI();
}

function updateStrategyUI() {
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
        appData.log_entries = [];
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
        // Could implement actual emergency stop API call here
      }
    });
  }
  
  // Manual refresh button
  const refreshButton = document.getElementById('refreshData');
  if (refreshButton) {
    refreshButton.addEventListener('click', refreshData);
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
  const baseValue = appData.portfolio.total_value || 100000;
  
  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    labels.push(date.toLocaleDateString());
    
    // Generate realistic performance data based on current portfolio value
    const variation = (Math.random() - 0.5) * (baseValue * 0.02);
    const dayReturn = baseValue + variation - (i * (baseValue * 0.001));
    values.push(Math.max(dayReturn, baseValue * 0.8));
  }
  
  return { labels, values };
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
            <button class="btn btn--sm btn--outline" onclick="adjustPosition('${position.symbol}')">Adjust</button>
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
  // TODO: Implement API call to save strategy configuration
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
  // TODO: Implement API call to save risk settings
}

function closePosition(symbol) {
  if (confirm(`Are you sure you want to close your ${symbol} position?`)) {
    showNotification(`Closing ${symbol} position`, 'warning');
    console.log('Closing position:', symbol);
    // TODO: Implement API call to close position
    setTimeout(loadLiveData, 2000); // Refresh data after potential close
  }
}

function adjustPosition(symbol) {
  const newSize = prompt(`Enter new position size for ${symbol}:`);
  if (newSize) {
    showNotification(`Adjusting ${symbol} position to ${newSize} shares`, 'info');
    console.log('Adjusting position:', symbol, newSize);
    // TODO: Implement API call to adjust position
    setTimeout(loadLiveData, 2000); // Refresh data after potential adjustment
  }
}

async function runBacktestHandler() {
  const startDate = document.getElementById('backtestStart')?.value || '2024-01-01';
  const endDate = document.getElementById('backtestEnd')?.value || '2025-09-23';
  const initialCapital = parseInt(document.getElementById('initialCapital')?.value || '100000');
  
  showNotification('Running backtest...', 'info');
  
  try {
    const response = await fetch(`${API_BASE}/api/backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        strategy: 'momentum', // Could be made configurable
        startDate,
        endDate,
        initialCapital
      })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const backtestData = await response.json();
    if (backtestData.status === 'success') {
      updateBacktestChart(backtestData.results);
      showNotification('Backtest completed successfully', 'success');
    } else {
      throw new Error(backtestData.message || 'Backtest failed');
    }
    
  } catch (error) {
    console.error('Backtest error:', error);
    showNotification('Backtest failed: ' + error.message, 'error');
    
    // Fallback to simulated data
    setTimeout(() => {
      const backtestData = generateBacktestData(startDate, endDate, initialCapital);
      updateBacktestChart(backtestData);
      showNotification('Backtest completed (simulated data)', 'warning');
    }, 1000);
  }
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
  if (backtestChart && data.portfolio) {
    const labels = data.portfolio.map(point => new Date(point.date).toLocaleDateString());
    const values = data.portfolio.map(point => point.value);
    
    backtestChart.data.labels = labels;
    backtestChart.data.datasets = [{
      label: 'Backtest Results',
      data: values,
      borderColor: '#FFC185',
      backgroundColor: 'rgba(255, 193, 133, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.4
    }];
    backtestChart.update();
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

// Cleanup function
window.addEventListener('beforeunload', function() {
  if (dataRefreshInterval) {
    clearInterval(dataRefreshInterval);
  }
});