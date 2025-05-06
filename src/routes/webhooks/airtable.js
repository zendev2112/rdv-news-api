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
  
  // First normalize text to remove accents
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  // Clean the title and generate slug directly
  const slug = normalized
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Remove consecutive hyphens
    .replace(/-+$/g, '');     // Remove trailing dashes
    
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
    
    // Use forceSectionId if provided, otherwise extract from data
    let sectionId = forceSectionId || null;
    let sectionName = fieldsData.Section || fieldsData.section || '';
    
    // Only calculate section ID if not provided
    if (!sectionId && sectionName) {
      // Hard-coded section mapping as fallback
      const sectionMapping = {
        'Educación': 'educacion',
        'Educacion': 'educacion',
        'Política': 'politica',
        'Politica': 'politica',
        'Economía': 'economia',
        'Economia': 'economia',
        'Coronel Suárez': 'coronel-suarez',
        'Coronel Suarez': 'coronel-suarez',
        'Pueblos Alemanes': 'pueblos-alemanes',
        'Huanguelén': 'huanguelen',
        'Huanguelen': 'huanguelen',
        'La Sexta': 'la-sexta',
        'Agro': 'agro',
        'Sociedad': 'sociedad',
        'Salud': 'salud',
        'Cultura': 'cultura',
        'Opinión': 'opinion',
        'Opinion': 'opinion',
        'Deportes': 'deportes',
        'Lifestyle': 'lifestyle',
        'Vinos': 'vinos',
        'El Recetario': 'el-recetario',
        'Santa Trinidad': 'santa-trinidad',
        'San José': 'san-jose',
        'San Jose': 'san-jose',
        'Santa María': 'santa-maria',
        'Santa Maria': 'santa-maria',
        'IActualidad': 'iactualidad',
        'Dólar': 'dolar',
        'Dolar': 'dolar',
        'Propiedades': 'propiedades',
        'Pymes y Emprendimientos': 'pymes-emprendimientos',
        'Inmuebles': 'inmuebles',
        'Campos': 'campos',
        'Construcción y Diseño': 'construccion-diseno',
        'Construccion y Diseño': 'construccion-diseno',
        'Construccion y Diseno': 'construccion-diseno',
        'Agricultura': 'agricultura',
        'Ganadería': 'ganaderia',
        'Ganaderia': 'ganaderia',
        'Tecnologías': 'tecnologias-agro',
        'Tecnologias': 'tecnologias-agro',
        'Educación': 'educacion',
        'Educacion': 'educacion',
        'Policiales': 'policiales',
        'Efemérides': 'efemerides',
        'Efemerides': 'efemerides',
        'Ciencia': 'ciencia',
        'Vida en Armonía': 'vida-armonia',
        'Vida en Armonia': 'vida-armonia',
        'Nutrición y energía': 'nutricion-energia',
        'Nutricion y energia': 'nutricion-energia',
        'Fitness': 'fitness',
        'Salud mental': 'salud-mental',
        'Turismo': 'turismo',
        'Horóscopo': 'horoscopo',
        'Horoscopo': 'horoscopo',
        'Feriados': 'feriados',
        'Loterías y Quinielas': 'loterias-quinielas',
        'Loterias y Quinielas': 'loterias-quinielas',
        'Moda y Belleza': 'moda-belleza',
        'Mascotas': 'mascotas',
        'Sin categoría': 'uncategorized',
        'Sin categoria': 'uncategorized'
      };
      
      sectionId = sectionMapping[sectionName] || 'uncategorized';
    }
    
    // Prepare article data
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
        section: sectionId || sectionName // Use the clean section ID if available
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
    
    // Create the section relationship
    if (article && sectionId) {
      // First delete any existing primary relationships for this article
      await supabase
        .from('article_sections')
        .delete()
        .eq('article_id', article.id)
        .eq('is_primary', true);
      
      // Then create the new relationship with the correct sectionId
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
        section: sectionId || sectionName
      }
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}