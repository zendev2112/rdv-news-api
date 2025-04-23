-- Update articles table for new Primera Plana structure
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS overline TEXT,
ADD COLUMN IF NOT EXISTS excerpt TEXT,
ADD COLUMN IF NOT EXISTS url TEXT,
ADD COLUMN IF NOT EXISTS article_images JSONB,
ADD COLUMN IF NOT EXISTS instagram_post TEXT,
ADD COLUMN IF NOT EXISTS facebook_post TEXT,
ADD COLUMN IF NOT EXISTS twitter_post TEXT,
ADD COLUMN IF NOT EXISTS youtube_video TEXT,
ADD COLUMN IF NOT EXISTS airtable_id TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Add index on airtable_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_articles_airtable_id ON articles(airtable_id);

-- Add index on status for filtering published/draft
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);

-- Comment on columns
COMMENT ON COLUMN articles.overline IS 'Short text appearing above the title';
COMMENT ON COLUMN articles.excerpt IS 'Brief summary of the article';
COMMENT ON COLUMN articles.url IS 'Original source URL if applicable';
COMMENT ON COLUMN articles.article_images IS 'Additional images scraped from article';
COMMENT ON COLUMN articles.instagram_post IS 'Instagram post embed code';
COMMENT ON COLUMN articles.facebook_post IS 'Facebook post embed code';
COMMENT ON COLUMN articles.twitter_post IS 'Twitter post embed code';
COMMENT ON COLUMN articles.youtube_video IS 'YouTube video embed code';
COMMENT ON COLUMN articles.airtable_id IS 'Reference to original Airtable record ID';
COMMENT ON COLUMN articles.status IS 'Publication status: published or draft';