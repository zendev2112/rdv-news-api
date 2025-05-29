import express from 'express';
import Airtable from 'airtable';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * Webhook handler for social media exports to Redes Sociales table
 */
router.post('/social-media', async (req, res) => {
  try {
    const payload = req.body;
    logger.info('Received social media export request', { payload });
    
    // Validate required fields
    const requiredFields = ['title', 'url'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      logger.warn('Missing required fields for social media export', { missingFields });
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }
    
    // Process image attachments - convert Airtable attachment objects to URL-only format
    let processedImage = [];
    if (payload.image && Array.isArray(payload.image)) {
      processedImage = payload.image.map(img => {
        // If it's already in the simple URL format
        if (typeof img === 'string') {
          return { url: img };
        }
        
        // If it's an Airtable attachment object
        if (img.url) {
          return { url: img.url };
        }
        
        return img;
      });
    } else if (payload.imgUrl) {
      // If no image array but imgUrl exists
      processedImage = [{ url: payload.imgUrl }];
    }
    
    // Map section to the correct Airtable value if needed
    let sectionValue = '';
    if (payload.section) {
      // Check if section is an object with a name property (from Airtable)
      if (typeof payload.section === 'object' && payload.section.name) {
        sectionValue = payload.section.name; // Use the name property directly
        logger.info('Using section name from object', { sectionName: sectionValue });
      } 
      // If it's a string, process it normally
      else if (typeof payload.section === 'string') {
        // Map section IDs to their corresponding dropdown values in Airtable
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
        
        // First check if we have a match in the mapping (from display name to ID)
        if (sectionMapping[payload.section]) {
          sectionValue = payload.section; // Use the original display name
        } 
        // Check if the incoming value is actually an ID, find its display name
        else {
          // Reverse mapping to find display name from ID
          for (const [displayName, id] of Object.entries(sectionMapping)) {
            if (id === payload.section) {
              sectionValue = displayName;
              break;
            }
          }
          
          // If still not found, use as is
          if (!sectionValue) {
            sectionValue = payload.section;
          }
        }
      }
    }
    
    // Create record fields
    const fields = {
      title: payload.title,
      overline: payload.overline || '',
      excerpt: payload.excerpt || '',
      article: payload.article || '',
      url: payload.url,
      image: processedImage,
      imgUrl: payload.imgUrl || '',
      tags: payload.tags || '',
      socialMediaText: payload.socialMediaText || '',
      section: sectionValue,
      created_at: new Date().toISOString()
    };
    
    // Get Airtable credentials
    const apiToken = config.airtable?.personalAccessToken || process.env.AIRTABLE_TOKEN;
    const baseId = config.airtable?.baseId || process.env.AIRTABLE_BASE_ID;
    
    if (!apiToken || !baseId) {
      logger.error('Missing Airtable credentials');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Missing Airtable credentials'
      });
    }
    
    // Log the processed fields for debugging
    logger.info('Processed fields for Redes Sociales', { 
      title: fields.title,
      section: fields.section,
      imageCount: processedImage.length
    });
    
    // Initialize Airtable
    const airtable = new Airtable({ apiKey: apiToken });
    const base = airtable.base(baseId);
    
    // Create record in Redes Sociales table
    logger.info('Creating record in Redes Sociales table');
    
    const result = await base('Redes Sociales').create([{ fields }]);
    
    logger.info('Social media export successful', { result });
    
    return res.json({
      success: true,
      message: 'Content successfully exported to Redes Sociales',
      data: result[0]
    });
  } catch (error) {
    logger.error('Error exporting to Redes Sociales', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to export content to Redes Sociales'
    });
  }
});

export default router;