const nano = require('nano');
require('dotenv').config();

// Build CouchDB URL with authentication if provided
const couchdbUrl = (() => {
  const baseUrl = process.env.COUCHDB_URL || 'http://192.168.1.215:5984';
  const username = process.env.COUCHDB_USERNAME;
  const password = process.env.COUCHDB_PASSWORD;
  
  if (username && password) {
    const url = new URL(baseUrl);
    url.username = username;
    url.password = password;
    return url.toString();
  }
  
  return baseUrl;
})();

const couchdb = nano(couchdbUrl);

const DB_NAME = process.env.COUCHDB_DATABASE || 'digital_signage';

let db;

async function initializeDatabase() {
  try {
    // Check if database exists
    await couchdb.db.get(DB_NAME);
    console.log(`Database '${DB_NAME}' already exists`);
  } catch (error) {
    if (error.statusCode === 404) {
      // Database doesn't exist, create it
      await couchdb.db.create(DB_NAME);
      console.log(`Database '${DB_NAME}' created successfully`);
    } else {
      throw error;
    }
  }
  
  db = couchdb.db.use(DB_NAME);
  
  // Create design documents for views
  await createDesignDocuments();
  
  return db;
}

async function createDesignDocuments() {
  const designDocs = [
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
        all: {
          map: function(doc) {
            if (doc.type === 'tv') {
              emit(doc._id, doc);
            }
          }.toString()
        }
      }
    },
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
        by_status: {
          map: function(doc) {
            if (doc.type === 'image') {
              emit(doc.status, doc);
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
    },
    {
      _id: '_design/schedules',
      views: {
        by_tv_and_time: {
          map: function(doc) {
            if (doc.type === 'schedule') {
              emit([doc.tv_id, doc.scheduled_time], doc);
            }
          }.toString()
        },
        active: {
          map: function(doc) {
            if (doc.type === 'schedule' && doc.active) {
              emit(doc.scheduled_time, doc);
            }
          }.toString()
        }
      }
    }
  ];

  for (const designDoc of designDocs) {
    try {
      // Try to get existing design document
      let existingDoc;
      try {
        existingDoc = await db.get(designDoc._id);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
      
      if (existingDoc) {
        // Update existing design document
        designDoc._rev = existingDoc._rev;
        await db.insert(designDoc);
        console.log(`Design document ${designDoc._id} updated`);
      } else {
        // Create new design document
        await db.insert(designDoc);
        console.log(`Design document ${designDoc._id} created`);
      }
    } catch (error) {
      console.error(`Error creating/updating design document ${designDoc._id}:`, error);
    }
  }
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

module.exports = {
  initializeDatabase,
  getDatabase,
  couchdb
};