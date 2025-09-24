import { handlePublishStatusChange } from '../src/services/statusChangeHandler.js'

/**
 * Check if a record needs Cloudinary upload after status change
 * Usage: node scripts/check-published.js <recordId> <tableName> <sectionId>
 */
async function checkPublished() {
  const args = process.argv.slice(2)

  if (args.length < 3) {
    console.error(
      'Usage: node scripts/check-published.js <recordId> <tableName> <sectionId>'
    )
    console.error(
      'Example: node scripts/check-published.js rec123456789 "Primera Plana" primera-plana'
    )
    process.exit(1)
  }

  const [recordId, tableName, sectionId] = args

  try {
    const updated = await handlePublishStatusChange(
      recordId,
      tableName,
      sectionId
    )

    if (updated) {
      console.log('✅ Images uploaded to Cloudinary and URLs updated!')
    } else {
      console.log(
        'ℹ️ No action needed - already has Cloudinary URLs or not published'
      )
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

checkPublished()
