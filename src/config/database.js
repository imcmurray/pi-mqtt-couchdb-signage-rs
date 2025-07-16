const nano = require('nano');
const config = require('./index');

const couchdb = nano(config.getDatabaseUrl());

let db;

async function initializeDatabase() {
  try {
    // Check if database exists
    await couchdb.db.get(config.database.name);
    console.log(`Database '${config.database.name}' already exists`);
  } catch (error) {
    if (error.statusCode === 404) {
      // Database doesn't exist, create it
      await couchdb.db.create(config.database.name);
      console.log(`Database '${config.database.name}' created successfully`);
    } else {
      throw error;
    }
  }
  
  db = couchdb.db.use(config.database.name);
  
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
              emit([doc.assigned_tv_id, doc.scheduled_time], doc);
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