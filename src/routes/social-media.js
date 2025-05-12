import express from 'express';
import { generateSocialImage, generatePlatformImage } from '../services/imageGenerator.js';
import supabaseService from '../services/supabase.js';

const router = express.Router();

/**
 * Generate a social media image for an article
 */
router.post('/generate-image', async (req, res) => {
  try {
    const { articleId, platform = 'facebook' } = req.body;
    
    if (!articleId) {
      return res.status(400).json({
        success: false,
        error: 'Article ID is required'
      });
    }
    
    // Get article data
    const articleResult = await supabaseService.getArticleById(articleId);
    
    if (!articleResult.success || !articleResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    const article = articleResult.data;
    
    // Generate the image for the specific platform
    const imageBuffer = platform.toLowerCase() === 'all' 
      ? await generateSocialImage(article) 
      : await generatePlatformImage(article, platform);
    
    // Upload to Supabase Storage
    const fileName = platform.toLowerCase() === 'all'
      ? `social-images/${articleId}.jpg`
      : `social-images/${articleId}-${platform.toLowerCase()}.jpg`;
    
    // Check if media bucket exists and create if needed
    try {
      const { data: buckets } = await supabaseService.supabase
        .storage
        .listBuckets();
        
      if (!buckets.find(b => b.name === 'media')) {
        await supabaseService.supabase
          .storage
          .createBucket('media', { public: true });
      }
    } catch (bucketError) {
      console.error('Error checking/creating bucket:', bucketError);
    }
    
    // Upload the image
    const { error: uploadError } = await supabaseService.supabase
      .storage
      .from('media')
      .upload(fileName, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (uploadError) {
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }
    
    // Get public URL
    const { data: urlData } = supabaseService.supabase
      .storage
      .from('media')
      .getPublicUrl(fileName);
    
    const imageUrl = urlData.publicUrl;
    
    // Update article with social image URL
    if (platform.toLowerCase() === 'all') {
      const { error: updateError } = await supabaseService.supabase
        .from('articles')
        .update({ social_image_url: imageUrl })
        .eq('id', articleId);
      
      if (updateError) {
        console.error('Error updating article with social image URL:', updateError);
      }
    }
    
    return res.status(200).json({
      success: true,
      data: {
        imageUrl,
        articleId,
        articleTitle: article.title,
        platform
      }
    });
  } catch (error) {
    console.error('Error generating social image:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate all platform images for an article
 */
router.post('/generate-all', async (req, res) => {
  try {
    const { articleId } = req.body;
    
    if (!articleId) {
      return res.status(400).json({
        success: false,
        error: 'Article ID is required'
      });
    }
    
    // Get article data
    const articleResult = await supabaseService.getArticleById(articleId);
    
    if (!articleResult.success || !articleResult.data) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    const article = articleResult.data;
    
    // Generate images for all supported platforms
    const platforms = ['facebook', 'twitter', 'instagram', 'tiktok'];
    const results = {};
    
    for (const platform of platforms) {
      try {
        // Generate the image
        const imageBuffer = await generatePlatformImage(article, platform);
        
        // Upload to Supabase Storage
        const fileName = `social-images/${articleId}-${platform}.jpg`;
        
        // Upload the image
        const { error: uploadError } = await supabaseService.supabase
          .storage
          .from('media')
          .upload(fileName, imageBuffer, {
            contentType: 'image/jpeg',
            upsert: true
          });
        
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: urlData } = supabaseService.supabase
          .storage
          .from('media')
          .getPublicUrl(fileName);
        
        results[platform] = urlData.publicUrl;
        
        // For Facebook, also update the article's social_image_url
        if (platform === 'facebook') {
          await supabaseService.supabase
            .from('articles')
            .update({ social_image_url: urlData.publicUrl })
            .eq('id', articleId);
        }
      } catch (platformError) {
        console.error(`Error generating ${platform} image:`, platformError);
        results[platform] = `Error: ${platformError.message}`;
      }
    }
    
    return res.status(200).json({
      success: true,
      data: {
        articleId,
        articleTitle: article.title,
        images: results
      }
    });
  } catch (error) {
    console.error('Error generating social images:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate a social media image directly from article data (no DB lookup)
 * This is useful for Airtable integration
 */
router.post('/generate-from-data', async (req, res) => {
  try {
    const { article, platform = 'facebook' } = req.body;
    
    if (!article || !article.title) {
      return res.status(400).json({
        success: false,
        error: 'Article data with title is required'
      });
    }
    
    console.log(`Generating ${platform} social media image for: ${article.title}`);
    
    // Generate the image for the specific platform
    const imageBuffer = platform.toLowerCase() === 'all' 
      ? await generateSocialImage(article) 
      : await generatePlatformImage(article, platform);
    
    // Create a unique identifier for the file
    const fileId = `direct-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const fileName = `social-images/${fileId}.jpg`;
    
    // Check if media bucket exists and create if needed
    try {
      const { data: buckets } = await supabaseService.supabase
        .storage
        .listBuckets();
        
      if (!buckets.find(b => b.name === 'media')) {
        await supabaseService.supabase
          .storage
          .createBucket('media', { public: true });
      }
    } catch (bucketError) {
      console.error('Error checking/creating bucket:', bucketError);
    }
    
    // Upload the image
    const { error: uploadError } = await supabaseService.supabase
      .storage
      .from('media')
      .upload(fileName, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (uploadError) {
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }
    
    // Get public URL
    const { data: urlData } = supabaseService.supabase
      .storage
      .from('media')
      .getPublicUrl(fileName);
    
    const imageUrl = urlData.publicUrl;
    
    return res.status(200).json({
      success: true,
      data: {
        imageUrl,
        articleTitle: article.title,
        platform
      }
    });
  } catch (error) {
    console.error('Error generating social image:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;