-- Add missing fields from Airtable to articles table
ALTER TABLE articles
-- Add source field to store the name of the source (e.g., "Infobae", "Clarín")
ADD COLUMN IF NOT EXISTS source TEXT,

-- Add source_url field to store the original article URL
ADD COLUMN IF NOT EXISTS source_url TEXT,

-- Convert article_images from TEXT to JSONB if it's not already
ALTER COLUMN article_images TYPE JSONB USING 
  CASE 
    WHEN article_images IS NULL THEN '[]'::jsonb
    WHEN article_images::text = '' THEN '[]'::jsonb
    ELSE 
      CASE 
        -- If it's already valid JSON, cast directly
        WHEN article_images::text ~ '^\\[.*\\]$' THEN article_images::jsonb 
        -- Otherwise, convert comma-separated string to JSON array
        ELSE (SELECT jsonb_agg(trim(value)) FROM regexp_split_to_table(article_images::text, ',') AS value) 
      END
  END,

-- Add social_media field to store all social media links as JSON
ADD COLUMN IF NOT EXISTS social_media JSONB DEFAULT '{}'::jsonb;

-- Create index on source for better query performance
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);

-- Add comment to fields
COMMENT ON COLUMN articles.source IS 'Original source of the article (e.g. Infobae, Clarín)';
COMMENT ON COLUMN articles.source_url IS 'URL of the original article';
COMMENT ON COLUMN articles.social_media IS 'JSON object containing social media post IDs and links';