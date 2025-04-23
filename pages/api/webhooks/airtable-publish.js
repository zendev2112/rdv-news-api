import { createClient } from '@supabase/supabase-js';
import Airtable from 'airtable';

export default async function handler(req, res) {
  try {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    console.log('Webhook received:', req.body);
    
    // Initialize clients inside the handler
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
    
    const recordId = req.body.recordId || 
                    (req.body.record && req.body.record.id) || 
                    (req.body.payload && req.body.payload.recordId);
    
    const sectionId = req.body.sectionId || 
                     (req.body.payload && req.body.payload.sectionId) || 
                     'primera-plana';
    
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'No record ID provided' });
    }
    
    // Fetch record from Airtable
    const base = airtable.base(process.env.AIRTABLE_BASE_ID);
    const airtableRecord = await base(sectionId).find(recordId);
    
    if (!airtableRecord) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    // Map section to section_id
    const fields = airtableRecord.fields;
    let section_id = null;
    if (fields.section) {
      const sectionMapping = {
        'Politica': 'politica',
        'Economia': 'economia',
        'Agro': 'agro'
      };
      section_id = sectionMapping[fields.section] || null;
    }
    
    // Prepare data for Supabase
    const articleData = {
      id: recordId,
      title: fields.title || '',
      overline: fields.overline || '',
      excerpt: fields.excerpt || '',
      article: fields.article || '',
      url: fields.url || '',
      source: fields.source || '',
      image: fields.image ? JSON.stringify(fields.image) : null,
      img_url: fields.imgUrl || '',
      article_images: fields['article-images'] || '',
      ig_post: fields['ig-post'] || '',
      fb_post: fields['fb-post'] || '',
      tw_post: fields['tw-post'] || '',
      yt_video: fields['yt-video'] || '',
      status: fields.status || 'draft',
      section: fields.section || '',
      section_id: section_id,
    };
    
    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('articles')
      .upsert(articleData, {
        onConflict: 'id',
        returning: 'representation',
      });
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
    
    return res.status(200).json({
      success: true,
      message: `Record ${recordId} successfully published to Supabase`,
      data: {
        id: data[0].id,
        title: data[0].title,
        section: data[0].section,
        status: data[0].status,
      }
    });
    
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}