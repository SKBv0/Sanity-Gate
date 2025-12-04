#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * CLI wrapper entry point
 * Uses CommonJS require() because:
 * 1. Node.js binary files typically use CommonJS
 * 2. tsx package provides CommonJS API (tsx/cjs/api)
 * 3. This is a thin wrapper - actual CLI logic is in src/cli.ts (ES modules)
 */
try {
  const { register } = require('tsx/cjs/api');
  
  register({
    tsconfig: require.resolve('../tsconfig.json')
  });
  
  require('../src/cli.ts');
} catch (error) {
  console.error('Error loading CLI:', error.message);
  console.error('Make sure tsx is installed: npm install -g tsx');
  process.exit(1);
}
