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
  let slug = slugify(cleanTitle, {
    lower: true,      // convert to lower case
    strict: true,     // strip special characters
    trim: true,       // trim leading and trailing spaces
    replacement: '-', // replace spaces with hyphens
    remove: /[*+~.()'"!:@]/g // Remove specific characters
  });
  
  // IMPORTANT: Remove any trailing dashes
  slug = slug.replace(/-+$/g, '');
  
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
  const { recordId, tableName, forceSectionId, status = 'published' } = req.body;
  
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
    
    // DIRECTLY CHECK for "Educación" specifically
    let isEducationSection = false;
    let rawSectionValue = fieldsData.Section || fieldsData.section || '';
    
    if (typeof rawSectionValue === 'string' && 
        (rawSectionValue.includes('ducaci') || rawSectionValue.includes('ducación'))) {
      isEducationSection = true;
    }
    
    // Prepare article data
    const title = fieldsData.Title || fieldsData.title || 'Untitled';
    const excerpt = fieldsData.Excerpt || fieldsData.excerpt || '';
    const content = fieldsData.Content || fieldsData.content || fieldsData.Article || fieldsData.article || '';
    const slug = generateSlug(title);
    const image_url = fieldsData.Image?.[0]?.url || fieldsData.image_url || null;
    
    // Insert article with the CORRECT section value
    // This is the key part - we're forcing "educacion" for the section
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
        // Force "educacion" as the section for the Educación case
        section: isEducationSection ? 'educacion' : (rawSectionValue || null)
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
    
    // FORCE create the correct relationship for this article
    if (article) {
      // Delete any existing primary section relationship
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
          section_id: isEducationSection ? 'educacion' : (forceSectionId || 'uncategorized'),
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
        section: isEducationSection ? 'educacion' : article.section
      }
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}