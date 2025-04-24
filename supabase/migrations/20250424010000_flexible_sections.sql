-- Remove the restrictive check constraint first
ALTER TABLE articles 
    DROP CONSTRAINT IF EXISTS articles_section_check;

-- Create a more flexible sections table if it doesn't already exist
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add function for updated_at if it doesn't exist
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for sections table
DROP TRIGGER IF EXISTS set_sections_updated_at ON sections;
CREATE TRIGGER set_sections_updated_at
BEFORE UPDATE ON sections
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- Insert the sections you need, including both current and future ones
INSERT INTO sections (id, name, display_order)
VALUES 
    ('primera-plana', 'Primera Plana', 1),
    ('politica', 'Política', 2),
    ('economia', 'Economía', 3),
    ('agro', 'Agro', 4),
    ('deportes', 'Deportes', 5),
    ('lifestyle', 'Lifestyle', 6),
    ('turismo', 'Turismo', 7)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_order = EXCLUDED.display_order;

-- Skip adding section_id column as it already exists
-- Instead just update foreign key constraint if needed

-- Add foreign key constraint (but drop it first if it exists)
ALTER TABLE articles
    DROP CONSTRAINT IF EXISTS fk_articles_section_id;

ALTER TABLE articles
    ADD CONSTRAINT fk_articles_section_id
    FOREIGN KEY (section_id)
    REFERENCES sections(id)
    ON DELETE SET NULL;

-- Create a function to update section_id based on the section text value
CREATE OR REPLACE FUNCTION set_section_id()
RETURNS TRIGGER AS $$
BEGIN
    -- If section is provided but section_id is not, try to set section_id
    IF NEW.section IS NOT NULL AND NEW.section_id IS NULL THEN
        -- Try to find matching section id (case insensitive)
        SELECT id INTO NEW.section_id
        FROM sections
        WHERE LOWER(id) = LOWER(NEW.section)
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to set section_id before insert/update
DROP TRIGGER IF EXISTS set_article_section_id ON articles;
CREATE TRIGGER set_article_section_id
BEFORE INSERT OR UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION set_section_id();

-- Update existing records to set section_id based on section
UPDATE articles
SET section_id = (
    SELECT id FROM sections WHERE LOWER(id) = LOWER(articles.section) LIMIT 1
)
WHERE section IS NOT NULL AND section_id IS NULL;