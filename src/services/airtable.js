import axios from 'axios'
import Airtable from 'airtable'
import config from '../config/index.js'
import logger from '../utils/logger.js'


// Airtable configuration - use config object if available, fallback to env vars
const apiToken =
  config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN
const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID

// Debug log to verify credentials are available
console.log('Airtable credentials available:', {
  hasToken: !!apiToken,
  hasBaseId: !!baseId,
})

/**
 * Gets the Airtable API URL for a specific section table
 * @param {string} sectionId - Section ID
 * @returns {string} - Airtable API URL
 */
function getAirtableApiUrl(sectionId) {
  const section = config.getSection(sectionId)

  // Debug log to check if section and tableName exist
  console.log(`Section data for ${sectionId}:`, {
    hasSection: !!section,
    tableName: section?.tableName || 'NOT_FOUND',
  })

  // Use explicit baseId fallback to ensure we have a value
  const actualBaseId = config.airtable?.baseId || baseId

  if (!section || !section.tableName) {
    // Special handling for primera-plana
    if (sectionId === 'primera-plana') {
      logger.info(`Using hardcoded table name for primera-plana`)
      return `https://api.airtable.com/v0/${actualBaseId}/Primera%20Plana`
    }
    logger.error(`Missing section or tableName for ${sectionId}`)
    return null
  }

  return `https://api.airtable.com/v0/${actualBaseId}/${encodeURIComponent(
    section.tableName
  )}`
}

// Add this helper function to airtable.js before the insertRecords function:

/**
 * Validates and processes Airtable attachment URLs
 * @param {Array} attachments - Array of Airtable attachment objects
 * @returns {Object} - Object with main URL and all URLs
 */
function processAirtableAttachments(attachments) {
  try {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return { mainUrl: '', allUrls: [] }
    }

    const validAttachments = attachments.filter(
      (att) => att && att.url && att.url.includes('airtableusercontent.com')
    )

    if (validAttachments.length === 0) {
      return { mainUrl: '', allUrls: [] }
    }

    const mainUrl = validAttachments[0].url
    const allUrls = validAttachments.map((att) => att.url)

    logger.info(`Processed ${validAttachments.length} Airtable attachment URLs`)
    return { mainUrl, allUrls }
  } catch (error) {
    logger.error('Error processing Airtable attachments:', error.message)
    return { mainUrl: '', allUrls: [] }
  }
}

/**
 * Inserts records into Airtable
 * @param {Array} records - Array of records to insert
 * @param {string} sectionId - Section ID
 * @returns {Promise<Object|null>} - Response data or null if failed
 */
async function insertRecords(records, sectionId = 'test') {
  if (!records || records.length === 0) {
    logger.warn(`No records to insert into ${sectionId} Airtable table`)
    return null
  }

  try {
    // Get the API URL
    const airtableApiUrl = getAirtableApiUrl(sectionId)

    if (!airtableApiUrl) {
      throw new Error(`Could not generate API URL for section ${sectionId}`)
    }

    // Check for required Airtable configuration
    const actualToken = config.airtable?.personalAccessToken || apiToken

    if (!actualToken) {
      throw new Error('Missing Airtable API token')
    }

    // Add section ID to each record and ensure all required fields are present
    const validRecords = records.filter((record) => {
      // Ensure record has fields
      if (!record.fields) {
        logger.warn('Skipping record with no fields')
        return false
      }

      // CRITICAL: Make sure overline and excerpt are properly handled
      // Map volanta to overline if needed
      if (!record.fields.overline && record.fields.volanta) {
        record.fields.overline = record.fields.volanta
      }

      // Map bajada to excerpt if needed
      if (!record.fields.excerpt && record.fields.bajada) {
        record.fields.excerpt = record.fields.bajada
      }

      // Only add section if it's not already present AND the table should have a section field
      if (!record.fields.section && shouldAddSectionField(sectionId)) {
        // Map section IDs to their corresponding dropdown values that exist in Airtable
        const sectionIdToAirtableValue = {
          'coronel-suarez': 'Coronel Suárez',
          'pueblos-alemanes': 'Pueblos Alemanes',
          huanguelen: 'Huanguelén',
          'la-sexta': 'La Sexta',
          politica: 'Política',
          economia: 'Economía',
          agro: 'Agro',
          sociedad: 'Sociedad',
          salud: 'Salud',
          cultura: 'Cultura',
          opinion: 'Opinión',
          deportes: 'Deportes',
          lifestyle: 'Lifestyle',
          vinos: 'Vinos',
          'el-recetario': 'El Recetario',
          'santa-trinidad': 'Santa Trinidad',
          'san-jose': 'San José',
          'santa-maria': 'Santa María',
          iactualidad: 'IActualidad',
          dolar: 'Dólar',
          propiedades: 'Propiedades',
          'pymes-emprendimientos': 'Pymes y Emprendimientos',
          inmuebles: 'Inmuebles',
          campos: 'Campos',
          'construccion-diseno': 'Construcción y Diseño',
          agricultura: 'Agricultura',
          ganaderia: 'Ganadería',
          'tecnologias-agro': 'Tecnologías',
          educacion: 'Educación',
          policiales: 'Policiales',
          efemerides: 'Efemérides',
          ciencia: 'Ciencia',
          'vida-armonia': 'Vida en Armonía',
          'nutricion-energia': 'Nutrición y Energía',
          fitness: 'Fitness',
          'salud-mental': 'Salud Mental',
          turismo: 'Turismo',
          horoscopo: 'Horóscopo',
          feriados: 'Feriados',
          'loterias-quinielas': 'Loterías y Quinielas',
          'moda-belleza': 'Moda y Belleza',
          mascotas: 'Mascotas',
          ambiente: 'Ambiente' 
        }

        // Get section value from mapping, fall back to a default
        let sectionValue = sectionIdToAirtableValue[sectionId] || ''

        console.log(`Setting section to "${sectionValue}" for article`)
        record.fields.section = sectionValue
      } else if (!record.fields.section && !shouldAddSectionField(sectionId)) {
        console.log(
          `Skipping section field for ${sectionId} table as it doesn't need one`
        )
      }

      // Ensure fields meet Airtable requirements (no undefined values)
      Object.keys(record.fields).forEach((key) => {
        if (record.fields[key] === undefined) {
          delete record.fields[key]
        }
      })

      return true
    })

    if (validRecords.length === 0) {
      logger.warn(`No valid records to insert into ${sectionId} Airtable table`)
      return null
    }

    // Log the first record for debugging
    console.log(`Sample record being sent to Airtable:`, {
      url: validRecords[0].fields.url,
      title: validRecords[0].fields.title,
      overline: validRecords[0].fields.overline, // Show overline in logs
      excerpt: validRecords[0].fields.excerpt, // Show excerpt in logs
      fieldCount: Object.keys(validRecords[0].fields).length,
    })

    logger.info(
      `Attempting to insert ${validRecords.length} records into ${sectionId} table via ${airtableApiUrl}`
    )

    // Step 1: Insert records into Airtable (existing code)
    const response = await axios.post(
      airtableApiUrl,
      { records: validRecords },
      {
        headers: {
          Authorization: `Bearer ${actualToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    logger.info(
      `Success! Inserted ${validRecords.length} records into ${sectionId} Airtable table`
    )

    // ✅ NEW STEP 2: Wait for Airtable to process attachments, then fetch and update
    const createdRecords = response.data.records
    const recordsToUpdate = []

    // Wait 2-3 seconds for Airtable to process the images
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Re-fetch each record to get the processed Airtable URLs
    for (const record of createdRecords) {
      try {
        // Re-fetch the record to get processed attachment URLs
        const refetchResponse = await axios.get(
          `${airtableApiUrl}/${record.id}`,
          {
            headers: {
              Authorization: `Bearer ${actualToken}`,
            },
          }
        )

        const freshFields = refetchResponse.data.fields

        // Extract Airtable URLs (keep for drafts)
        let airtableUrls = []
        if (
          freshFields.image &&
          Array.isArray(freshFields.image) &&
          freshFields.image.length > 0
        ) {
          airtableUrls = freshFields.image
            .filter(
              (img) => img.url && img.url.includes('airtableusercontent.com')
            )
            .map((img) => img.url)

          console.log(
            `🔍 Found ${airtableUrls.length} Airtable URLs for draft record ${record.id}`
          )
        }

        // ✅ FOR DRAFTS: Use Airtable URLs directly (NO Cloudinary upload)
        if (airtableUrls.length > 0) {
          const updateData = {
            imgUrl: airtableUrls[0], // Main Airtable URL for drafts
            'article-images': airtableUrls.slice(1).join(', '), // Additional Airtable URLs
          }

          recordsToUpdate.push({
            id: record.id,
            fields: updateData,
          })

          logger.info(
            `✅ Set draft URLs for record ${record.id} - Main: 1, Additional: ${
              airtableUrls.length - 1
            }`
          )
        }
      } catch (fetchError) {
        logger.error(
          `❌ Error processing record ${record.id}:`,
          fetchError.message
        )
      }
    }

    // ✅ NEW STEP 3: Update records with Airtable URLs if needed
        if (recordsToUpdate.length > 0) {
          logger.info(
            `Updating ${recordsToUpdate.length} records with Airtable URLs for drafts`
          )

          try {
            await axios.patch(
              airtableApiUrl,
              { records: recordsToUpdate },
              {
                headers: {
                  Authorization: `Bearer ${actualToken}`,
                  'Content-Type': 'application/json',
                },
              }
            )

            logger.info(
              `Successfully updated ${recordsToUpdate.length} records with draft URLs`
            )
          } catch (updateError) {
            logger.error(
              `Error updating records with draft URLs:`,
              updateError.message
            )
          }
        }

    return response.data
  } catch (error) {
    logger.error(
      `Error inserting records into ${sectionId} Airtable table:`,
      error.message
    )

    // Log detailed error information
    if (error.response) {
      logger.error(`Error status: ${error.response.status}`)
      logger.error(`Error response: ${JSON.stringify(error.response.data)}`)

      // For 422 errors, log more details about the data being sent
      if (error.response.status === 422) {
        logger.error(
          'This is likely due to invalid field values, missing required fields, or fields not matching the Airtable schema'
        )

        // Log sample of the records being inserted (first 2)
        const sampleRecords = records.slice(0, 2).map((record) => {
          // Create a safe copy without potentially large text content
          const safeCopy = { fields: { ...record.fields } }

          // Truncate large text fields for logging
          if (safeCopy.fields.article) {
            safeCopy.fields.article =
              safeCopy.fields.article.substring(0, 100) + '...'
          }

          return safeCopy
        })

        logger.error(
          `Sample of records trying to insert: ${JSON.stringify(sampleRecords)}`
        )
      }
    } else if (error.request) {
      logger.error('Error: No response received from Airtable')
    } else {
      logger.error(`Error message: ${error.message}`)
    }

    // Re-throw the error so the calling function can handle it
    throw error
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
    const airtableApiUrl = getAirtableApiUrl(sectionId)
    if (!airtableApiUrl) {
      logger.error(`Could not generate API URL for section ${sectionId}`)
      return null
    }

    // Build query string
    const queryParams = new URLSearchParams()

    if (params.maxRecords) {
      queryParams.append('maxRecords', params.maxRecords)
    }

    if (params.view) {
      queryParams.append('view', params.view)
    }

    if (params.sort) {
      // Airtable expects sort to be formatted very specifically
      // The correct format is: sort[0][field]=fieldName&sort[0][direction]=asc
      if (Array.isArray(params.sort)) {
        params.sort.forEach((sortItem, index) => {
          if (sortItem.field) {
            queryParams.append(`sort[${index}][field]`, sortItem.field)
            if (sortItem.direction) {
              queryParams.append(
                `sort[${index}][direction]`,
                sortItem.direction
              )
            }
          }
        })
      } else {
        // Remove this line that's causing the problem:
        // queryParams.append('sort', JSON.stringify(params.sort));
        logger.warn('Sort parameter is not an array, skipping sort')
      }
    }
    const queryString = queryParams.toString()
    const url = queryString
      ? `${airtableApiUrl}?${queryString}`
      : airtableApiUrl

    logger.info(`Fetching records from ${url}`)

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.airtable.personalAccessToken}`,
      },
    })

    if (!response.data || !response.data.records) {
      logger.warn(
        `No records found or invalid response format from ${sectionId} Airtable table`
      )
      return []
    }

    logger.info(
      `Retrieved ${response.data.records.length} records from ${sectionId} Airtable table`
    )
    return response.data.records
  } catch (error) {
    logger.error(
      `Error getting records from ${sectionId} Airtable table:`,
      error
    )

    if (error.response) {
      logger.error(`Status: ${error.response.status}`)
      logger.error(`Response: ${JSON.stringify(error.response.data)}`)
    }

    return [] // Return empty array instead of null to avoid further errors
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
    logger.info(`Fetching record ${recordId} from section ${sectionId}`)

    // Use the apiToken variable that's already defined at the top of the file
    // instead of process.env.AIRTABLE_API_KEY
    if (!apiToken) {
      throw new Error('Airtable API token is missing')
    }

    // Initialize Airtable with the correct API key
    const base = new Airtable({
      apiKey: apiToken, // Use apiToken instead of process.env.AIRTABLE_API_KEY
    }).base(baseId) // Use baseId instead of process.env.AIRTABLE_BASE_ID

    // Special handling for the Instituciones table
    if (sectionId.toLowerCase() === 'instituciones') {
      try {
        // Try to access the table directly with the exact name
        const record = await base('Instituciones').find(recordId)
        logger.info(
          `Successfully retrieved record ${recordId} from Instituciones`
        )
        return record
      } catch (error) {
        logger.error(
          `Error fetching record from Instituciones: ${error.message}`
        )
        throw error
      }
    }

    // For other tables, try the original section ID first
    try {
      const record = await base(sectionId).find(recordId)
      logger.info(`Successfully retrieved record ${recordId} from ${sectionId}`)
      return record
    } catch (tableError) {
      // If the exact name fails, try with Title Case
      const titleCaseTable = sectionId
        .split(/[-_]/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(' ')

      try {
        const record = await base(titleCaseTable).find(recordId)
        logger.info(
          `Found record in table with Title Case: "${titleCaseTable}"`
        )
        return record
      } catch (error) {
        // If both attempts fail, log error and throw
        logger.error(
          `Cannot find record ${recordId} in table ${sectionId} or ${titleCaseTable}`
        )
        throw new Error(`Record not found: ${recordId} in section ${sectionId}`)
      }
    }
  } catch (error) {
    logger.error(`Error fetching record: ${error.message}`)
    throw error
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
    const airtableApiUrl = getAirtableApiUrl(sectionId)
    if (!airtableApiUrl) {
      logger.error(`Could not generate API URL for section ${sectionId}`)
      return []
    }

    // Build query string with all parameters
    const queryParams = new URLSearchParams()

    if (params.maxRecords) {
      queryParams.append('maxRecords', params.maxRecords)
    }

    if (params.view) {
      queryParams.append('view', params.view)
    }

    if (params.filterByFormula) {
      queryParams.append('filterByFormula', params.filterByFormula)
    }

    if (params.sort) {
      // Handle sort parameters as in your existing getRecords function
      if (Array.isArray(params.sort)) {
        params.sort.forEach((sortItem, index) => {
          if (sortItem.field) {
            queryParams.append(`sort[${index}][field]`, sortItem.field)
            if (sortItem.direction) {
              queryParams.append(
                `sort[${index}][direction]`,
                sortItem.direction
              )
            }
          }
        })
      } else {
        logger.warn('Sort parameter is not an array, skipping sort')
      }
    }

    const queryString = queryParams.toString()
    const url = queryString
      ? `${airtableApiUrl}?${queryString}`
      : airtableApiUrl

    logger.info(`Fetching records from ${url}`)

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${
          config.airtable.personalAccessToken || apiToken
        }`,
      },
    })

    if (!response.data || !response.data.records) {
      logger.warn(
        `No records found or invalid response format from ${sectionId} Airtable table`
      )
      return []
    }

    logger.info(
      `Retrieved ${response.data.records.length} records from ${sectionId}`
    )
    return response.data.records
  } catch (error) {
    logger.error(`Error fetching records from ${sectionId}:`, error.message)

    if (error.response) {
      logger.error(`Status: ${error.response.status}`)
      logger.error(`Response: ${JSON.stringify(error.response.data)}`)
    }

    return [] // Return empty array instead of null to avoid further errors
  }
}

/**
 * Update a record in Airtable
 */
async function updateRecord(recordId, fields, sectionId) {
  try {
    const tableName = encodeURIComponent(sectionId)
    const url = `https://api.airtable.com/v0/${baseId}/${tableName}/${recordId}`

    console.log(
      `[INFO] Updating record ${recordId} in ${sectionId} Airtable table`
    )
    console.log('With fields:', fields)

    const response = await axios.patch(
      url,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    console.log(
      `[INFO] Updated record ${recordId} in ${sectionId} Airtable table`
    )

    return response.data
  } catch (error) {
    console.error(
      `[ERROR] Error updating Airtable record:`,
      error.response?.status,
      error.response?.data || error.message
    )
    throw error
  }
}

/**
 * Determines if a section field should be added to the record
 * @param {string} tableIdentifier - The table name or section ID
 * @returns {boolean} - True if section field should be added
 */
function shouldAddSectionField(tableIdentifier) {
  // Convert to lowercase for case-insensitive comparison
  const normalized = tableIdentifier.toLowerCase()

  // Tables known to NOT use the "section" field
  return !(
    normalized === 'instituciones' ||
    normalized.includes('social') ||
    normalized.includes('config') ||
    normalized.includes('settings')
  )
}

// Change module.exports to export default
const airtableService = {
  insertRecords,
  getRecords,
  getRecord,
  updateRecord,
  fetchRecords, // Add the new function
}

export default airtableService
