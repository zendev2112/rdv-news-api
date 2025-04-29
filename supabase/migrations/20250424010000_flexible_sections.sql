-- First, verify and drop the known constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'articles_section_check'
    ) THEN
        -- Remove the restrictive check constraint
        ALTER TABLE articles 
            DROP CONSTRAINT articles_section_check;
    END IF;
END $$;

-- Check for any other constraints on the section column
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    -- Output all constraints on articles table
    RAISE NOTICE 'Checking for additional section constraints...';
    
    FOR constraint_rec IN 
        SELECT conname as constraint_name
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = t.oid
        WHERE t.relname = 'articles'
        AND a.attname = 'section'
        AND c.contype = 'c'  -- 'c' is for check constraint
    LOOP
        EXECUTE 'ALTER TABLE articles DROP CONSTRAINT IF EXISTS ' || constraint_rec.constraint_name;
        RAISE NOTICE 'Dropped constraint: %', constraint_rec.constraint_name;
    END LOOP;
END $$;

-- Create a more flexible sections table if it doesn't already exist
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0, -- Changed from display_order to position
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    slug TEXT DEFAULT NULL -- Make slug nullable in this table or set a default
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
INSERT INTO sections (id, name, position, slug) -- Added slug column
VALUES 
    ('primera-plana', 'Primera Plana', 1, 'primera-plana'),
    ('politica', 'Política', 2, 'politica'),
    ('economia', 'Economía', 3, 'economia'),
    ('agro', 'Agro', 4, 'agro'),
    ('deportes', 'Deportes', 5, 'deportes'),
    ('lifestyle', 'Lifestyle', 6, 'lifestyle'),
    ('turismo', 'Turismo', 7, 'turismo'),
    ('espectaculos', 'Espectaculos', 7, 'espectaculos'),
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug; -- Added slug to update clause

-- Skip adding section_id column as it already exists
-- Instead just update foreign key constraint if needed

-- First drop any existing foreign key constraints on section_id
ALTER TABLE articles
    DROP CONSTRAINT IF EXISTS fk_articles_section_id;

-- Add the foreign key constraint
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