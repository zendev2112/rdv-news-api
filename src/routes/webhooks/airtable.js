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
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens and spaces
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Remove consecutive hyphens
    .toLowerCase();
    
  // If title is empty after cleaning, generate a fallback
  if (!cleanTitle) {
    return `article-${Date.now()}`;
  }
  
  // Use slugify with stricter settings
  let slug = slugify(cleanTitle, {
    lower: true,      // convert to lower case
    strict: true,     // strip special characters
    trim: true,       // trim leading and trailing spaces
    replacement: '-', // replace spaces with hyphens
    remove: /[*+~.()'"!:@]/g // Remove specific characters
  });
  
  // Remove any trailing dashes
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
    
    // Extract section from Airtable data
    let sectionName = fieldsData.Section || fieldsData.section || '';
    
    // DIRECT FIX FOR EDUCACIÓN
    if (sectionName === 'Educación' || sectionName === 'Educacion') {
      // Prepare article data
      const title = fieldsData.Title || fieldsData.title || 'Untitled';
      const excerpt = fieldsData.Excerpt || fieldsData.excerpt || '';
      const content = fieldsData.Content || fieldsData.content || fieldsData.Article || fieldsData.article || '';
      const slug = generateSlug(title);
      const image_url = fieldsData.Image?.[0]?.url || fieldsData.image_url || null;
      
      // INSERT WITH HARDCODED SECTION ID
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
          section: "educacion" // HARDCODED
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
      
      // CREATE RELATIONSHIP WITH HARDCODED SECTION ID
      if (article) {
        // Delete existing primary relationships
        await supabase
          .from('article_sections')
          .delete()
          .eq('article_id', article.id)
          .eq('is_primary', true);
        
        // Create new relationship
        const { error: relationshipError } = await supabase
          .from('article_sections')
          .insert({
            article_id: article.id,
            section_id: "educacion", // HARDCODED
            is_primary: true
          });
        
        if (relationshipError) {
          console.error('Error creating section relationship:', relationshipError);
        }
      }
      
      // Return success
      return res.status(200).json({
        success: true,
        article: {
          id: article.id,
          title: article.title,
          slug: article.slug,
          status: article.status,
          section: "educacion" // HARDCODED
        }
      });
    }
    
    // Original section handling for non-Educación sections
    let sectionId = forceSectionId || null;
    
    if (!sectionId && sectionName) {
      // Clean section name and create slug
      const cleanSectionName = sectionName.trim();
      const sectionSlug = slugify(cleanSectionName, { lower: true, strict: true });
      
      // Check if section exists by name or slug
      const { data: existingSection, error: sectionError } = await supabase
        .from('sections')
        .select('id, name')
        .or(`name.ilike.${cleanSectionName},slug.eq.${sectionSlug}`)
        .single();
      
      if (sectionError && sectionError.code !== 'PGRST116') { 
        // PGRST116 is just "not found" error, which is expected
        console.error('Error checking for existing section:', sectionError);
      }
      
      // If section exists, use it
      if (existingSection) {
        sectionId = existingSection.id;
        console.log(`Found existing section: ${existingSection.name} (${sectionId})`);
      } else {
        // Create new section if it doesn't exist
        const sectionId = sectionSlug;
        
        const { data: newSection, error: createError } = await supabase
          .from('sections')
          .insert({
            id: sectionId,
            name: cleanSectionName,
            slug: sectionSlug,
            position: 100 // Default position at the end
          })
          .select()
          .single();
        
        if (createError) {
          console.error('Error creating section:', createError);
          // Fall back to uncategorized
          sectionId = 'uncategorized';
        } else {
          sectionId = newSection.id;
          console.log(`Created new section: ${newSection.name} (${sectionId})`);
        }
      }
    }
    
    // Now that we have article and section data, create or update the article
    const title = fieldsData.Title || fieldsData.title || 'Untitled';
    const excerpt = fieldsData.Excerpt || fieldsData.excerpt || '';
    const content = fieldsData.Content || fieldsData.content || fieldsData.Article || fieldsData.article || '';
    const slug = generateSlug(title);
    const image_url = fieldsData.Image?.[0]?.url || fieldsData.image_url || null;
    
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
        // Store raw section name in article.section field as a fallback
        section: sectionName 
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
    
    console.log(`Article ${status === 'published' ? 'published' : 'updated'}: ${article.title} (${article.id})`);
    
    // Connect article to section if we have a section ID
    if (article) {
      // Delete existing connections
      await supabase
        .from('article_sections')
        .delete()
        .eq('article_id', article.id)
        .eq('is_primary', true);
      
      // Create new primary connection - use uncategorized if no section found
      const finalSectionId = sectionId || 'uncategorized';
      
      const { error: connectionError } = await supabase
        .from('article_sections')
        .insert({
          article_id: article.id,
          section_id: finalSectionId,
          is_primary: true
        });
      
      if (connectionError) {
        console.error('Error connecting article to section:', connectionError);
      } else {
        console.log(`Connected article to section: ${finalSectionId} (primary: true)`);
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
        section: sectionId || 'uncategorized'
      }
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}