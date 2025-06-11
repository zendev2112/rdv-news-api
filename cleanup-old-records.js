import Airtable from 'airtable'
import dotenv from 'dotenv'
import * as configModule from './src/config/index.js'

dotenv.config()

// Extract config from module (matching your fetch script)
const config = configModule.default

// Initialize Airtable directly
const base = new Airtable({ 
  apiKey: process.env.AIRTABLE_TOKEN 
}).base(process.env.AIRTABLE_BASE_ID)

console.log('Airtable credentials available:', {
  hasToken: !!process.env.AIRTABLE_TOKEN,
  hasBaseId: !!process.env.AIRTABLE_BASE_ID
})

// Your 5 sections to clean up
const SECTIONS_TO_CLEANUP = [
  'primera-plana',
  'instituciones', 
  'local',
  'local-facebook',
  'la-sexta'
]

// Helper function to get table name from section ID
function getTableNameForSection(sectionId) {
  const section = config?.sections?.find(s => s.id === sectionId)
  if (section && section.tableName) {
    return section.tableName
  }
  
  const tableMapping = {
    'primera-plana': 'Primera Plana',
    'instituciones': 'Instituciones',
    'local': 'Local',
    'local-facebook': 'Local Facebook', 
    'la-sexta': 'La Sexta'
  }
  
  return tableMapping[sectionId] || sectionId
}

async function cleanupSection(sectionId) {
  try {
    console.log(`🧹 Starting cleanup for section: ${sectionId}`)
    
    const cutoffDate = new Date(Date.now() - (24 * 60 * 60 * 1000)) // 24 hours ago
    console.log(`Removing records older than: ${cutoffDate.toISOString()}`)
    
    // Get table name for this section
    const tableName = getTableNameForSection(sectionId)
    console.log(`Using table: ${tableName} for section: ${sectionId}`)
    
    // Get the table
    const table = base(tableName)
    
    // Get all records from the table
    const records = []
    await table.select({
      view: 'Grid view'
    }).eachPage((pageRecords, fetchNextPage) => {
      records.push(...pageRecords)
      fetchNextPage()
    })
    
    console.log(`Found ${records.length} total records in ${sectionId}`)
    
    // Debug: Show what the created time field looks like
    if (records.length > 0) {
      console.log(`\n🔍 First record fields:`)
      console.log(`Available fields:`, Object.keys(records[0].fields || {}))
      
      // Look for the created time field (could be named differently)
      const createdTimeFields = ['createdTime', 'Created', 'created', 'Created Time', 'Date Created']
      let createdTimeField = null
      
      for (const fieldName of createdTimeFields) {
        if (records[0].fields && records[0].fields[fieldName]) {
          createdTimeField = fieldName
          console.log(`Found created time field: "${fieldName}" = "${records[0].fields[fieldName]}"`)
          break
        }
      }
      
      if (!createdTimeField) {
        console.log(`⚠️ No created time field found. Available fields:`, Object.keys(records[0].fields || {}))
        return { deleted: 0, section: sectionId, error: 'No created time field found' }
      }
    }
    
    // Filter records older than 24 hours
    const oldRecords = records.filter(record => {
      // Try to find the created time field
      const createdTimeFields = ['createdTime', 'Created', 'created', 'Created Time', 'Date Created']
      let createdTimeValue = null
      let fieldUsed = null
      
      for (const fieldName of createdTimeFields) {
        if (record.fields && record.fields[fieldName]) {
          createdTimeValue = record.fields[fieldName]
          fieldUsed = fieldName
          break
        }
      }
      
      if (!createdTimeValue) {
        console.log(`⚠️ No created time found for record ${record.id}`)
        return false // Don't delete if we can't determine age
      }
      
      // Parse the ISO date string
      const createdTime = new Date(createdTimeValue)
      
      // Check if the date is valid
      if (isNaN(createdTime.getTime())) {
        console.log(`⚠️ Invalid date "${createdTimeValue}" for record ${record.id}`)
        return false // Don't delete if we can't parse the date
      }
      
      const isOld = createdTime < cutoffDate
      
      // Log first few records for debugging
      if (records.indexOf(record) < 3) {
        const ageInHours = (Date.now() - createdTime.getTime()) / (1000 * 60 * 60)
        console.log(`\n🔍 Record ${records.indexOf(record) + 1}:`)
        console.log(`  Field used: ${fieldUsed}`)
        console.log(`  Raw value: ${createdTimeValue}`)
        console.log(`  Parsed time: ${createdTime.toISOString()}`)
        console.log(`  Age: ${ageInHours.toFixed(1)} hours`)
        console.log(`  Should delete: ${isOld ? 'YES' : 'NO'}`)
      }
      
      return isOld
    })
    
    console.log(`\nFound ${oldRecords.length} records to delete in ${sectionId}`)
    
    if (oldRecords.length === 0) {
      console.log(`✅ No old records to delete in ${sectionId}`)
      return { deleted: 0, section: sectionId }
    }
    
    // Show which records will be deleted
    console.log(`\n🗑️ Records to be deleted:`)
    oldRecords.slice(0, 5).forEach((record, index) => {
      const title = record.fields?.title || record.fields?.Title || 'No title'
      const titleShort = title.substring(0, 40)
      console.log(`  ${index + 1}. ${titleShort}...`)
    })
    if (oldRecords.length > 5) {
      console.log(`  ... and ${oldRecords.length - 5} more`)
    }
    
    // Delete old records in batches of 10 (Airtable limit)
    let deletedCount = 0
    const batchSize = 10
    
    for (let i = 0; i < oldRecords.length; i += batchSize) {
      const batch = oldRecords.slice(i, i + batchSize)
      const recordIds = batch.map(record => record.id)
      
      try {
        await table.destroy(recordIds)
        deletedCount += recordIds.length
        console.log(`Deleted batch of ${recordIds.length} records from ${sectionId}`)
        
        // Add delay between batches to avoid rate limits
        if (i + batchSize < oldRecords.length) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } catch (deleteError) {
        console.error(`Error deleting batch from ${sectionId}:`, deleteError.message)
      }
    }
    
    console.log(`✅ Cleanup completed for ${sectionId}: ${deletedCount} records deleted`)
    return { deleted: deletedCount, section: sectionId }
    
  } catch (error) {
    console.error(`❌ Error cleaning up section ${sectionId}:`, error.message)
    return { deleted: 0, section: sectionId, error: error.message }
  }
}

// Main cleanup function
async function runCleanup() {
  console.log('🧹 Starting automated cleanup of old records')
  console.log(`Sections to clean: ${SECTIONS_TO_CLEANUP.join(', ')}`)
  
  const results = []
  let totalDeleted = 0
  
  for (const sectionId of SECTIONS_TO_CLEANUP) {
    const result = await cleanupSection(sectionId)
    results.push(result)
    totalDeleted += result.deleted
    
    // Add delay between sections
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  
  // Summary
  console.log('\n📊 Cleanup Summary:')
  results.forEach(result => {
    if (result.error) {
      console.log(`❌ ${result.section}: Error - ${result.error}`)
    } else {
      console.log(`✅ ${result.section}: ${result.deleted} records deleted`)
    }
  })
  
  console.log(`\n🎉 Total cleanup completed: ${totalDeleted} records deleted`)
  
  return { totalDeleted, results, timestamp: new Date().toISOString() }
}

// Run cleanup
runCleanup()
  .then((summary) => {
    console.log('Cleanup process completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Cleanup process failed:', error.message)
    process.exit(1)
  })