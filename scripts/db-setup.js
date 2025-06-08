#!/usr/bin/env node

const { initializeDatabase } = require('../src/config/database');

async function setupDatabase() {
  try {
    console.log('Setting up CouchDB database...');
    await initializeDatabase();
    console.log('Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Database setup failed:', error.message);
    process.exit(1);
  }
}

setupDatabase();