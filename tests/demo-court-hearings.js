/**
 * Demo Court Hearing System
 * Creates sample court hearings for testing the layer generation system
 *
 * Usage:
 *   node tests/demo-court-hearings.js
 *
 * Prerequisites:
 *   - CouchDB running and accessible
 *   - Multi-layer server running (node src/server.multilayer.js)
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000/api/hearings';

// Sample hearing data
const sampleHearings = [
  {
    case_number: 'CV-2025-00123',
    court_room: '101',
    scheduled_time: getTimeToday(9, 0),
    hearing_type: 'trial',
    parties: {
      plaintiff: 'Smith Construction Co.',
      defendant: 'Johnson Development LLC'
    },
    judge: 'Hon. Robert Martinez',
    notes: 'Contract dispute case'
  },
  {
    case_number: 'CR-2025-00456',
    court_room: '205',
    scheduled_time: getTimeToday(9, 30),
    hearing_type: 'arraignment',
    parties: {
      plaintiff: 'State of California',
      defendant: 'Michael Anderson'
    },
    judge: 'Hon. Sarah Chen',
    notes: 'Criminal arraignment'
  },
  {
    case_number: 'CV-2025-00789',
    court_room: '101',
    scheduled_time: getTimeToday(10, 30),
    hearing_type: 'motion',
    parties: {
      plaintiff: 'Global Tech Industries',
      defendant: 'Innovation Partners Inc.'
    },
    judge: 'Hon. Robert Martinez',
    notes: 'Motion to dismiss'
  },
  {
    case_number: 'FAM-2025-01234',
    court_room: '308',
    scheduled_time: getTimeToday(11, 0),
    hearing_type: 'hearing',
    parties: {
      plaintiff: 'Jennifer Williams',
      defendant: 'David Williams'
    },
    judge: 'Hon. Maria Rodriguez',
    notes: 'Family court matter'
  },
  {
    case_number: 'CV-2025-01567',
    court_room: '205',
    scheduled_time: getTimeToday(13, 0),
    hearing_type: 'trial',
    parties: {
      plaintiff: 'Riverside Medical Center',
      defendant: 'Atlantic Insurance Co.'
    },
    judge: 'Hon. Sarah Chen',
    notes: 'Medical malpractice case'
  },
  {
    case_number: 'CR-2025-01890',
    court_room: '103',
    scheduled_time: getTimeToday(14, 0),
    hearing_type: 'sentencing',
    parties: {
      plaintiff: 'State of California',
      defendant: 'Robert Thompson'
    },
    judge: 'Hon. James Wilson',
    notes: 'Sentencing hearing'
  },
  {
    case_number: 'CV-2025-02123',
    court_room: '101',
    scheduled_time: getTimeToday(15, 0),
    hearing_type: 'hearing',
    parties: {
      plaintiff: 'Downtown Properties LLC',
      defendant: 'City Planning Commission'
    },
    judge: 'Hon. Robert Martinez',
    notes: 'Zoning appeal'
  },
  {
    case_number: 'CV-2025-02456',
    court_room: '205',
    scheduled_time: getTimeToday(15, 30),
    hearing_type: 'motion',
    parties: {
      plaintiff: 'Taylor Manufacturing',
      defendant: 'Union Local 405'
    },
    judge: 'Hon. Sarah Chen',
    notes: 'Labor dispute motion'
  }
];

// Upcoming hearings (next day)
const upcomingHearings = [
  {
    case_number: 'CV-2025-02789',
    court_room: '101',
    scheduled_time: getTomorrowTime(9, 0),
    hearing_type: 'trial',
    parties: {
      plaintiff: 'Peterson vs. Peterson',
      defendant: 'Estate of Peterson'
    },
    judge: 'Hon. Robert Martinez'
  },
  {
    case_number: 'CR-2025-03012',
    court_room: '103',
    scheduled_time: getTomorrowTime(10, 0),
    hearing_type: 'hearing',
    parties: {
      plaintiff: 'State of California',
      defendant: 'Amanda Garcia'
    },
    judge: 'Hon. James Wilson'
  }
];

/**
 * Get time for today at specified hour and minute
 */
function getTimeToday(hour, minute) {
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  return now.toISOString();
}

/**
 * Get time for tomorrow at specified hour and minute
 */
function getTomorrowTime(hour, minute) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hour, minute, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Create a single hearing
 */
async function createHearing(hearing) {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hearing)
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✓ Created: ${hearing.case_number} - ${hearing.court_room} - ${new Date(hearing.scheduled_time).toLocaleTimeString()}`);
      return result.data;
    } else {
      console.error(`✗ Failed: ${hearing.case_number} - ${result.error}`);
      return null;
    }
  } catch (error) {
    console.error(`✗ Network error for ${hearing.case_number}:`, error.message);
    return null;
  }
}

/**
 * Get statistics
 */
async function getStats() {
  try {
    const response = await fetch(`${API_BASE}/stats`);
    const result = await response.json();

    if (result.success) {
      console.log('\n📊 Statistics:');
      console.log(`  Today's hearings: ${result.data.todays_count}`);
      console.log(`  Upcoming (24h): ${result.data.upcoming_count}`);
      console.log(`  In progress: ${result.data.in_progress_count}`);
      console.log(`  Completed today: ${result.data.completed_count}`);
    }
  } catch (error) {
    console.error('Failed to get stats:', error.message);
  }
}

/**
 * Refresh display
 */
async function refreshDisplay() {
  try {
    console.log('\n🔄 Refreshing displays...');
    const response = await fetch(`${API_BASE}/refresh-display`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✓ Display refreshed:`);
      console.log(`  TVs updated: ${result.data.tvs_updated}`);
      console.log(`  Hearings displayed: ${result.data.hearings_displayed}`);
      console.log(`  Layers created: ${result.data.layers_created}`);
      console.log(`  Layers removed: ${result.data.layers_removed}`);
    } else {
      console.error('✗ Refresh failed:', result.error);
    }
  } catch (error) {
    console.error('✗ Network error:', error.message);
  }
}

/**
 * Demonstrate status changes
 */
async function demonstrateStatusChanges(hearingId) {
  console.log('\n🔄 Demonstrating status changes...');

  try {
    // Delay a hearing
    console.log('  Marking hearing as delayed...');
    let response = await fetch(`${API_BASE}/${hearingId}/delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 15, reason: 'Judge running late' })
    });
    let result = await response.json();
    if (result.success) console.log('  ✓ Marked as delayed');

    await sleep(1000);

    // Mark as in progress
    console.log('  Marking hearing as in progress...');
    response = await fetch(`${API_BASE}/${hearingId}/in-progress`, {
      method: 'POST'
    });
    result = await response.json();
    if (result.success) console.log('  ✓ Marked as in progress');

    await sleep(1000);

    // Mark as completed
    console.log('  Marking hearing as completed...');
    response = await fetch(`${API_BASE}/${hearingId}/complete`, {
      method: 'POST'
    });
    result = await response.json();
    if (result.success) console.log('  ✓ Marked as completed');

  } catch (error) {
    console.error('  ✗ Status change failed:', error.message);
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main execution
 */
async function main() {
  console.log('🏛️ Court Hearing System Demo\n');
  console.log('Creating sample hearings...\n');

  // Create today's hearings
  const createdHearings = [];
  for (const hearing of sampleHearings) {
    const created = await createHearing(hearing);
    if (created) createdHearings.push(created);
    await sleep(200); // Small delay between requests
  }

  // Create upcoming hearings
  console.log('\nCreating upcoming hearings...\n');
  for (const hearing of upcomingHearings) {
    const created = await createHearing(hearing);
    if (created) createdHearings.push(created);
    await sleep(200);
  }

  // Get statistics
  await getStats();

  // Refresh display
  await refreshDisplay();

  // Demonstrate status changes on first hearing
  if (createdHearings.length > 0) {
    await demonstrateStatusChanges(createdHearings[0]._id);
  }

  // Final statistics
  await getStats();

  console.log('\n✅ Demo complete!');
  console.log('\nNext steps:');
  console.log('  1. Visit http://localhost:3000/court-schedule.html to see the admin UI');
  console.log('  2. Check the layer preview to see how hearings appear on TVs');
  console.log('  3. Try filtering by room or time');
  console.log('  4. Update hearing statuses and watch the display refresh');
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { createHearing, getStats, refreshDisplay };
