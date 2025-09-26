// Enhanced app.js - Trading Dashboard Application with Real API Integration
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
let dashboardData = null;

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

// Enhanced API Functions for fetching live data
async function fetchDashboardData() {
  try {
    const response = await fetch(`${API_BASE}/api/dashboard`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    if (result.status === 'success') {
      return result.data;
    } else {
      throw new Error(result.message || 'Failed to fetch dashboard data');
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    showNotification('Failed to fetch dashboard data: ' + error.message, 'error');
    return null;
  }
}

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
    // Get trades from dashboard data
    const dashboardResponse = await fetchDashboardData();
    if (dashboardResponse && dashboardResponse.trades) {
      return dashboardResponse.trades.map(trade => ({
        timestamp: trade.timestamp,
        symbol: trade.symbol,
        action: trade.side.toUpperCase(),
        quantity: trade.quantity,
        price: trade.price,
        strategy: trade.strategy,
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
    // Try to get logs from dashboard data
    const dashboardResponse = await fetchDashboardData();
    if (dashboardResponse && dashboardResponse.logs) {
      return dashboardResponse.logs.map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        context: log.context,
        message: log.message,
        data: log.data || {}
      }));
    }
    
    // Fallback to existing logs API
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
  showLoadingState();

  try {
    // Fetch all data in parallel
    const [
      dashboardResponse,
      portfolioResponse,
      systemResponse
    ] = await Promise.all([
      fetchDashboardData(),
      fetchPortfolioData(),
      fetchSystemStatus()
    ]);

    // Store dashboard data globally
    dashboardData = dashboardResponse;

    // Update app data structure
    if (dashboardResponse) {
      appData.portfolio = {
        cash: dashboardResponse.portfolio.cash || 0,
        total_value: dashboardResponse.portfolio.totalValue || 0,
        positions: dashboardResponse.portfolio.positions || [],
        daily_pnl: dashboardResponse.portfolio.dayChange || 0,
        total_pnl: dashboardResponse.portfolio.dayChange || 0
      };

      appData.recent_trades = dashboardResponse.trades || [];
      appData.log_entries = dashboardResponse.logs || [];
      appData.performance_metrics = dashboardResponse.performance || [];
    }

    // Update portfolio specific data
    if (portfolioResponse) {
      if (portfolioResponse.account) {
        appData.portfolio.cash = parseFloat(portfolioResponse.account.cash) || 0;
        appData.portfolio.total_value = parseFloat(portfolioResponse.account.equity) || 0;
      }

      if (portfolioResponse.positions) {
        appData.portfolio.positions = portfolioResponse.positions;
      }
    }

    // Update system status
    appData.system_status = {
      api_connected: dashboardResponse !== null,
      last_update: new Date().toISOString(),
      strategies_running: dashboardResponse?.summary?.activeTrades || 0,
      errors_24h: 0, // Could be calculated from logs
      uptime: "100%" // Placeholder
    };

    // Update UI with new data
    updateDashboard();
    updateConnectionStatus(true);
    showNotification('Data updated successfully', 'success');

  } catch (error) {
    console.error('Error loading live data:', error);
    updateConnectionStatus(false);
    showNotification('Failed to update data: ' + error.message, 'error');
  } finally {
    isLoading = false;
    hideLoadingState();
  }
}

// Update dashboard with new data
function updateDashboard() {
  updatePortfolioSummary();
  updateRecentTrades();
  updatePerformanceMetrics();
  updatePositionsTable();
  updateSystemStatus();
  updateCharts();
  updateLogEntries();
  updateLastUpdateTime();
}

function updatePortfolioSummary() {
  const portfolio = appData.portfolio;
  
  // Update summary cards
  const totalValueEl = document.querySelector('.summary-card:nth-child(1) .metric-value');
  const dailyPnLEl = document.querySelector('.summary-card:nth-child(2) .metric-value');
  const cashEl = document.querySelector('.summary-card:nth-child(3) .metric-value');
  const positionsEl = document.querySelector('.summary-card:nth-child(4) .metric-value');

  if (totalValueEl) totalValueEl.textContent = formatCurrency(portfolio.total_value);
  if (dailyPnLEl) {
    dailyPnLEl.textContent = formatCurrency(portfolio.daily_pnl);
    dailyPnLEl.className = `metric-value ${portfolio.daily_pnl >= 0 ? 'positive' : 'negative'}`;
  }
  if (cashEl) cashEl.textContent = formatCurrency(portfolio.cash);
  if (positionsEl) positionsEl.textContent = portfolio.positions.length;
}

function updateRecentTrades() {
  const tradesContainer = document.getElementById('recent-trades-table');
  if (!tradesContainer) return;

  const tbody = tradesContainer.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Show latest 10 trades
  const recentTrades = appData.recent_trades.slice(0, 10);
  
  recentTrades.forEach(trade => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatTime(trade.timestamp)}</td>
      <td><strong>${trade.symbol || trade.symbol}</strong></td>
      <td><span class="badge badge-${trade.side === 'BUY' ? 'buy' : 'sell'}">${trade.side || trade.action}</span></td>
      <td>${trade.quantity || 0}</td>
      <td>${formatCurrency(trade.price || 0)}</td>
      <td>${trade.strategy || '--'}</td>
      <td class="${trade.pnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(trade.pnl || 0)}</td>
    `;
    tbody.appendChild(row);
  });
}

function updatePerformanceMetrics() {
  const metrics = appData.performance_metrics;
  const summary = appData.system_status;

  // Update performance cards if they exist
  const performanceSection = document.querySelector('.performance-metrics');
  if (performanceSection && dashboardData) {
    const winRateEl = performanceSection.querySelector('.win-rate');
    const totalReturnEl = performanceSection.querySelector('.total-return');
    const sharpeRatioEl = performanceSection.querySelector('.sharpe-ratio');
    const maxDrawdownEl = performanceSection.querySelector('.max-drawdown');

    if (winRateEl) winRateEl.textContent = `${dashboardData.summary?.winRate || 0}%`;
    if (totalReturnEl) totalReturnEl.textContent = `${((appData.portfolio.total_value / 100000 - 1) * 100).toFixed(2)}%`;
    if (sharpeRatioEl) sharpeRatioEl.textContent = '1.42'; // Placeholder
    if (maxDrawdownEl) maxDrawdownEl.textContent = '-3.2%'; // Placeholder
  }
}

function updatePositionsTable() {
  const positionsTable = document.getElementById('positions-table');
  if (!positionsTable) return;

  const tbody = positionsTable.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  appData.portfolio.positions.forEach(position => {
    const row = document.createElement('tr');
    const marketValue = position.marketValue || (position.quantity * position.avgPrice);
    const unrealizedPL = position.unrealizedPL || 0;
    
    row.innerHTML = `
      <td><strong>${position.symbol}</strong></td>
      <td>${position.quantity}</td>
      <td>${formatCurrency(position.avgPrice || position.entryPrice || 0)}</td>
      <td>${formatCurrency(position.currentPrice || position.markPrice || 0)}</td>
      <td class="${unrealizedPL >= 0 ? 'positive' : 'negative'}">${formatCurrency(unrealizedPL)}</td>
      <td>${formatCurrency(marketValue)}</td>
    `;
    tbody.appendChild(row);
  });
}

function updateSystemStatus() {
  const status = appData.system_status;
  
  const statusEl = document.querySelector('.system-status');
  if (statusEl) {
    statusEl.className = `system-status ${status.api_connected ? 'connected' : 'disconnected'}`;
    statusEl.textContent = status.api_connected ? 'Connected' : 'Disconnected';
  }
}

function updateCharts() {
  updatePerformanceChart();
  updateBacktestChart();
}

function updatePerformanceChart() {
  if (!performanceChart || !appData.performance_metrics) return;

  const performanceData = Array.isArray(appData.performance_metrics) ? appData.performance_metrics : [];
  const labels = performanceData.map(p => formatDate(p.timestamp));
  const data = performanceData.map(p => p.totalEquity || p.total_value || 0);

  performanceChart.data.labels = labels;
  performanceChart.data.datasets[0].data = data;
  performanceChart.update();
}

function updateBacktestChart() {
  if (!backtestChart) return;
  
  // Update backtest chart with available data
  const performanceData = Array.isArray(appData.performance_metrics) ? appData.performance_metrics : [];
  if (performanceData.length > 0) {
    const labels = performanceData.map(p => formatDate(p.timestamp));
    const returns = performanceData.map(p => p.dailyReturn || 0);

    backtestChart.data.labels = labels;
    backtestChart.data.datasets[0].data = returns;
    backtestChart.update();
  }
}

function updateLogEntries() {
  const logContainer = document.querySelector('#log-entries');
  if (!logContainer) return;

  // Clear existing logs
  logContainer.innerHTML = '';

  // Filter logs based on current level
  let filteredLogs = appData.log_entries;
  if (currentLogLevel !== 'all') {
    filteredLogs = appData.log_entries.filter(log => 
      log.level.toLowerCase() === currentLogLevel.toLowerCase()
    );
  }

  // Show latest 50 logs
  const recentLogs = filteredLogs.slice(0, 50);

  recentLogs.forEach(log => {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${log.level.toLowerCase()}`;
    logEntry.innerHTML = `
      <div class="log-time">${formatTime(log.timestamp)}</div>
      <div class="log-level">${log.level}</div>
      <div class="log-message">${log.message}</div>
      <div class="log-context">${log.context || log.strategy || 'System'}</div>
    `;
    logContainer.appendChild(logEntry);
  });

  // Auto-scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateConnectionStatus(connected) {
  appData.system_status.api_connected = connected;
  
  const statusIndicator = document.querySelector('.connection-status');
  if (statusIndicator) {
    statusIndicator.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
    statusIndicator.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

function updateLastUpdateTime() {
  const lastUpdateEl = document.getElementById('last-update');
  if (lastUpdateEl) {
    lastUpdateEl.textContent = new Date().toLocaleTimeString();
  }
}

// PRESERVED EXISTING FUNCTIONALITY - All existing functions remain

function initializeNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active class from all items
      navItems.forEach(navItem => navItem.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Add active class to clicked item
      item.classList.add('active');
      const targetTab = item.dataset.tab;
      document.getElementById(targetTab).classList.add('active');
    });
  });
}

function initializeStrategies() {
  // Initialize strategy controls with default values
  const strategies = [
    { name: 'momentum', enabled: true },
    { name: 'meanReversion', enabled: true },
    { name: 'regimeDetection', enabled: false }
  ];

  appData.strategies = strategies;
  updateStrategyToggles();
}

function initializeETFGrid() {
  const etfGrid = document.querySelector('.etf-grid');
  if (!etfGrid) return;

  appData.etf_symbols.forEach(symbol => {
    const etfCard = document.createElement('div');
    etfCard.className = 'etf-card';
    etfCard.innerHTML = `
      <div class="etf-symbol">${symbol}</div>
      <div class="etf-price">$0.00</div>
      <div class="etf-change">0.00%</div>
    `;
    etfGrid.appendChild(etfCard);
  });
}

function initializeLogs() {
  const logLevelSelector = document.getElementById('log-level-selector');
  if (logLevelSelector) {
    logLevelSelector.addEventListener('change', (e) => {
      currentLogLevel = e.target.value;
      updateLogEntries();
    });
  }
}

function initializeCharts() {
  initializePerformanceChart();
  initializeBacktestChart();
}

function initializePerformanceChart() {
  const ctx = document.getElementById('performance-chart');
  if (!ctx) return;

  performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Portfolio Value',
        data: [],
        borderColor: '#1fb8cd',
        backgroundColor: 'rgba(31, 184, 205, 0.1)',
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return formatCurrency(value);
            }
          }
        }
      }
    }
  });
}

function initializeBacktestChart() {
  const ctx = document.getElementById('backtest-chart');
  if (!ctx) return;

  backtestChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Daily Returns',
        data: [],
        backgroundColor: function(context) {
          const value = context.parsed.y;
          return value >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      }
    }
  });
}

function initializeEventListeners() {
  // Manual refresh button
  const refreshBtn = document.getElementById('manual-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadLiveData);
  }

  // Auto-refresh toggle
  const autoRefreshToggle = document.getElementById('auto-refresh');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        dataRefreshInterval = setInterval(loadLiveData, REFRESH_INTERVAL);
      } else {
        clearInterval(dataRefreshInterval);
      }
    });
  }

  // Strategy toggles
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('strategy-toggle')) {
      const strategyName = e.target.dataset.strategy;
      const isEnabled = e.target.checked;
      updateStrategyStatus(strategyName, isEnabled);
    }
  });

  // Manual trading form
  const manualTradeForm = document.getElementById('manual-trade-form');
  if (manualTradeForm) {
    manualTradeForm.addEventListener('submit', handleManualTrade);
  }

  // Quick action buttons
  const quickActionBtns = document.querySelectorAll('.quick-action-btn');
  quickActionBtns.forEach(btn => {
    btn.addEventListener('click', handleQuickAction);
  });
}

// Event handlers
function handleManualTrade(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const tradeData = {
    symbol: formData.get('symbol'),
    quantity: parseInt(formData.get('quantity')),
    side: formData.get('side'),
    orderType: formData.get('orderType'),
    limitPrice: formData.get('limitPrice')
  };

  executeManualTrade(tradeData);
}

function handleQuickAction(e) {
  const action = e.target.dataset.action;
  switch(action) {
    case 'stop-all':
      stopAllPositions();
      break;
    case 'pause-trading':
      pauseTrading();
      break;
    case 'resume-trading':
      resumeTrading();
      break;
    case 'emergency-exit':
      emergencyExit();
      break;
  }
}

async function executeManualTrade(tradeData) {
  try {
    const response = await fetch(`${API_BASE}/api/manual-trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tradeData)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    showNotification('Manual trade executed successfully', 'success');
    loadLiveData(); // Refresh data
  } catch (error) {
    showNotification('Failed to execute manual trade: ' + error.message, 'error');
  }
}

// Utility functions
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

function showLoadingState() {
  const loadingElements = document.querySelectorAll('.loading-indicator');
  loadingElements.forEach(el => el.style.display = 'block');
}

function hideLoadingState() {
  const loadingElements = document.querySelectorAll('.loading-indicator');
  loadingElements.forEach(el => el.style.display = 'none');
}

function updateStrategyToggles() {
  appData.strategies.forEach(strategy => {
    const toggle = document.querySelector(`[data-strategy="${strategy.name}"]`);
    if (toggle) {
      toggle.checked = strategy.enabled;
    }
  });
}

function updateStrategyStatus(strategyName, isEnabled) {
  const strategy = appData.strategies.find(s => s.name === strategyName);
  if (strategy) {
    strategy.enabled = isEnabled;
  }
}

// Quick action functions (placeholders)
function stopAllPositions() {
  showNotification('Stop all positions requested', 'warning');
}

function pauseTrading() {
  showNotification('Trading paused', 'info');
}

function resumeTrading() {
  showNotification('Trading resumed', 'success');
}

function emergencyExit() {
  if (confirm('Are you sure you want to execute emergency exit?')) {
    showNotification('Emergency exit executed', 'error');
  }
}

// Enhanced API functions for filtered data
async function fetchFilteredData(filters) {
  try {
    const response = await fetch(`${API_BASE}/api/dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filters)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    
    if (result.status === 'success') {
      return result.data;
    } else {
      throw new Error(result.message || 'Failed to fetch filtered data');
    }
  } catch (error) {
    console.error('Error fetching filtered data:', error);
    showNotification('Failed to fetch filtered data: ' + error.message, 'error');
    return null;
  }
}

// Export data functionality
function exportData(dataType) {
  let data;
  let filename;

  switch (dataType) {
    case 'trades':
      data = appData.recent_trades;
      filename = 'trades.json';
      break;
    case 'portfolio':
      data = appData.portfolio;
      filename = 'portfolio.json';
      break;
    case 'logs':
      data = appData.log_entries;
      filename = 'logs.json';
      break;
    default:
      data = appData;
      filename = 'dashboard-data.json';
  }

  const dataStr = JSON.stringify(data, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `${filename.split('.')[0]}-${new Date().toISOString().split('T')[0]}.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

// Cleanup function
function cleanup() {
  if (dataRefreshInterval) {
    clearInterval(dataRefreshInterval);
  }
}

// Handle page unload
window.addEventListener('beforeunload', cleanup);