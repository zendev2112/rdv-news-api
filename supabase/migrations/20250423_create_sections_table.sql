-- Create sections table to store all section definitions
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT, -- For UI theming/categorization
    icon TEXT, -- For UI display
    position INTEGER, -- For ordering sections in navigation
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster querying by slug
CREATE INDEX IF NOT EXISTS idx_sections_slug ON sections(slug);

-- Create index for active sections
CREATE INDEX IF NOT EXISTS idx_sections_active ON sections(is_active);

-- Add foreign key to articles table pointing to sections
ALTER TABLE articles 
ADD COLUMN section_id TEXT REFERENCES sections(id);

-- Update the trigger for the sections table
CREATE OR REPLACE FUNCTION update_sections_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update the timestamp when a section is modified
CREATE TRIGGER set_sections_updated_at
BEFORE UPDATE ON sections
FOR EACH ROW
EXECUTE FUNCTION update_sections_modified_column();

-- Insert default sections based on our current dropdown options
INSERT INTO sections (id, name, slug, description, position)
VALUES 
    ('politica', 'Política', 'politica', 'Noticias sobre política nacional e internacional', 1),
    ('economia', 'Economía', 'economia', 'Noticias sobre economía y finanzas', 2),
    ('agro', 'Agro', 'agro', 'Noticias sobre agricultura y ganadería', 3)
ON CONFLICT (id) DO NOTHING;

-- Create a function to migrate existing articles to use the section_id
CREATE OR REPLACE FUNCTION migrate_section_to_section_id() RETURNS void AS $$
BEGIN
    -- Update articles where section is 'Politica'
    UPDATE articles SET section_id = 'politica' WHERE section = 'Politica' AND section_id IS NULL;
    
    -- Update articles where section is 'Economia'
    UPDATE articles SET section_id = 'economia' WHERE section = 'Economia' AND section_id IS NULL;
    
    -- Update articles where section is 'Agro'
    UPDATE articles SET section_id = 'agro' WHERE section = 'Agro' AND section_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Execute the migration function
SELECT migrate_section_to_section_id();

-- Drop the migration function after use
DROP FUNCTION migrate_section_to_section_id();