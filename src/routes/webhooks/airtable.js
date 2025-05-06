import { addArticleToSections, getSection } from '../../utils/sections.js';
import { createClient } from '@supabase/supabase-js';
import slugify from 'slugify';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Generate a slug from a title
 */
function generateSlug(title) {
  if (!title || typeof title !== 'string') {
    console.error('Invalid title for slug generation:', title);
    return `article-${Date.now()}`;
  }
  
  // Clean the title before slugifying
  const cleanTitle = title
    .trim()
    .replace(/\s+/g, '-');  // Replace spaces with hyphens
    
  // Use slugify with improved settings
  return slugify(cleanTitle, {
    lower: true,      // convert to lower case
    strict: true,     // strip special characters
    trim: true,       // trim leading and trailing spaces
    replacement: '-', // replace spaces with hyphens
    remove: /[*+~.()'"!:@]/g // Remove specific characters
  });
}

// Add this helper function to clean section IDs

function cleanSectionId(text) {
  if (!text) return 'uncategorized';
  
  // First normalize the text (remove accents)
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Convert to lowercase and replace non-alphanumeric with dash
  let cleaned = normalized.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
    
  // IMPORTANT: Remove trailing dashes
  cleaned = cleaned.replace(/-+$/g, '');
  
  return cleaned || 'uncategorized';
}

/**
 * Handle webhooks from Airtable for publishing content
 */
export async function handlePublishWebhook(req, res) {
  const { recordId, tableName, forceSectionId, status = 'published' } = req.body;
  
  if (!recordId || !tableName) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: recordId and tableName'
    });
  }
  
  try {
    // Get record from Airtable (your existing code)
    const record = await getAirtableRecord(tableName, recordId);
    
    if (!record || !record.fields) {
      return res.status(404).json({
        success: false,
        error: 'Record not found in Airtable'
      });
    }
    
    const { title, excerpt, article: content, image_url } = record.fields;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Record is missing a title'
      });
    }
    
    // Extract section from Airtable data
    let sectionName = record.fields.Section || record.fields.section || '';
    let sectionId = forceSectionId || null;

    // Explicitly fix the "educacion-" issue - direct workaround
    if (sectionName.toLowerCase().includes('educación') || 
        sectionName.toLowerCase().includes('educacion')) {
      console.log('Found Education section, fixing the trailing dash issue');
      sectionName = 'Educación';
      sectionId = 'educacion'; // Use the correct ID directly
    } else if (!sectionId && sectionName) {
      // Regular section lookup logic
      // Clean section name
      const cleanSectionName = sectionName.trim();
      
      console.log(`Looking for section: "${cleanSectionName}"`);
      
      // Create a normalized ID for lookup (removing trailing dashes)
      const normalizedId = cleanSectionName
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with dash
        .replace(/^-+|-+$/g, '');     // Remove leading/trailing dashes
      
      console.log(`Normalized section ID: "${normalizedId}"`);
      
      // Try multiple ways to find the section
      const { data: sections } = await supabase
        .from('sections')
        .select('id, name')
        .or(`name.ilike.${cleanSectionName},id.eq.${normalizedId}`);
      
      if (sections && sections.length > 0) {
        // Found at least one matching section
        sectionId = sections[0].id;
        console.log(`Found matching section: ${sections[0].name} (${sectionId})`);
      } else {
        // No match found, use uncategorized
        console.log(`No matching section found for "${cleanSectionName}", using uncategorized`);
        sectionId = 'uncategorized';
      }
    }
    
    // Create or update the article
    const slug = generateSlug(title);
    
    const { data: article, error: articleError } = await supabase
      .from('articles')
      .upsert({
        title,
        slug,
        excerpt,
        article: content,
        status,
        "imgUrl": image_url,
        published_at: status === 'published' ? new Date().toISOString() : null,
        airtable_id: recordId,
        // Clean up section name explicitly
        section: sectionName && sectionName.toLowerCase().includes('educacion') 
          ? 'educacion' // Use the correct ID without the dash
          : sectionName.trim()
      }, {
        onConflict: 'airtable_id',
        returning: true
      })
      .select()
      .single();
      
    if (articleError) {
      console.error('Error creating/updating article:', articleError);
      return res.status(500).json({
        success: false,
        error: articleError.message
      });
    }
    
    // Add the article to the specified section
    try {
      await addArticleToSections(article.id, sectionId);
    } catch (sectionError) {
      console.error('Error adding article to section:', sectionError);
      return res.status(500).json({
        success: false,
        error: `Article created but failed to add to section: ${sectionError.message}`
      });
    }
    
    // After creating the article, create the section relationship
    if (article) {
      // If we identified this as the education section, create the relationship
      if (sectionId === 'educacion') {
        // First, delete any existing primary relationship for this article
        await supabase
          .from('article_sections')
          .delete()
          .eq('article_id', article.id)
          .eq('is_primary', true);
          
        // Now create the correct relationship
        const { error: relationshipError } = await supabase
          .from('article_sections')
          .insert({
            article_id: article.id,
            section_id: 'educacion',
            is_primary: true
          });
          
        if (relationshipError) {
          console.error('Error creating relationship:', relationshipError);
        }
      }
    }
    
    return res.json({
      success: true,
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
        status: article.status,
        section: section.name
      }
    });
    
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}