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

-- Articles with their sections view
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

-- Function to get child sections
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

-- Function to get descendant sections
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

-- Function to get articles in a section and optionally its descendants
CREATE OR REPLACE FUNCTION get_section_articles(
  section_id TEXT,
  include_descendants BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  slug TEXT,
  excerpt TEXT,
  status TEXT,
  featured BOOLEAN,
  published_at TIMESTAMPTZ,
  section_id TEXT,
  section_name TEXT,
  section_slug TEXT,
  is_primary BOOLEAN
) AS $$
DECLARE
  section_ids TEXT[];
BEGIN
  -- Start with the requested section ID
  section_ids := ARRAY[section_id];
  
  -- Add descendant section IDs if requested
  IF include_descendants THEN
    section_ids := section_ids || ARRAY(
      SELECT id FROM get_descendant_sections(section_id)
    );
  END IF;
  
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.slug,
    a.excerpt,
    a.status,
    a.featured,
    a.published_at,
    s.id,
    s.name,
    s.slug,
    as_junction.is_primary
  FROM
    articles a
  JOIN
    article_sections as_junction ON a.id = as_junction.article_id
  JOIN
    sections s ON as_junction.section_id = s.id
  WHERE
    s.id = ANY(section_ids)
    AND a.status = 'published'
  ORDER BY
    a.published_at DESC, a.id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to count articles in a section and optionally its descendants
CREATE OR REPLACE FUNCTION count_section_articles(
  section_id TEXT,
  include_descendants BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER AS $$
DECLARE
  article_count INTEGER;
  section_ids TEXT[];
BEGIN
  -- Start with the requested section ID
  section_ids := ARRAY[section_id];
  
  -- Add descendant section IDs if requested
  IF include_descendants THEN
    section_ids := section_ids || ARRAY(
      SELECT id FROM get_descendant_sections(section_id)
    );
  END IF;
  
  SELECT COUNT(DISTINCT a.id)
  INTO article_count
  FROM
    articles a
  JOIN
    article_sections as_junction ON a.id = as_junction.article_id
  WHERE
    as_junction.section_id = ANY(section_ids)
    AND a.status = 'published';
    
  RETURN article_count;
END;
$$ LANGUAGE plpgsql;