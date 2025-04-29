-- Add ltree extension for hierarchical data
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add new columns to sections table for hierarchy
ALTER TABLE sections 
ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS path ltree,
ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}';

-- Add index for faster hierarchical queries
CREATE INDEX IF NOT EXISTS sections_path_idx ON sections USING GIST (path);

-- Create function to maintain paths
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
DROP TRIGGER IF EXISTS sections_path_trigger ON sections;
CREATE TRIGGER sections_path_trigger
BEFORE INSERT OR UPDATE OF parent_id ON sections
FOR EACH ROW
EXECUTE FUNCTION update_section_path();

-- Create a new article_sections junction table for multiple sections per article
CREATE TABLE IF NOT EXISTS article_sections (
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, section_id)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_article_sections_section_id ON article_sections(section_id);
CREATE INDEX IF NOT EXISTS idx_article_sections_article_id ON article_sections(article_id);
CREATE INDEX IF NOT EXISTS idx_article_sections_is_primary ON article_sections(is_primary) WHERE is_primary = TRUE;

-- Create function to ensure only one primary section per article
CREATE OR REPLACE FUNCTION ensure_one_primary_section()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE article_sections SET is_primary = FALSE
    WHERE article_id = NEW.article_id AND section_id <> NEW.section_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for enforcing one primary section
DROP TRIGGER IF EXISTS trig_ensure_one_primary_section ON article_sections;
CREATE TRIGGER trig_ensure_one_primary_section
AFTER INSERT OR UPDATE OF is_primary ON article_sections
FOR EACH ROW
WHEN (NEW.is_primary = TRUE)
EXECUTE FUNCTION ensure_one_primary_section();

-- Migrate existing data from section_id column to the junction table if needed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM articles WHERE section_id IS NOT NULL) THEN
    INSERT INTO article_sections (article_id, section_id, is_primary)
    SELECT id, section_id, TRUE
    FROM articles
    WHERE section_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Create helper views for frontend consumption

-- Section hierarchy view with breadcrumbs
CREATE OR REPLACE VIEW section_hierarchy AS
WITH RECURSIVE section_tree AS (
  -- Root sections
  SELECT
    id,
    name,
    slug,
    parent_id,
    path,
    level,
    position,
    meta,
    ARRAY[id] AS breadcrumb_ids,
    ARRAY[name] AS breadcrumb_names,
    ARRAY[slug] AS breadcrumb_slugs
  FROM sections
  WHERE parent_id IS NULL
  
  UNION ALL
  
  -- Child sections
  SELECT
    s.id,
    s.name,
    s.slug,
    s.parent_id,
    s.path,
    s.level,
    s.position,
    s.meta,
    t.breadcrumb_ids || s.id,
    t.breadcrumb_names || s.name,
    t.breadcrumb_slugs || s.slug
  FROM sections s
  JOIN section_tree t ON s.parent_id = t.id
)
SELECT
  id,
  name,
  slug,
  parent_id,
  path,
  level,
  position,
  meta,
  breadcrumb_ids,
  breadcrumb_names,
  breadcrumb_slugs
FROM section_tree
ORDER BY path;

-- Article with sections view for easy querying
CREATE OR REPLACE VIEW article_with_sections AS
SELECT
  a.*,
  s.id AS section_id,
  s.name AS section_name,
  s.slug AS section_slug,
  s.parent_id AS section_parent_id,
  s.level AS section_level,
  as_junction.is_primary
FROM
  articles a
JOIN
  article_sections as_junction ON a.id = as_junction.article_id
JOIN
  sections s ON as_junction.section_id = s.id;

-- Create helper functions

-- Function to get direct child sections
CREATE OR REPLACE FUNCTION get_child_sections(parent_section_id TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  slug TEXT,
  level INTEGER,
  position INTEGER,
  meta JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.level, s.position, s.meta
  FROM sections s
  WHERE s.parent_id = parent_section_id
  ORDER BY s.position;
END;
$$ LANGUAGE plpgsql;

-- Function to get all descendant sections
CREATE OR REPLACE FUNCTION get_descendant_sections(parent_section_id TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  slug TEXT,
  parent_id TEXT,
  level INTEGER,
  position INTEGER,
  meta JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.slug, s.parent_id, s.level, s.position, s.meta
  FROM sections s
  WHERE s.path <@ (SELECT path FROM sections WHERE id = parent_section_id)
    AND s.id <> parent_section_id
  ORDER BY s.path, s.position;
END;
$$ LANGUAGE plpgsql;

-- Function to get section breadcrumb
CREATE OR REPLACE FUNCTION get_section_breadcrumb(section_id TEXT)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  slug TEXT,
  level INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE breadcrumb AS (
    -- Start with the target section
    SELECT s.id, s.name, s.slug, s.parent_id, s.level
    FROM sections s
    WHERE s.id = section_id
    
    UNION ALL
    
    -- Add parent sections
    SELECT s.id, s.name, s.slug, s.parent_id, s.level
    FROM sections s
    JOIN breadcrumb b ON s.id = b.parent_id
  )
  SELECT id, name, slug, level
  FROM breadcrumb
  ORDER BY level;
END;
$$ LANGUAGE plpgsql;