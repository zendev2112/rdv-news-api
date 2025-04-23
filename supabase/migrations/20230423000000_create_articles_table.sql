-- Migration file for creating the articles table

-- Create articles table to store all articles from all sections
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY, -- Changed from NUMERIC to TEXT to match Airtable record ID format
    title TEXT NOT NULL,
    overline TEXT,
    excerpt TEXT,
    article TEXT,
    url TEXT,
    source TEXT,
    image JSONB, -- For storing attachment metadata
    img_url TEXT, -- Renamed from imgUrl for SQL naming convention
    article_images TEXT, -- Renamed from article-images for SQL naming convention
    ig_post TEXT, -- Renamed from ig-post for SQL naming convention
    fb_post TEXT, -- Renamed from fb-post for SQL naming convention
    tw_post TEXT, -- Renamed from tw-post for SQL naming convention
    yt_video TEXT, -- Renamed from yt-video for SQL naming convention
    status TEXT CHECK (status IN ('draft', 'published')),
    section TEXT CHECK (section IN ('Politica', 'Economia', 'Agro')), -- Categories from Airtable dropdown
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster querying by section
CREATE INDEX idx_articles_section ON articles(section);

-- Create index for faster querying by status
CREATE INDEX idx_articles_status ON articles(status);

-- Add function to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function whenever a record is updated
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
