#!/usr/bin/env node
// scripts/check-rtsp.js
// Small CLI to support quick RTSP checks using the shared lib.

const path = require('path');
const lib = require(path.join(__dirname, '..', 'lib', 'rtspCheck'));

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/check-rtsp.js <rtsp-url>');
    process.exit(2);
  }

  try {
    const result = await lib.checkRtspLink(url, { timeoutMs: 5000 });
    console.log('Result:', result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error('Error:', err);
    process.exit(2);
  }
}

main();
