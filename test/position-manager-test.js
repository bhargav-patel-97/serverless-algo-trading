/**
 * Test file for TradingPositionManager
 * Run with: node test/position-manager-test.js
 */

const TradingPositionManager = require('../lib/TradingPositionManager');

// Mock Alpaca client that simulates your actual trading environment
class MockAlpacaClient {
  constructor() {
    this.positions = [
      {
        symbol: 'SQQQ',
        qty: '95',
        side: 'buy',
        market_value: '1486.80',
        cost_basis: '1486.80',
        unrealized_pl: '0.00',
        avg_entry_price: '15.65'
      }
    ];
    
    this.orders = [];
    this.orderIdCounter = 1000;
  }

  async getPositions() {
    console.log('Mock: Getting positions...', this.positions.length, 'positions');
    return [...this.positions];
  }

  async getOrders(options = {}) {
    console.log('Mock: Getting orders with options:', options);
    let filteredOrders = [...this.orders];
    
    if (options.symbols && options.symbols.length > 0) {
      filteredOrders = filteredOrders.filter(order => 
        options.symbols.includes(order.symbol)
      );
    }
    
    if (options.status === 'open') {
      filteredOrders = filteredOrders.filter(order => 
        ['pending_new', 'accepted', 'partially_filled', 'new'].includes(order.status)
      );
    }
    
    return filteredOrders;
  }

  async getAccount() {
    return {
      equity: '100034.60',
      buying_power: '191069.20',
      status: 'ACTIVE'
    };
  }

  async getClock() {
    return {
      is_open: true,
      next_open: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      next_close: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    };
  }

  async createOrder(orderRequest) {
    const orderId = `test-order-${this.orderIdCounter++}`;
    const order = {
      id: orderId,
      symbol: orderRequest.symbol,
      qty: orderRequest.qty,
      side: orderRequest.side,
      type: orderRequest.type,
      time_in_force: orderRequest.time_in_force,
      status: 'pending_new',
      submitted_at: new Date().toISOString()
    };
    
    this.orders.push(order);
    console.log('Mock: Order created successfully:', orderId);
    return order;
  }

  // Simulate adding a position after order execution
  addPosition(symbol, qty, side, price) {
    this.positions.push({
      symbol: symbol,
      qty: qty.toString(),
      side: side,
      market_value: (Math.abs(qty) * price).toString(),
      cost_basis: (Math.abs(qty) * price).toString(),
      unrealized_pl: '0.00',
      avg_entry_price: price.toString()
    });
  }

  // Simulate pending order
  addPendingOrder(symbol, qty, side) {
    this.orders.push({
      id: `pending-${this.orderIdCounter++}`,
      symbol: symbol,
      qty: qty,
      side: side,
      type: 'market',
      status: 'pending_new',
      submitted_at: new Date().toISOString()
    });
  }
}

// Test scenarios
async function runTests() {
  console.log('=== TRADING POSITION MANAGER TESTS ===\n');
  
  const mockAlpaca = new MockAlpacaClient();
  const positionManager = new TradingPositionManager(mockAlpaca, {
    enableLogging: true,
    minTimeBetweenTrades: 5000, // 5 seconds for testing
    maxPositionSizePercent: 0.10
  });

  // Test 1: Duplicate position prevention
  console.log('TEST 1: Duplicate Position Prevention');
  console.log('Attempting to buy SQQQ when we already have a buy position...\n');
  
  const test1Result = await positionManager.executeTradeWithValidation(
    'SQQQ', 'buy', 95, 15.64, 'Test Strategy'
  );
  
  console.log('Result:', {
    success: test1Result.success,
    skipped: test1Result.skipped,
    reasons: test1Result.reasons
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Allow trade for new symbol
  console.log('TEST 2: Allow Trade for New Symbol');
  console.log('Attempting to buy TQQQ (no existing position)...\n');
  
  const test2Result = await positionManager.executeTradeWithValidation(
    'TQQQ', 'buy', 95, 100.75, 'Test Strategy'
  );
  
  console.log('Result:', {
    success: test2Result.success,
    skipped: test2Result.skipped,
    orderId: test2Result.order?.id
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Time-based cooldown
  console.log('TEST 3: Time-based Cooldown Prevention');
  console.log('Attempting to trade TQQQ again immediately (should be blocked)...\n');
  
  const test3Result = await positionManager.executeTradeWithValidation(
    'TQQQ', 'buy', 50, 101.00, 'Test Strategy'
  );
  
  console.log('Result:', {
    success: test3Result.success,
    skipped: test3Result.skipped,
    reasons: test3Result.reasons
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: Pending order detection
  console.log('TEST 4: Pending Order Detection');
  console.log('Adding pending order for SPY, then trying to trade SPY...\n');
  
  mockAlpaca.addPendingOrder('SPY', 100, 'buy');
  
  const test4Result = await positionManager.executeTradeWithValidation(
    'SPY', 'buy', 100, 590.50, 'Test Strategy'
  );
  
  console.log('Result:', {
    success: test4Result.success,
    skipped: test4Result.skipped,
    reasons: test4Result.reasons
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 5: Risk limit check
  console.log('TEST 5: Risk Limit Check');
  console.log('Attempting large position that exceeds risk limits...\n');
  
  const test5Result = await positionManager.executeTradeWithValidation(
    'AAPL', 'buy', 1000, 200.00, 'Test Strategy' // $200,000 position > 10% of $100k equity
  );
  
  console.log('Result:', {
    success: test5Result.success,
    skipped: test5Result.skipped,
    reasons: test5Result.reasons
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 6: Position summary
  console.log('TEST 6: Position Summary');
  const summary = await positionManager.getPositionSummary();
  console.log('Position Summary:', JSON.stringify(summary, null, 2));
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 7: Cooldown status
  console.log('TEST 7: Cooldown Status');
  const cooldownStatus = positionManager.getCooldownStatus();
  console.log('Cooldown Status:', JSON.stringify(cooldownStatus, null, 2));
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 8: Wait for cooldown and retry
  console.log('TEST 8: Cooldown Reset and Retry');
  console.log('Resetting cooldown for TQQQ and trying again...\n');
  
  positionManager.resetCooldown('TQQQ');
  
  const test8Result = await positionManager.executeTradeWithValidation(
    'TQQQ', 'buy', 25, 101.25, 'Test Strategy'
  );
  
  console.log('Result:', {
    success: test8Result.success,
    skipped: test8Result.skipped,
    orderId: test8Result.order?.id,
    reasons: test8Result.reasons
  });
  console.log('\n' + '='.repeat(50) + '\n');

  // Test 9: Leveraged ETF special handling
  console.log('TEST 9: Leveraged ETF Special Handling');
  console.log('Testing leveraged ETF detection and enhanced risk management...\n');
  
  const isLeveraged = positionManager.isLeveragedETF('SQQQ');
  console.log('Is SQQQ a leveraged ETF?', isLeveraged);
  
  const test9Result = await positionManager.executeTradeWithValidation(
    'SPXU', 'buy', 1000, 15.00, 'Test Strategy' // Large leveraged ETF position
  );
  
  console.log('Result:', {
    success: test9Result.success,
    skipped: test9Result.skipped,
    reasons: test9Result.reasons
  });
  
  console.log('\n=== TESTS COMPLETED ===');
  
  // Summary
  const finalSummary = await positionManager.getPositionSummary();
  console.log('\nFinal Position Summary:');
  console.log('- Total Positions:', finalSummary.totalPositions);
  console.log('- Total Value:', `$${finalSummary.totalValue.toFixed(2)}`);
  console.log('- Symbols:', Object.keys(finalSummary.positions));
}

// Run the tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});

module.exports = { MockAlpacaClient };