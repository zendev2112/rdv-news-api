-- Create articles table
CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  airtable_id TEXT UNIQUE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  header TEXT,
  section_id TEXT NOT NULL,
  section_name TEXT,
  section_color TEXT,
  image_url TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',
  social_media JSONB
);

-- Add indexes for better performance
CREATE INDEX idx_articles_slug ON articles(slug);
CREATE INDEX idx_articles_section ON articles(section_id);
CREATE INDEX idx_articles_published ON articles(status, published_at);

-- Create sections table
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  priority INTEGER DEFAULT 99,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS but with permissive policies for now
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON articles;

-- Add policies allowing all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" 
ON articles FOR ALL 
TO authenticated 
USING (true);

CREATE POLICY "Allow all operations for authenticated users" 
ON sections FOR ALL 
TO authenticated 
USING (true);

-- Add policies for public read access
CREATE POLICY "Allow public to read published articles" 
ON articles FOR SELECT 
TO anon 
USING (status = 'published');

CREATE POLICY "Allow public to read sections" 
ON sections FOR SELECT 
TO anon 
USING (true);

-- Create a policy that allows inserts from your API
CREATE POLICY "Allow insert and update operations for articles" 
ON articles 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_articles_modtime
BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_sections_modtime
BEFORE UPDATE ON sections
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Add some initial sections
INSERT INTO sections (id, name, color, priority) VALUES
('primera-plana', 'Primera Plana', '#e63946', 10),
('agro', 'Agro', '#1d3557', 20),
('economia', 'Economía', '#2a9d8f', 30),
('deportes', 'Deportes', '#f77f00', 40),
('lifestyle', 'Lifestyle', '#9c6644', 50);