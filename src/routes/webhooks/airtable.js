import { addArticleToSections, getSection } from '../../utils/sections.js';
import { createClient } from '@supabase/supabase-js';
import slugify from 'slugify';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Generate a high-quality slug from a title
 */
function generateSlug(title) {
  if (!title || typeof title !== 'string') {
    console.error('Invalid title for slug generation:', title);
    return `article-${Date.now()}`;
  }
  
  // Step 1: Normalize the text to remove accents
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  // Step 2: Create a better quality slug
  let slug = slugify(normalized, {
    lower: true,       // convert to lower case
    strict: true,      // strip special characters
    trim: true,        // trim leading and trailing spaces
    replacement: '-',  // replace spaces with hyphens
    locale: 'es',      // Use Spanish locale for better handling of special chars
    remove: /[*+~.()'"!:@#%^&]/g // Remove more problematic characters
  });
  
  // Step 3: Clean up the result
  slug = slug
    .replace(/-+/g, '-')     // Replace multiple dashes with single dash
    .replace(/^-+|-+$/g, ''); // Remove leading and trailing dashes
  
  // Step 4: Limit slug length but preserve whole words where possible
  if (slug.length > 80) {
    // Cut at the last dash before character 80
    const lastDashPos = slug.substring(0, 80).lastIndexOf('-');
    if (lastDashPos > 40) { // Ensure we don't cut too short
      slug = slug.substring(0, lastDashPos);
    } else {
      // If no suitable dash found, just cut at 80
      slug = slug.substring(0, 80);
    }
  }
  
  // Ensure we have something valid
  return slug || `article-${Date.now()}`;
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
  const { recordId, tableName, forceSectionId, status = 'published', tags, socialMediaText } = req.body;
  
  if (!recordId) {
    return res.status(400).json({ success: false, error: 'Record ID is required' });
  }
  
  try {
    // Fetch record from Airtable
    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableName}/${recordId}`;
    
    const airtableResponse = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });
    
    if (!airtableResponse.ok) {
      return res.status(500).json({ 
        success: false, 
        error: `Failed to fetch from Airtable: ${airtableResponse.statusText}` 
      });
    }
    
    const airtableData = await airtableResponse.json();
    const fieldsData = airtableData.fields;
    
    // Use forceSectionId if provided, otherwise extract from data
    let sectionId = forceSectionId || null;
    let sectionName = fieldsData.Section || fieldsData.section || '';
    
    // Determine section ID if not forced
    if (!sectionId && sectionName) {
      // Special handling for Education section
      if (sectionName.toLowerCase().includes('educa')) {
        sectionId = 'educacion';
      } else {
        // Create a clean section ID
        sectionId = sectionName
          .toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove accents
          .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
          .replace(/^-+|-+$/g, '');    // Remove leading/trailing dashes
      }
      
      // Ensure no trailing dash (the root of our original bug)
      sectionId = sectionId.replace(/-+$/g, '');
    }
    
    // Default to uncategorized if no section was found
    if (!sectionId) {
      sectionId = 'uncategorized';
    }
    
    // Prepare article data
    const title = fieldsData.Title || fieldsData.title || 'Untitled';
    const excerpt = fieldsData.Excerpt || fieldsData.excerpt || '';
    const content = fieldsData.Content || fieldsData.content || fieldsData.Article || fieldsData.article || '';
    const slug = generateSlug(title);
    const image_url = fieldsData.Image?.[0]?.url || fieldsData.image_url || null;
    
    // Get tags and social media text either from the request body or Airtable fields
    const articleTags = fieldsData.tags || tags || '';
    const articleSocialMediaText = fieldsData.socialMediaText || socialMediaText || '';
    
    // Insert or update the article
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
        section: sectionId,
        tags: articleTags,
        social_media_text: articleSocialMediaText
      }, {
        onConflict: 'airtable_id',
        returning: true
      })
      .select()
      .single();
    
    if (articleError) {
      console.error('Error creating article:', articleError);
      return res.status(500).json({ success: false, error: articleError.message });
    }
    
    // Create the section relationship
    if (article) {
      // First delete any existing primary relationships
      await supabase
        .from('article_sections')
        .delete()
        .eq('article_id', article.id)
        .eq('is_primary', true);
      
      // Create the new relationship with the correct section ID
      const { error: relationshipError } = await supabase
        .from('article_sections')
        .insert({
          article_id: article.id,
          section_id: sectionId,
          is_primary: true
        });
      
      if (relationshipError) {
        console.error('Error creating section relationship:', relationshipError);
      }
    }
    
    // Return success response
    return res.status(200).json({
      success: true,
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
        status: article.status,
        section: sectionId,
        tags: articleTags,
        social_media_text: articleSocialMediaText
      }
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}