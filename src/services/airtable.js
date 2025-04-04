import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Airtable configuration
const apiToken = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;

/**
 * Gets the Airtable API URL for a specific section table
 * @param {string} sectionId - Section ID
 * @returns {string} - Airtable API URL
 */
function getAirtableApiUrl(sectionId) {
  const section = config.getSection(sectionId);
  return `https://api.airtable.com/v0/${config.airtable.baseId}/${section.tableName}`;
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
    const section = config.getSection(sectionId);
    if (!section || !section.tableName) {
      logger.error(`Invalid section ID or missing tableName: ${sectionId}`);
      return null;
    }

    const airtableApiUrl = getAirtableApiUrl(sectionId);

    // Check for required Airtable configuration
    if (!config.airtable.baseId || !config.airtable.personalAccessToken) {
      logger.error(
        'Missing Airtable configuration (baseId or personalAccessToken)'
      );
      return null;
    }

    // Add section ID to each record and ensure all required fields are present
    const validRecords = records.filter((record) => {
      // Ensure record has fields
      if (!record.fields) {
        logger.warn('Skipping record with no fields');
        return false;
      }

      // Add section ID
      record.fields.section = sectionId;

      // Ensure fields meet Airtable requirements (no undefined values)
      Object.keys(record.fields).forEach((key) => {
        if (record.fields[key] === undefined) {
          delete record.fields[key];
        }
      });

      return true;
    });

    if (validRecords.length === 0) {
      logger.warn(`No valid records to insert into ${sectionId} Airtable table`);
      return null;
    }

    logger.info(
      `Attempting to insert ${validRecords.length} records into ${sectionId} Airtable table (${section.tableName})`
    );

    const response = await axios.post(
      airtableApiUrl,
      { records: validRecords },
      {
        headers: {
          Authorization: `Bearer ${config.airtable.personalAccessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(
      `Inserted ${records.length} records into ${sectionId} Airtable table`
    );
    return response.data;
  } catch (error) {
    logger.error(
      `Error inserting records into ${sectionId} Airtable table:`,
      error
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

    return null;
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
 * Gets a single record from Airtable
 * @param {string} recordId - Record ID
 * @param {string} sectionId - Section ID
 * @returns {Promise<Object|null>} - Record data or null if failed
 */
async function getRecord(recordId, sectionId = 'test') {
  try {
    const tableName = encodeURIComponent(sectionId);
    const url = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`;

    console.log(
      `[INFO] Getting record ${recordId} from ${sectionId} Airtable table`
    );

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    console.log(
      `[INFO] Got record ${recordId} from ${sectionId} Airtable table`
    );

    return response.data;
  } catch (error) {
    console.error(
      `[ERROR] Error getting Airtable record:`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw error;
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
};

export default airtableService;
