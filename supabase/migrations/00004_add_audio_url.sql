-- Add audio_url column to articles table (nullable, for Primera Plana audio embeds)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS audio_url TEXT;
