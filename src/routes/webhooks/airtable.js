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
    
    // Extract raw section from Airtable
    const rawSection = fieldsData.Section || fieldsData.section || '';
    
    // Hard-coded section mapping to guarantee correct IDs
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
      'Mascotas': 'mascotas'
    };
    
    // Determine section ID directly from mapping or by cleaning the raw value
    let sectionId = sectionMapping[rawSection] || forceSectionId || null;
    
    // Special case for "Educación" variants
    if (!sectionId && rawSection.toLowerCase().includes('educa')) {
      sectionId = 'educacion';
    }
    
    // Fallback to uncategorized if no section was found
    if (!sectionId) {
      sectionId = 'uncategorized';
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
        // Store the correct section ID without trailing dash
        section: sectionId 
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
    if (article) {
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
        section: sectionId
      }
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}