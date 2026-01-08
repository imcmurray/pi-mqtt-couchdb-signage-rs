#!/usr/bin/env node
/**
 * Manual test script for multiple simultaneous alerts.
 * Run when Docker containers are up.
 *
 * Usage: node tests/manual/test-multiple-alerts.js
 */

const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function createAlert(type, message) {
  const alertData = {
    type,
    title: `Test ${type} Alert`,
    message,
    target_type: 'all',
    auto_dismiss_ms: 60000
  };

  const result = await makeRequest('POST', '/api/alerts', alertData);
  console.log(`Created ${type} alert: ${result.data.alert?.alert_id || 'failed'}`);
  return result;
}

async function getActiveAlerts() {
  const result = await makeRequest('GET', '/api/alerts/active');
  return result.data;
}

async function dismissAlert(alertId) {
  const result = await makeRequest('POST', `/api/alerts/${alertId}/dismiss`, { reason: 'test-cleanup' });
  console.log(`Dismissed alert ${alertId}: ${result.status === 200 ? 'success' : 'failed'}`);
  return result;
}

async function runTest() {
  console.log('\n=== Multiple Alerts Test ===\n');

  console.log('Step 1: Check initial state');
  const initialAlerts = await getActiveAlerts();
  console.log(`Active alerts before test: ${initialAlerts.length || 0}\n`);

  console.log('Step 2: Create 3 simultaneous alerts');
  const alertResults = await Promise.all([
    createAlert('CRITICAL', 'First critical alert - should be at top'),
    createAlert('URGENT', 'Urgent alert - should stack below critical'),
    createAlert('INFO', 'Info alert - should stack at bottom')
  ]);

  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\nStep 3: Verify all alerts are active');
  const activeAlerts = await getActiveAlerts();
  console.log(`Active alerts: ${activeAlerts.length}`);

  if (activeAlerts.length >= 3) {
    console.log('\nActive alert IDs:');
    activeAlerts.forEach(alert => {
      console.log(`  - ${alert.alert_id} (${alert.type})`);
    });
    console.log('\n✅ SUCCESS: Multiple alerts are tracked correctly!');
  } else {
    console.log('\n❌ FAILED: Expected 3+ active alerts');
  }

  console.log('\nStep 4: Check MQTT topic payload');
  console.log('(Check MQTT Explorer for signage/tv/+/alerts topic)');
  console.log('Expected: Array with all active alerts\n');

  console.log('Step 5: Dismiss one alert and verify restacking');
  if (alertResults[1].data.alert) {
    await dismissAlert(alertResults[1].data.alert.alert_id);
    await new Promise(resolve => setTimeout(resolve, 500));

    const afterDismiss = await getActiveAlerts();
    console.log(`Active alerts after dismiss: ${afterDismiss.length}`);

    if (afterDismiss.length === activeAlerts.length - 1) {
      console.log('✅ Alert correctly removed from active list');
    }
  }

  console.log('\nStep 6: Cleanup - dismiss remaining test alerts');
  const finalAlerts = await getActiveAlerts();
  for (const alert of finalAlerts) {
    if (alert.title?.includes('Test')) {
      await dismissAlert(alert.alert_id);
    }
  }

  console.log('\n=== Test Complete ===\n');
}

runTest().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
