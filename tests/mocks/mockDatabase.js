// Mock CouchDB database for testing
class MockDatabase {
  constructor() {
    this.documents = new Map();
    this.views = new Map();
  }

  async insert(doc) {
    const id = doc._id || `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const rev = '1-' + Math.random().toString(36).substr(2, 9);
    const fullDoc = { ...doc, _id: id, _rev: rev };
    this.documents.set(id, fullDoc);
    return { id, rev };
  }

  async get(id) {
    const doc = this.documents.get(id);
    if (!doc) {
      const error = new Error('not_found');
      error.statusCode = 404;
      error.reason = 'missing';
      throw error;
    }
    return doc;
  }

  async destroy(id, rev) {
    const doc = this.documents.get(id);
    if (!doc) {
      const error = new Error('not_found');
      error.statusCode = 404;
      throw error;
    }
    if (doc._rev !== rev) {
      const error = new Error('conflict');
      error.statusCode = 409;
      throw error;
    }
    this.documents.delete(id);
    return { ok: true, id, rev };
  }

  async list(params = {}) {
    const docs = Array.from(this.documents.values());
    return {
      total_rows: docs.length,
      offset: params.skip || 0,
      rows: docs
        .slice(params.skip || 0, (params.skip || 0) + (params.limit || docs.length))
        .map(doc => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc }))
    };
  }

  async view(designDoc, viewName, params = {}) {
    const viewKey = `${designDoc}/${viewName}`;
    const viewDocs = this.views.get(viewKey) || [];
    
    let results = viewDocs;
    if (params.key) {
      results = results.filter(row => row.key === params.key);
    }
    if (params.keys) {
      results = results.filter(row => params.keys.includes(row.key));
    }
    
    return {
      total_rows: results.length,
      offset: 0,
      rows: results
    };
  }

  // Helper method to set up view results
  setViewResults(designDoc, viewName, results) {
    const viewKey = `${designDoc}/${viewName}`;
    this.views.set(viewKey, results);
  }

  // Clear all data
  clear() {
    this.documents.clear();
    this.views.clear();
  }
}

// Mock nano instance
const mockNano = () => {
  const databases = new Map();
  
  return {
    db: {
      use: (dbName) => {
        if (!databases.has(dbName)) {
          databases.set(dbName, new MockDatabase());
        }
        return databases.get(dbName);
      },
      create: async (dbName) => {
        if (!databases.has(dbName)) {
          databases.set(dbName, new MockDatabase());
          return { ok: true };
        }
        throw new Error('Database already exists');
      },
      list: async () => {
        return Array.from(databases.keys());
      }
    },
    // Helper method to clear all databases
    _clearAll: () => {
      databases.clear();
    }
  };
};

module.exports = { MockDatabase, mockNano };