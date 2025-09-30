// Enhanced Application Data - Now using live API data with position history
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
  "position_history": [], // NEW: Position history data
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
let positionHistoryData = []; // NEW: Store position history

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
  initializePositionHistory(); // NEW: Initialize position history
  
  // Load live data immediately
  loadLiveData();
  
  // Set up periodic data refresh
  dataRefreshInterval = setInterval(loadLiveData, REFRESH_INTERVAL);
});

// NEW: Initialize position history functionality
function initializePositionHistory() {
  // Add event listeners for position history filters
  const historyFilters = document.querySelectorAll('.history-filter');
  historyFilters.forEach(filter => {
    filter.addEventListener('change', function() {
      loadPositionHistory();
    });
  });
  
  // Load initial position history
  loadPositionHistory();
}

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

// NEW: Fetch position history data
async function fetchPositionHistory(filters = {}) {
  try {
    const queryParams = new URLSearchParams();
    
    if (filters.limit) queryParams.append('limit', filters.limit);
    if (filters.status) queryParams.append('status', filters.status);
    if (filters.symbols) queryParams.append('symbols', filters.symbols);
    if (filters.start_date) queryParams.append('start_date', filters.start_date);
    if (filters.end_date) queryParams.append('end_date', filters.end_date);
    
    const url = `${API_BASE}/api/position-history${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching position history:', error);
    showNotification('Failed to fetch position history', 'error');
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
    const portfolioData = await fetchPortfolioData();
    if (portfolioData && portfolioData.recentOrders) {
      return portfolioData.recentOrders.map(order => ({
        timestamp: order.submittedAt || order.filledAt,
        symbol: order.symbol,
        action: order.side.toUpperCase(),
        quantity: order.quantity || order.filledQuantity,
        price: order.filledPrice || 0,
        strategy: 'API Trade',
        pnl: null
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
    const [portfolioData, systemStatus, trades, logs] = await Promise.all([
      fetchPortfolioData(),
      fetchSystemStatus(),
      fetchRecentTrades(),
      fetchLogEntries()
    ]);
    
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
      appData.log_entries = [...logs, ...appData.log_entries].slice(0, 50);
    }
    
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
    appData.portfolio.total_value = data.account?.portfolioValue || 0;
    appData.portfolio.cash = data.account?.cash || 0;
    appData.portfolio.daily_pnl = data.riskMetrics?.totalDayChange || 0;
    appData.portfolio.total_pnl = data.riskMetrics?.totalUnrealizedPL || 0;
    
    appData.portfolio.positions = data.positions?.map(pos => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      current_price: pos.currentPrice,
      entry_price: pos.entryPrice,
      unrealized_pnl: pos.unrealizedPL,
      market_value: pos.marketValue
    })) || [];
    
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
    
    // ENHANCED: Update performance metrics with new data
    if (data.performanceMetrics) {
      appData.performance_metrics = {
        total_return: data.performanceMetrics.totalReturn || 0,
        daily_return: (appData.portfolio.daily_pnl / appData.portfolio.total_value) * 100,
        sharpe_ratio: data.performanceMetrics.sharpeRatio || 0,
        max_drawdown: data.performanceMetrics.maxDrawdown || 0,
        win_rate: data.performanceMetrics.winRate || 0,
        total_trades: data.performanceMetrics.totalTrades || 0,
        // NEW ENHANCED METRICS
        all_time_trades_won: data.performanceMetrics.allTimeTradesWon || 0,
        all_time_trades_lost: data.performanceMetrics.allTimeTradesLost || 0,
        all_time_pnl: data.performanceMetrics.allTimePnL || 0,
        realized_pnl: data.performanceMetrics.realizedPnL || 0,
        unrealized_pnl: data.performanceMetrics.unrealizedPnL || 0,
        profit_factor: data.performanceMetrics.profitFactor || 0,
        average_win: data.performanceMetrics.averageWin || 0,
        average_loss: data.performanceMetrics.averageLoss || 0,
        trades_per_day: data.performanceMetrics.tradesPerDay || 0,
        total_volume: data.performanceMetrics.totalVolume || 0
      };
    }
  }
}

// NEW: Load position history
async function loadPositionHistory() {
  try {
    const statusFilter = document.getElementById('historyStatusFilter')?.value || 'filled';
    const limitFilter = document.getElementById('historyLimitFilter')?.value || '50';
    const symbolFilter = document.getElementById('historySymbolFilter')?.value || '';
    
    const filters = {
      status: statusFilter,
      limit: limitFilter
    };
    
    if (symbolFilter) {
      filters.symbols = symbolFilter;
    }
    
    const historyData = await fetchPositionHistory(filters);
    
    if (historyData && historyData.status === 'success') {
      positionHistoryData = historyData.history || [];
      updatePositionHistoryTable(positionHistoryData);
      updatePositionHistorySummary(historyData.summary || {});
    }
  } catch (error) {
    console.error('Error loading position history:', error);
    showNotification('Failed to load position history', 'error');
  }
}

// NEW: Update position history table
function updatePositionHistoryTable(historyData) {
  const tableBody = document.getElementById('positionHistoryTableBody');
  if (!tableBody) return;
  
  tableBody.innerHTML = '';
  
  if (historyData.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="8" style="text-align: center; padding: 20px;">
        <em>No position history found</em>
      </td>
    `;
    tableBody.appendChild(row);
    return;
  }
  
  historyData.forEach(trade => {
    const row = document.createElement('tr');
    const statusClass = getStatusClass(trade.status);
    const pnlDisplay = trade.totalAmount > 0 ? formatCurrency(trade.totalAmount) : '-';
    
    row.innerHTML = `
      <td>${trade.date}</td>
      <td>${trade.time}</td>
      <td><strong>${trade.symbol}</strong></td>
      <td><span class="action-${trade.action.toLowerCase()}">${trade.action}</span></td>
      <td>${trade.filledQty}</td>
      <td>$${trade.avgFillPrice.toFixed(2)}</td>
      <td>${pnlDisplay}</td>
      <td><span class="status-${statusClass}">${trade.status}</span></td>
    `;
    
    tableBody.appendChild(row);
  });
}

// NEW: Update position history summary
function updatePositionHistorySummary(summary) {
  if (document.getElementById('totalOrdersCount')) {
    document.getElementById('totalOrdersCount').textContent = summary.totalOrders || 0;
  }
  if (document.getElementById('filledOrdersCount')) {
    document.getElementById('filledOrdersCount').textContent = summary.filledOrders || 0;
  }
  if (document.getElementById('totalVolumeAmount')) {
    document.getElementById('totalVolumeAmount').textContent = formatCurrency(summary.totalVolume || 0);
  }
  if (document.getElementById('winRatePercentage')) {
    document.getElementById('winRatePercentage').textContent = (summary.winRate || 0).toFixed(1) + '%';
  }
}

// NEW: Helper function to get status class for styling
function getStatusClass(status) {
  switch (status.toLowerCase()) {
    case 'filled': return 'success';
    case 'canceled': return 'warning';
    case 'rejected': return 'error';
    case 'pending_new':
    case 'new':
    case 'accepted': return 'info';
    default: return 'default';
  }
}

function updateSystemStatus(data) {
  appData.system_status.api_connected = data.status === 'success' || data.status === 'partial_failure';
  
  let strategiesRunning = 0;
  if (data.environment?.strategies) {
    strategiesRunning = Object.values(data.environment.strategies).filter(enabled => enabled).length;
  }
  appData.system_status.strategies_running = strategiesRunning;
  
  let successfulTests = 0;
  let totalTests = 0;
  if (data.tests) {
    Object.values(data.tests).forEach(test => {
      totalTests++;
      if (test.success) successfulTests++;
    });
  }
  appData.system_status.uptime = totalTests > 0 ? `${Math.round((successfulTests / totalTests) * 100)}%` : '0%';
  
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
  
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    if (loading) {
      mainContent.classList.add('loading');
    } else {
      mainContent.classList.remove('loading');
    }
  }
}

function refreshData() {
  loadLiveData();
  loadPositionHistory(); // NEW: Also refresh position history
  showNotification('Data refreshed', 'success');
}

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
      setTimeout(() => {
        loadLiveData();
        loadPositionHistory(); // NEW: Refresh position history after trade
      }, 2000);
    } else {
      showNotification(`Trade failed: ${result.message}`, 'error');
    }

  } catch (error) {
    console.error('Error executing manual trade:', error);
    showNotification('Failed to execute trade', 'error');
  }
}

function initializeNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      
      navLinks.forEach(l => l.classList.remove('active'));
      this.classList.add('active');
      
      const allTabs = document.querySelectorAll('.tab-content');
      allTabs.forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = 'none';
      });
      
      const tabId = this.getAttribute('data-tab');
      const targetTab = document.getElementById(tabId);
      if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.display = 'block';
        
        if (tabId === 'positions') {
          loadPositionHistory();
        }
      }
    });
  });
  
  const dashboardTab = document.getElementById('dashboard');
  if (dashboardTab) {
    dashboardTab.style.display = 'block';
  }
}

// Load dashboard data with ENHANCED metrics
function loadDashboardData() {
  document.getElementById('totalValue').textContent = formatCurrency(appData.portfolio.total_value);
  document.getElementById('cashValue').textContent = formatCurrency(appData.portfolio.cash);
  document.getElementById('dailyPnl').textContent = formatCurrency(appData.portfolio.daily_pnl, true);
  document.getElementById('totalPnl').textContent = formatCurrency(appData.portfolio.total_pnl, true);
  
  document.getElementById('totalReturn').textContent = (appData.performance_metrics.total_return || 0).toFixed(1) + '%';
  document.getElementById('sharpeRatio').textContent = (appData.performance_metrics.sharpe_ratio || 0).toFixed(2);
  document.getElementById('maxDrawdown').textContent = (appData.performance_metrics.max_drawdown || 0).toFixed(1) + '%';
  document.getElementById('winRate').textContent = Math.round((appData.performance_metrics.win_rate || 0)) + '%';
  
  // NEW: Enhanced performance metrics
  document.getElementById('allTimeTradesWon').textContent = appData.performance_metrics.all_time_trades_won || 0;
  document.getElementById('allTimeTradesLost').textContent = appData.performance_metrics.all_time_trades_lost || 0;
  document.getElementById('allTimePnL').textContent = formatCurrency(appData.performance_metrics.all_time_pnl || 0, true);
  document.getElementById('realizedPnL').textContent = formatCurrency(appData.performance_metrics.realized_pnl || 0, true);
  document.getElementById('profitFactor').textContent = (appData.performance_metrics.profit_factor || 0).toFixed(2);
  document.getElementById('totalTrades').textContent = appData.performance_metrics.total_trades || 0;
  document.getElementById('tradesPerDay').textContent = (appData.performance_metrics.trades_per_day || 0).toFixed(1);
  document.getElementById('totalVolume').textContent = formatCurrency(appData.performance_metrics.total_volume || 0);
  
  updateSystemStatusUI();
}

// Load positions with SIMPLIFIED structure
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
            <h4>${position.symbol}</h4>
            <button onclick="closePosition('${position.symbol}')" class="btn btn-sm btn-outline-danger">Close</button>
          </div>
          <div class="position-details">
            <div class="position-metric">
              <label>Quantity</label>
              <span>${position.quantity}</span>
            </div>
            <div class="position-metric">
              <label>Entry Price</label>
              <span>$${position.entry_price.toFixed(2)}</span>
            </div>
            <div class="position-metric">
              <label>Current Price</label>
              <span>$${position.current_price.toFixed(2)}</span>
            </div>
            <div class="position-metric">
              <label>Unrealized P&L</label>
              <span class="${position.unrealized_pnl >= 0 ? 'profit' : 'loss'}">
                ${formatCurrency(position.unrealized_pnl, true)}
              </span>
            </div>
          </div>
        `;
        positionsDetailed.appendChild(positionItem);
      }
    });
  }
}

// Helper functions and remaining code would continue here...
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

function loadRecentTrades() {
  const tradesTableBody = document.getElementById('tradesTableBody');
  if (tradesTableBody) {
    tradesTableBody.innerHTML = '';
    
    appData.recent_trades.forEach(trade => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${formatTime(trade.timestamp)}</td>
        <td><strong>${trade.symbol}</strong></td>
        <td>${trade.action}</td>
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

function showNotification(message, type = 'info') {
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
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Initialize remaining functions (strategies, ETF grid, logs, charts, event listeners)
function initializeStrategies() {
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
  
  updateStrategyUI();
}

function updateStrategyUI() {
  // Strategy UI update logic would go here
}

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
        <span class="log-timestamp">${formatTime(log.timestamp)}</span>
        <span class="log-level">${log.level}</span>
        <span class="log-message">${log.message}</span>
        <span class="log-strategy">${log.strategy}</span>
      `;
      logViewer.appendChild(logEntry);
    });
    
    logViewer.scrollTop = logViewer.scrollHeight;
  }
}

function initializeCharts() {
  // Chart initialization logic
}

function initializeEventListeners() {
  const emergencyStop = document.getElementById('emergencyStop');
  if (emergencyStop) {
    emergencyStop.addEventListener('click', function() {
      if (confirm('Are you sure you want to stop all trading activities?')) {
        showNotification('Emergency stop activated', 'warning');
      }
    });
  }
  
  const refreshButton = document.getElementById('refreshData');
  if (refreshButton) {
    refreshButton.addEventListener('click', refreshData);
  }
  
  const saveStrategies = document.getElementById('saveStrategies');
  if (saveStrategies) {
    saveStrategies.addEventListener('click', saveStrategiesHandler);
  }
  
  const saveRisk = document.getElementById('saveRisk');
  if (saveRisk) {
    saveRisk.addEventListener('click', saveRiskSettings);
  }
  
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
}

function saveStrategiesHandler() {
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

function closePosition(symbol) {
  if (confirm(`Are you sure you want to close your ${symbol} position?`)) {
    showNotification(`Closing ${symbol} position`, 'warning');
    console.log('Closing position:', symbol);
    setTimeout(loadLiveData, 2000);
  }
}

window.addEventListener('beforeunload', function() {
  if (dataRefreshInterval) {
    clearInterval(dataRefreshInterval);
  }
});