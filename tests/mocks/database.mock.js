// Mock database setup for tests
const { MockDatabase } = require('./mockDatabase');

// Create single mock database instance
const mockDb = new MockDatabase();

// Mock nano functions
const mockNano = {
  db: {
    get: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ ok: true }),
    use: jest.fn().mockReturnValue(mockDb)
  }
};

// Mock getDatabase function
const getDatabase = jest.fn().mockReturnValue(mockDb);

// Mock initializeDatabase function
const initializeDatabase = jest.fn().mockResolvedValue(mockDb);

module.exports = {
  couchdb: mockNano,
  getDatabase,
  initializeDatabase,
  mockDb
};