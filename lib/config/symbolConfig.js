// lib/config/symbolConfig.js - Configurable Symbol Triplets for Trading Strategies
export const SYMBOL_TRIPLETS = [
  {
    baseSymbol: 'SPY',
    bullSymbol: 'UPRO',
    bearSymbol: 'SPXU',
    name: 'SPY',
    description: 'S&P 500 ETF with 3x leveraged alternatives'
  },
  {
    baseSymbol: 'QQQ', 
    bullSymbol: 'TQQQ',
    bearSymbol: 'SQQQ',
    name: 'QQQ',
    description: 'NASDAQ-100 ETF with 3x leveraged alternatives'
  },
  {
    baseSymbol: 'GLD',
    bullSymbol: 'UGL', 
    bearSymbol: 'GLL',
    name: 'GLD',
    description: 'Gold ETF with 2x leveraged alternatives'
  },
  {
    baseSymbol: 'IWM',
    bullSymbol: 'TNA', 
    bearSymbol: 'TZA',
    name: 'IWM',
    description: 'Russell 2000 ETF with 3x leveraged alternatives'
    }
];

// Helper function to get symbol triplet by base symbol
export function getSymbolTriplet(baseSymbol) {
  return SYMBOL_TRIPLETS.find(triplet => triplet.baseSymbol === baseSymbol);
}

// Helper function to get all base symbols
export function getAllBaseSymbols() {
  return SYMBOL_TRIPLETS.map(triplet => triplet.baseSymbol);
}

// Helper function to get bull/bear symbols for a base symbol
export function getBullBearSymbols(baseSymbol) {
  const triplet = getSymbolTriplet(baseSymbol);
  if (!triplet) {
    throw new Error(`Symbol triplet not found for base symbol: ${baseSymbol}`);
  }
  return {
    bullSymbol: triplet.bullSymbol,
    bearSymbol: triplet.bearSymbol
  };
}

// Helper function to validate symbol triplet
export function validateSymbolTriplet(baseSymbol, bullSymbol, bearSymbol) {
  return baseSymbol && bullSymbol && bearSymbol && 
         baseSymbol !== bullSymbol && 
         baseSymbol !== bearSymbol && 
         bullSymbol !== bearSymbol;
}

// Function to add new symbol triplet (for runtime configuration)
export function addSymbolTriplet(baseSymbol, bullSymbol, bearSymbol, name, description) {
  if (!validateSymbolTriplet(baseSymbol, bullSymbol, bearSymbol)) {
    throw new Error('Invalid symbol triplet configuration');
  }
  
  // Check if base symbol already exists
  if (getSymbolTriplet(baseSymbol)) {
    throw new Error(`Symbol triplet for ${baseSymbol} already exists`);
  }
  
  SYMBOL_TRIPLETS.push({
    baseSymbol,
    bullSymbol, 
    bearSymbol,
    name: name || baseSymbol,
    description: description || `${baseSymbol} ETF with leveraged alternatives`
  });
  
  return true;
}

export default SYMBOL_TRIPLETS;