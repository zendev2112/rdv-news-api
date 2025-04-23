import dotenv from 'dotenv';
import Airtable from 'airtable';
import { createClient } from '@supabase/supabase-js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config();

// Parse command line arguments
const args = yargs(hideBin(process.argv))
  .option('all', {
    alias: 'a',
    description: 'Process all articles, including draft status',
    type: 'boolean',
    default: false
  })
  .option('limit', {
    alias: 'l',
    description: 'Limit the number of articles to process',
    type: 'number',
    default: 50
  })
  .help()
  .alias('help', 'h')
  .parse();

// Initialize Airtable
const airtableBase = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN
}).base(process.env.AIRTABLE_BASE_ID);

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Sync Primera Plana articles to Supabase
 */
async function syncPrimeraPlana() {
  try {
    console.log('Starting Primera Plana sync...');
    
    // Build filter based on arguments
    let filterByFormula = '';
    if (!args.all) {
      // Only get published articles unless --all flag is provided
      filterByFormula = "{status} = 'Publicado'";
    }
    
    // Fetch articles from Airtable
    const records = await airtableBase('Primera Plana')
      .select({
        maxRecords: args.limit,
        filterByFormula: filterByFormula
      })
      .all();
      
    console.log(`Found ${records.length} Primera Plana articles to process`);
    
    // Process each record
    for (const record of records) {
      try {
        await processRecord(record);
      } catch (error) {
        console.error(`Error processing record ${record.id}:`, error.message);
      }
    }
    
    console.log('Sync completed successfully');
  } catch (error) {
    console.error('Error syncing Primera Plana:', error.message);
  }
}

/**
 * Process a single Primera Plana record
 * @param {Object} record - Airtable record
 */
async function processRecord(record) {
  const fields = record.fields;
  console.log(`Processing: ${fields.title}`);
  
  // Check if article status is valid
  if (fields.status !== 'Publicado' && fields.status !== 'Borrador') {
    console.warn(`Skipping record with invalid status: ${fields.status}`);
    return;
  }
  
  // Prepare article data for Supabase
  const isPublished = fields.status === 'Publicado';
  const publishedAt = isPublished ? new Date().toISOString() : null;
  
  const articleData = {
    title: fields.title || 'Untitled',
    overline: fields.overline || '',
    excerpt: fields.excerpt || '',
    article: fields.article || '',
    url: fields.url || '',
    imgUrl: fields.imgUrl || '',
    article_images: fields['article-images'] || [],
    instagram_post: fields['ig-post'] || null,
    facebook_post: fields['fb-post'] || null,
    twitter_post: fields['tw-post'] || null,
    youtube_video: fields['yt-video'] || null,
    section: fields.section || 'primera-plana',
    status: isPublished ? 'published' : 'draft',
    published_at: publishedAt,
    airtable_id: record.id,
    updated_at: new Date().toISOString()
  };
  
  // Check if article already exists in Supabase by airtable_id
  const { data: existingArticle } = await supabase
    .from('articles')
    .select('id')
    .eq('airtable_id', record.id)
    .maybeSingle();
  
  let result;
  if (existingArticle) {
    // Update existing article
    console.log(`Updating existing article: ${existingArticle.id}`);
    result = await supabase
      .from('articles')
      .update(articleData)
      .eq('id', existingArticle.id);
  } else {
    // Insert new article
    console.log('Creating new article');
    result = await supabase
      .from('articles')
      .insert(articleData);
  }
  
  if (result.error) {
    throw new Error(`Supabase error: ${result.error.message}`);
  }
  
  console.log(`Successfully processed article: ${fields.title}`);
}

// Run the script
syncPrimeraPlana().then(() => {
  console.log('Primera Plana sync script completed');
  process.exit(0);
}).catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});