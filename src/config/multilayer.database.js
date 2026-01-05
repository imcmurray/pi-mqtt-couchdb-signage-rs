const nano = require('nano');
const config = require('./multilayer.config');

// Create nano instances for each database
const couchdb = nano(config.getDatabaseUrl());
const databases = {};

// Initialize all databases for multi-layer system
async function initializeMultilayerDatabases() {
  const dbUrls = config.getDatabaseUrls();
  const dbNames = Object.keys(config.database.databases);
  
  for (const dbName of dbNames) {
    const fullDbName = config.database.databases[dbName];
    
    try {
      // Check if database exists
      await couchdb.db.get(fullDbName);
      console.log(`Multi-layer database '${fullDbName}' already exists`);
    } catch (error) {
      if (error.statusCode === 404) {
        // Database doesn't exist, create it
        await couchdb.db.create(fullDbName);
        console.log(`Multi-layer database '${fullDbName}' created successfully`);
      } else {
        throw error;
      }
    }
    
    // Store database reference
    databases[dbName] = couchdb.db.use(fullDbName);
  }
  
  // Create design documents for each database
  await createMultilayerDesignDocuments();
  
  return databases;
}

async function createMultilayerDesignDocuments() {
  // TVs database design documents
  const tvDesignDocs = [
    {
      _id: '_design/tvs',
      views: {
        by_status: {
          map: function(doc) {
            if (doc.type === 'tv') {
              emit(doc.status, doc);
            }
          }.toString()
        },
        by_layer_support: {
          map: function(doc) {
            if (doc.type === 'tv' && doc.config && doc.config.layers) {
              emit(true, doc);
            }
          }.toString()
        },
        all: {
          map: function(doc) {
            if (doc.type === 'tv') {
              emit(doc._id, doc);
            }
          }.toString()
        }
      }
    }
  ];

  // Layers database design documents
  const layerDesignDocs = [
    {
      _id: '_design/layers',
      views: {
        by_tv: {
          map: function(doc) {
            if (doc.type === 'layer') {
              emit(doc.tv_id, doc);
            }
          }.toString()
        },
        by_type: {
          map: function(doc) {
            if (doc.type === 'layer') {
              emit(doc.layer_type, doc);
            }
          }.toString()
        },
        active_by_tv: {
          map: function(doc) {
            if (doc.type === 'layer' && doc.visible) {
              emit(doc.tv_id, doc);
            }
          }.toString()
        },
        by_priority: {
          map: function(doc) {
            if (doc.type === 'layer') {
              emit([doc.tv_id, doc.priority], doc);
            }
          }.toString()
        },
        animations: {
          map: function(doc) {
            if (doc.type === 'layer' && doc.animation_state && doc.animation_state.active) {
              emit(doc.tv_id, doc);
            }
          }.toString()
        }
      }
    }
  ];

  // Images database design documents (same as original)
  const imageDesignDocs = [
    {
      _id: '_design/images',
      views: {
        by_tv: {
          map: function(doc) {
            if (doc.type === 'image' && doc.assigned_tvs) {
              for (var i = 0; i < doc.assigned_tvs.length; i++) {
                emit(doc.assigned_tvs[i], doc);
              }
            }
          }.toString()
        },
        all: {
          map: function(doc) {
            if (doc.type === 'image') {
              emit(doc._id, doc);
            }
          }.toString()
        }
      }
    }
  ];

  // Alerts database design documents
  const alertDesignDocs = [
    {
      _id: '_design/alerts',
      views: {
        all: {
          map: function(doc) {
            if (doc.type === 'alert') {
              emit(doc._id, doc);
            }
          }.toString()
        },
        by_status: {
          map: function(doc) {
            if (doc.type === 'alert') {
              emit(doc.status, doc);
            }
          }.toString()
        },
        by_type: {
          map: function(doc) {
            if (doc.type === 'alert') {
              emit(doc.type, doc);
            }
          }.toString()
        },
        by_created_at: {
          map: function(doc) {
            if (doc.type === 'alert') {
              emit(doc.created_at, doc);
            }
          }.toString()
        }
      }
    }
  ];

  // Apply design documents to respective databases
  await applyDesignDocs(databases.tvs, tvDesignDocs);
  await applyDesignDocs(databases.layers, layerDesignDocs);
  await applyDesignDocs(databases.images, imageDesignDocs);
  await applyDesignDocs(databases.alerts, alertDesignDocs);
}

async function applyDesignDocs(db, designDocs) {
  for (const designDoc of designDocs) {
    try {
      let existingDoc;
      try {
        existingDoc = await db.get(designDoc._id);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
      
      if (existingDoc) {
        designDoc._rev = existingDoc._rev;
        await db.insert(designDoc);
        console.log(`Design document ${designDoc._id} updated`);
      } else {
        await db.insert(designDoc);
        console.log(`Design document ${designDoc._id} created`);
      }
    } catch (error) {
      console.error(`Error creating/updating design document ${designDoc._id}:`, error);
    }
  }
}

function getDatabase(name) {
  if (!databases[name]) {
    throw new Error(`Database '${name}' not initialized. Call initializeMultilayerDatabases() first.`);
  }
  return databases[name];
}

function getAllDatabases() {
  return databases;
}

module.exports = {
  initializeMultilayerDatabases,
  getDatabase,
  getAllDatabases,
  couchdb
};