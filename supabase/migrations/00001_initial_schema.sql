-- Create extensions
CREATE EXTENSION IF NOT EXISTS ltree;

-- Create sections table with hierarchical structure
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  position INTEGER DEFAULT 0,
  parent_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  path ltree,
  level INTEGER DEFAULT 0,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create articles table
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  excerpt TEXT,
  content TEXT,
  status TEXT CHECK (status = ANY (ARRAY['draft', 'published'])) DEFAULT 'draft',
  featured BOOLEAN DEFAULT false,
  image_url TEXT,
  published_at TIMESTAMPTZ,
  airtable_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create junction table for article-section relationship
CREATE TABLE IF NOT EXISTS article_sections (
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (article_id, section_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS sections_path_idx ON sections USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_article_sections_section_id ON article_sections(section_id);
CREATE INDEX IF NOT EXISTS idx_article_sections_article_id ON article_sections(article_id);
CREATE INDEX IF NOT EXISTS idx_article_sections_is_primary ON article_sections(is_primary) WHERE is_primary = TRUE;

-- Create function for updating modified timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add update timestamp triggers
CREATE TRIGGER set_sections_updated_at
BEFORE UPDATE ON sections
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER set_articles_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- Create function to maintain section paths
CREATE OR REPLACE FUNCTION update_section_path()
RETURNS TRIGGER AS $$
DECLARE
  parent_path ltree;
BEGIN
  IF NEW.parent_id IS NULL THEN
    -- Root level section
    NEW.path = text2ltree(NEW.id::text);
    NEW.level = 0;
  ELSE
    -- Child section, get parent's path and append this section
    SELECT path INTO parent_path FROM sections WHERE id = NEW.parent_id;
    IF parent_path IS NULL THEN
      NEW.path = text2ltree(NEW.id::text);
      NEW.level = 0;
    ELSE
      NEW.path = parent_path || text2ltree(NEW.id::text);
      NEW.level = nlevel(NEW.path) - 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for path maintenance
CREATE TRIGGER sections_path_trigger
BEFORE INSERT OR UPDATE OF parent_id ON sections
FOR EACH ROW
EXECUTE FUNCTION update_section_path();

-- Create function to ensure only one primary section per article
CREATE OR REPLACE FUNCTION ensure_one_primary_section()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE article_sections 
    SET is_primary = FALSE
    WHERE article_id = NEW.article_id AND section_id <> NEW.section_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for enforcing one primary section
CREATE TRIGGER trig_ensure_one_primary_section
AFTER INSERT OR UPDATE OF is_primary ON article_sections
FOR EACH ROW
WHEN (NEW.is_primary = TRUE)
EXECUTE FUNCTION ensure_one_primary_section();