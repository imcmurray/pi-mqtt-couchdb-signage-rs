const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Base Model class for CouchDB documents
 * Provides common CRUD operations to reduce code duplication
 */
class BaseModel {
  constructor(data, modelType) {
    if (!modelType) {
      throw new Error('Model type is required for BaseModel');
    }
    
    this._id = data._id || `${modelType}_${uuidv4()}`;
    this._rev = data._rev; // Include revision for CouchDB updates
    this.type = modelType;
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  /**
   * Find all documents of this model type
   * @param {string} viewName - The CouchDB view name
   * @param {Function} ModelClass - The model class constructor
   * @returns {Promise<Array>} Array of model instances
   */
  static async findAll(viewName, ModelClass) {
    const db = getDatabase();
    try {
      const result = await db.view(viewName, 'all');
      return result.rows.map(row => new ModelClass(row.value));
    } catch (error) {
      console.error(`Error finding all ${ModelClass.name}s:`, error);
      throw error;
    }
  }

  /**
   * Find a document by ID
   * @param {string} id - Document ID
   * @param {string} expectedType - Expected document type
   * @param {Function} ModelClass - The model class constructor
   * @returns {Promise<Object|null>} Model instance or null if not found
   */
  static async findById(id, expectedType, ModelClass) {
    const db = getDatabase();
    try {
      const doc = await db.get(id);
      return doc.type === expectedType ? new ModelClass(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Find documents by a specific view and key
   * @param {string} viewName - The CouchDB view name
   * @param {string} viewKey - The specific view key (e.g., 'by_status')
   * @param {*} key - The key value to search for
   * @param {Function} ModelClass - The model class constructor
   * @returns {Promise<Array>} Array of model instances
   */
  static async findByView(viewName, viewKey, key, ModelClass) {
    const db = getDatabase();
    try {
      const result = await db.view(viewName, viewKey, { key });
      return result.rows.map(row => new ModelClass(row.value));
    } catch (error) {
      console.error(`Error finding ${ModelClass.name}s by ${viewKey}:`, error);
      throw error;
    }
  }

  /**
   * Save the current document to the database
   * @returns {Promise<Object>} The saved model instance
   */
  async save() {
    const db = getDatabase();
    try {
      this.updated_at = new Date().toISOString();
      const result = await db.insert(this);
      this._rev = result.rev;
      return this;
    } catch (error) {
      console.error(`Error saving ${this.type}:`, error);
      throw error;
    }
  }

  /**
   * Update the document with new data
   * @param {Object} updates - The updates to apply
   * @returns {Promise<Object>} The updated document
   */
  async update(updates) {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      const updated = { 
        ...existing, 
        ...updates, 
        updated_at: new Date().toISOString(),
        // Preserve type and timestamps
        type: existing.type,
        created_at: existing.created_at
      };
      const result = await db.insert(updated);
      return { ...updated, _rev: result.rev };
    } catch (error) {
      console.error(`Error updating ${this.type}:`, error);
      throw error;
    }
  }

  /**
   * Delete the document from the database
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async delete() {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      await db.destroy(existing._id, existing._rev);
      return true;
    } catch (error) {
      console.error(`Error deleting ${this.type}:`, error);
      throw error;
    }
  }

  /**
   * Bulk update multiple documents
   * @param {Array<Object>} documents - Array of documents to update
   * @returns {Promise<Array>} Array of update results
   */
  static async bulkUpdate(documents) {
    const db = getDatabase();
    try {
      const updatedDocs = documents.map(doc => ({
        ...doc,
        updated_at: new Date().toISOString()
      }));
      const result = await db.bulk({ docs: updatedDocs });
      return result;
    } catch (error) {
      console.error('Error performing bulk update:', error);
      throw error;
    }
  }

  /**
   * Count documents by view
   * @param {string} viewName - The CouchDB view name
   * @param {string} viewKey - The specific view key
   * @param {*} key - Optional key value
   * @returns {Promise<number>} Count of documents
   */
  static async countByView(viewName, viewKey, key = null) {
    const db = getDatabase();
    try {
      const options = key !== null ? { key } : {};
      const result = await db.view(viewName, viewKey, { ...options, reduce: true });
      return result.rows[0]?.value || 0;
    } catch (error) {
      console.error(`Error counting documents:`, error);
      throw error;
    }
  }

  /**
   * Get all documents with pagination
   * @param {string} viewName - The CouchDB view name
   * @param {number} limit - Maximum number of documents
   * @param {number} skip - Number of documents to skip
   * @param {Function} ModelClass - The model class constructor
   * @returns {Promise<Object>} Object with data array and total count
   */
  static async paginate(viewName, limit = 10, skip = 0, ModelClass) {
    const db = getDatabase();
    try {
      const [dataResult, countResult] = await Promise.all([
        db.view(viewName, 'all', { limit, skip }),
        db.view(viewName, 'all', { reduce: true })
      ]);
      
      return {
        data: dataResult.rows.map(row => new ModelClass(row.value)),
        total: countResult.rows[0]?.value || 0,
        limit,
        skip
      };
    } catch (error) {
      console.error(`Error paginating ${ModelClass.name}s:`, error);
      throw error;
    }
  }

  /**
   * Check if a document exists
   * @param {string} id - Document ID
   * @returns {Promise<boolean>} True if exists
   */
  static async exists(id) {
    const db = getDatabase();
    try {
      await db.head(id);
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get document with specific fields only
   * @param {string} id - Document ID
   * @param {Array<string>} fields - Fields to include
   * @returns {Promise<Object|null>} Partial document or null
   */
  static async findByIdWithFields(id, fields) {
    const db = getDatabase();
    try {
      const doc = await db.get(id);
      if (!doc) return null;
      
      const partial = {};
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(doc, field)) {
          partial[field] = doc[field];
        }
      });
      return partial;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Validate required fields
   * @param {Array<string>} requiredFields - Array of required field names
   * @throws {Error} If any required field is missing
   */
  validateRequired(requiredFields) {
    const missingFields = requiredFields.filter(field => !this[field]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Convert model instance to JSON, excluding CouchDB internals
   * @returns {Object} Clean JSON representation
   */
  toJSON() {
    const obj = { ...this };
    // Optionally exclude CouchDB revision from API responses
    // delete obj._rev;
    return obj;
  }

  /**
   * Get model metadata
   * @returns {Object} Metadata about the document
   */
  getMetadata() {
    return {
      id: this._id,
      type: this.type,
      created: this.created_at,
      updated: this.updated_at,
      revision: this._rev
    };
  }
}

module.exports = BaseModel;