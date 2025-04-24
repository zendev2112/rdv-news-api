import axios from 'axios';
import Airtable from 'airtable';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Airtable configuration - use config object if available, fallback to env vars
const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;

// Debug log to verify credentials are available
console.log('Airtable credentials available:', {
  hasToken: !!apiToken,
  hasBaseId: !!baseId
});

/**
 * Gets the Airtable API URL for a specific section table
 * @param {string} sectionId - Section ID
 * @returns {string} - Airtable API URL
 */
function getAirtableApiUrl(sectionId) {
  const section = config.getSection(sectionId);
  
  // Debug log to check if section and tableName exist
  console.log(`Section data for ${sectionId}:`, { 
    hasSection: !!section,
    tableName: section?.tableName || 'NOT_FOUND' 
  });
  
  // Use explicit baseId fallback to ensure we have a value
  const actualBaseId = config.airtable?.baseId || baseId;
  
  if (!section || !section.tableName) {
    // Special handling for primera-plana
    if (sectionId === 'primera-plana') {
      logger.info(`Using hardcoded table name for primera-plana`);
      return `https://api.airtable.com/v0/${actualBaseId}/Primera%20Plana`;
    }
    logger.error(`Missing section or tableName for ${sectionId}`);
    return null;
  }
  
  return `https://api.airtable.com/v0/${actualBaseId}/${encodeURIComponent(section.tableName)}`;
}

/**
 * Inserts records into Airtable
 * @param {Array} records - Array of records to insert
 * @param {string} sectionId - Section ID
 * @returns {Promise<Object|null>} - Response data or null if failed
 */
async function insertRecords(records, sectionId = 'test') {
  if (!records || records.length === 0) {
    logger.warn(`No records to insert into ${sectionId} Airtable table`);
    return null;
  }

  try {
    // Get the API URL
    const airtableApiUrl = getAirtableApiUrl(sectionId);
    
    if (!airtableApiUrl) {
      throw new Error(`Could not generate API URL for section ${sectionId}`);
    }

    // Check for required Airtable configuration
    const actualToken = config.airtable?.personalAccessToken || apiToken;
    
    if (!actualToken) {
      throw new Error('Missing Airtable API token');
    }

    // Add section ID to each record and ensure all required fields are present
    const validRecords = records.filter((record) => {
      // Ensure record has fields
      if (!record.fields) {
        logger.warn('Skipping record with no fields')
        return false
      }

      // Only add section if it's not already present
      if (!record.fields.section) {
        // Map section IDs to their corresponding dropdown values
        let sectionValue = 'Politica' // Default

        if (sectionId === 'economia') {
          sectionValue = 'Economia'
        } else if (sectionId === 'agro') {
          sectionValue = 'Agro'
        }

        record.fields.section = sectionValue
      }

      // Ensure fields meet Airtable requirements (no undefined values)
      Object.keys(record.fields).forEach((key) => {
        if (record.fields[key] === undefined) {
          delete record.fields[key]
        }
      })

      return true
    });

    if (validRecords.length === 0) {
      logger.warn(`No valid records to insert into ${sectionId} Airtable table`);
      return null;
    }

    // Log the first record for debugging
    console.log(`Sample record being sent to Airtable:`, {
      url: validRecords[0].fields.url,
      title: validRecords[0].fields.title,
      fieldCount: Object.keys(validRecords[0].fields).length
    });

    logger.info(
      `Attempting to insert ${validRecords.length} records into ${sectionId} table via ${airtableApiUrl}`
    );

    const response = await axios.post(
      airtableApiUrl,
      { records: validRecords },
      {
        headers: {
          Authorization: `Bearer ${actualToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(
      `Success! Inserted ${validRecords.length} records into ${sectionId} Airtable table`
    );
    return response.data;
  } catch (error) {
    logger.error(
      `Error inserting records into ${sectionId} Airtable table:`,
      error.message
    );

    // Log detailed error information
    if (error.response) {
      logger.error(`Error status: ${error.response.status}`);
      logger.error(`Error response: ${JSON.stringify(error.response.data)}`);

      // For 422 errors, log more details about the data being sent
      if (error.response.status === 422) {
        logger.error(
          'This is likely due to invalid field values, missing required fields, or fields not matching the Airtable schema'
        );

        // Log sample of the records being inserted (first 2)
        const sampleRecords = records.slice(0, 2).map((record) => {
          // Create a safe copy without potentially large text content
          const safeCopy = { fields: { ...record.fields } };

          // Truncate large text fields for logging
          if (safeCopy.fields.article) {
            safeCopy.fields.article =
              safeCopy.fields.article.substring(0, 100) + '...';
          }

          return safeCopy;
        });

        logger.error(
          `Sample of records trying to insert: ${JSON.stringify(sampleRecords)}`
        );
      }
    } else if (error.request) {
      logger.error('Error: No response received from Airtable');
    } else {
      logger.error(`Error message: ${error.message}`);
    }
    
    // Re-throw the error so the calling function can handle it
    throw error;
  }
}

/**
 * Gets records from Airtable
 * @param {string} sectionId - Section ID
 * @param {Object} params - Query parameters
 * @returns {Promise<Array|null>} - Records or null if failed
 */
async function getRecords(sectionId = 'test', params = {}) {
  try {
    const airtableApiUrl = getAirtableApiUrl(sectionId);
    if (!airtableApiUrl) {
      logger.error(`Could not generate API URL for section ${sectionId}`);
      return null;
    }

    // Build query string
    const queryParams = new URLSearchParams();

    if (params.maxRecords) {
      queryParams.append('maxRecords', params.maxRecords);
    }

    if (params.view) {
      queryParams.append('view', params.view);
    }

    if (params.sort) {
      // Airtable expects sort to be formatted very specifically
      // The correct format is: sort[0][field]=fieldName&sort[0][direction]=asc
      if (Array.isArray(params.sort)) {
        params.sort.forEach((sortItem, index) => {
          if (sortItem.field) {
            queryParams.append(`sort[${index}][field]`, sortItem.field);
            if (sortItem.direction) {
              queryParams.append(
                `sort[${index}][direction]`,
                sortItem.direction
              );
            }
          }
        });
      } else {
        // Remove this line that's causing the problem:
        // queryParams.append('sort', JSON.stringify(params.sort));
        logger.warn('Sort parameter is not an array, skipping sort');
      }
    }
    const queryString = queryParams.toString();
    const url = queryString
      ? `${airtableApiUrl}?${queryString}`
      : airtableApiUrl;

    logger.info(`Fetching records from ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.airtable.personalAccessToken}`,
      },
    });

    if (!response.data || !response.data.records) {
      logger.warn(
        `No records found or invalid response format from ${sectionId} Airtable table`
      );
      return [];
    }

    logger.info(
      `Retrieved ${response.data.records.length} records from ${sectionId} Airtable table`
    );
    return response.data.records;
  } catch (error) {
    logger.error(
      `Error getting records from ${sectionId} Airtable table:`,
      error
    );

    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data)}`);
    }

    return []; // Return empty array instead of null to avoid further errors
  }
}

/**
 * Fetches a single record from any Airtable table by ID
 * @param {string} recordId - The Airtable record ID
 * @param {string} sectionId - Section ID or table name
 * @returns {Object} - The Airtable record or null if not found
 */
async function getRecord(recordId, sectionId = 'primera-plana') {
  try {
    logger.info(`Fetching record ${recordId} from section ${sectionId}`);
    
    // Ensure we have a valid Airtable base
    const base = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY
    }).base(process.env.AIRTABLE_BASE_ID);
    
    // Check if the table exists or use a fallback approach
    let table;
    
    try {
      // Try to access the table directly by name
      table = base(sectionId);
      
      // Test if the table is accessible
      logger.debug(`Attempting to access table: ${sectionId}`);
      
      // Fetch the record
      const record = await table.find(recordId);
      
      logger.info(`Successfully retrieved record ${recordId} from ${sectionId}`);
      return record;
      
    } catch (tableError) {
      // If the table doesn't exist by that name, try with alternative formats
      logger.warn(`Table "${sectionId}" not found, trying alternative formats...`);
      
      // Try with Title Case
      const titleCaseTable = sectionId
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
        
      try {
        table = base(titleCaseTable);
        const record = await table.find(recordId);
        logger.info(`Found record in table with Title Case: "${titleCaseTable}"`);
        return record;
      } catch (titleCaseError) {
        // Try with all lowercase
        try {
          const lowercaseTable = sectionId.toLowerCase();
          table = base(lowercaseTable);
          const record = await table.find(recordId);
          logger.info(`Found record in table with lowercase: "${lowercaseTable}"`);
          return record;
        } catch (lowercaseError) {
          // Try with uppercase first letter
          try {
            const capitalizedTable = 
              sectionId.charAt(0).toUpperCase() + 
              sectionId.slice(1);
            table = base(capitalizedTable);
            const record = await table.find(recordId);
            logger.info(`Found record in table with capitalized first letter: "${capitalizedTable}"`);
            return record;
          } catch (capitalizedError) {
            // If we've tried all formats and none work, log the error
            logger.error(`Cannot find table for section: ${sectionId}`);
            logger.error(`Tried formats: "${sectionId}", "${titleCaseTable}", "${sectionId.toLowerCase()}", "${sectionId.charAt(0).toUpperCase() + sectionId.slice(1)}"`);
            throw new Error(`Table not found for section: ${sectionId}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error fetching record ${recordId} from section ${sectionId}:`, error);
    throw error;
  }
}

/**
 * Fetches records from any Airtable table with optional filtering and parameters
 * @param {string} sectionId - Section ID or table name
 * @param {Object} params - Query parameters including:
 *   - maxRecords: Maximum number of records to retrieve
 *   - view: The name of the view to use
 *   - filterByFormula: Airtable formula to filter records
 *   - sort: Array of sort objects with field and direction
 * @returns {Array} - Array of Airtable records
 */
async function fetchRecords(sectionId = 'primera-plana', params = {}) {
  try {
    // Get the API URL for the section
    const airtableApiUrl = getAirtableApiUrl(sectionId);
    if (!airtableApiUrl) {
      logger.error(`Could not generate API URL for section ${sectionId}`);
      return [];
    }

    // Build query string with all parameters
    const queryParams = new URLSearchParams();

    if (params.maxRecords) {
      queryParams.append('maxRecords', params.maxRecords);
    }

    if (params.view) {
      queryParams.append('view', params.view);
    }
    
    if (params.filterByFormula) {
      queryParams.append('filterByFormula', params.filterByFormula);
    }

    if (params.sort) {
      // Handle sort parameters as in your existing getRecords function
      if (Array.isArray(params.sort)) {
        params.sort.forEach((sortItem, index) => {
          if (sortItem.field) {
            queryParams.append(`sort[${index}][field]`, sortItem.field);
            if (sortItem.direction) {
              queryParams.append(`sort[${index}][direction]`, sortItem.direction);
            }
          }
        });
      } else {
        logger.warn('Sort parameter is not an array, skipping sort');
      }
    }

    const queryString = queryParams.toString();
    const url = queryString ? `${airtableApiUrl}?${queryString}` : airtableApiUrl;

    logger.info(`Fetching records from ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.airtable.personalAccessToken || apiToken}`,
      },
    });

    if (!response.data || !response.data.records) {
      logger.warn(`No records found or invalid response format from ${sectionId} Airtable table`);
      return [];
    }

    logger.info(`Retrieved ${response.data.records.length} records from ${sectionId}`);
    return response.data.records;
  } catch (error) {
    logger.error(`Error fetching records from ${sectionId}:`, error.message);

    if (error.response) {
      logger.error(`Status: ${error.response.status}`);
      logger.error(`Response: ${JSON.stringify(error.response.data)}`);
    }

    return []; // Return empty array instead of null to avoid further errors
  }
}

/**
 * Update a record in Airtable
 */
async function updateRecord(recordId, fields, sectionId) {
  try {
    const tableName = encodeURIComponent(sectionId);
    const url = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`;

    console.log(
      `[INFO] Updating record ${recordId} in ${sectionId} Airtable table`
    );
    console.log('With fields:', fields);

    const response = await axios.patch(
      url,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(
      `[INFO] Updated record ${recordId} in ${sectionId} Airtable table`
    );

    return response.data;
  } catch (error) {
    console.error(
      `[ERROR] Error updating Airtable record:`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw error;
  }
}

// Change module.exports to export default
const airtableService = {
  insertRecords,
  getRecords,
  getRecord,
  updateRecord,
  fetchRecords, // Add the new function
};

export default airtableService;
