-- First reset the path values for existing sections
UPDATE sections SET path = NULL;

-- Then insert/update the main top-level sections
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('primera-plana', 'Primera Plana', 1, 'primera-plana', NULL),
    ('coronel-suarez', 'Coronel Suárez', 2, 'coronel-suarez', NULL),
    ('pueblos-alemanes', 'Pueblos Alemanes', 3, 'pueblos-alemanes', NULL),
    ('huanguelen', 'Huanguelén', 4, 'huanguelen', NULL),
    ('la-sexta', 'La Sexta', 5, 'la-sexta', NULL),
    ('politica', 'Política', 6, 'politica', NULL),
    ('economia', 'Economía', 7, 'economia', NULL),
    ('agro', 'Agro', 8, 'agro', NULL),
    ('sociedad', 'Sociedad', 9, 'sociedad', NULL),
    ('salud', 'Salud', 10, 'salud', NULL),
    ('cultura', 'Cultura', 11, 'cultura', NULL),
    ('opinion', 'Opinión', 12, 'opinion', NULL),
    ('deportes', 'Deportes', 13, 'deportes', NULL),
    ('lifestyle', 'Lifestyle', 14, 'lifestyle', NULL),
    ('vinos', 'Vinos', 15, 'vinos', NULL),
    ('el-recetario', 'El Recetario', 16, 'el-recetario', NULL)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Now insert the child sections for Pueblos Alemanes
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('santa-trinidad', 'Santa Trinidad', 1, 'santa-trinidad', 'pueblos-alemanes'),
    ('san-jose', 'San José', 2, 'san-jose', 'pueblos-alemanes'),
    ('santa-maria', 'Santa María', 3, 'santa-maria', 'pueblos-alemanes')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Child sections for Economia
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('actualidad', 'Actualidad', 1, 'actualidad', 'economia'),
    ('dolar', 'Dólar', 2, 'dolar', 'economia'),
    ('propiedades', 'Propiedades', 3, 'propiedades', 'economia'),
    ('pymes-emprendimientos', 'Pymes y Emprendimientos', 4, 'pymes-emprendimientos', 'economia')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Pymes y Emprendimientos subsections 
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('inmuebles', 'Inmuebles', 1, 'inmuebles', 'pymes-emprendimientos'),
    ('campos', 'Campos', 2, 'campos', 'pymes-emprendimientos'),
    ('construccion-diseno', 'Construcción y Diseño', 3, 'construccion-diseno', 'pymes-emprendimientos')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Agro subsections
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('agricultura', 'Agricultura', 1, 'agricultura', 'agro'),
    ('ganaderia', 'Ganadería', 2, 'ganaderia', 'agro'),
    ('tecnologias-agro', 'Tecnologías', 3, 'tecnologias-agro', 'agro')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Sociedad subsections
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('educacion', 'Educación', 1, 'educacion', 'sociedad'),
    ('policiales', 'Policiales', 2, 'policiales', 'sociedad'),
    ('efemerides', 'Efemérides', 3, 'efemerides', 'sociedad'),
    ('ciencia', 'Ciencia', 4, 'ciencia', 'sociedad')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Salud subsections
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('vida-armonia', 'Vida en Armonía', 1, 'vida-armonia', 'salud'),
    ('nutricion-energia', 'Nutrición y energía', 2, 'nutricion-energia', 'salud'),
    ('fitness', 'Fitness', 3, 'fitness', 'salud'),
    ('salud-mental', 'Salud mental', 4, 'salud-mental', 'salud')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Lifestyle subsections
INSERT INTO sections (id, name, position, slug, parent_id) 
VALUES 
    ('turismo', 'Turismo', 1, 'turismo', 'lifestyle'),
    ('horoscopo', 'Horóscopo', 2, 'horoscopo', 'lifestyle'),
    ('feriados', 'Feriados', 3, 'feriados', 'lifestyle'),
    ('loterias-quinielas', 'Loterías y Quinielas', 4, 'loterias-quinielas', 'lifestyle'),
    ('moda-belleza', 'Moda y Belleza', 5, 'moda-belleza', 'lifestyle'),
    ('mascotas', 'Mascotas', 6, 'mascotas', 'lifestyle')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    position = EXCLUDED.position,
    slug = EXCLUDED.slug,
    parent_id = EXCLUDED.parent_id;

-- Force update of paths
UPDATE sections SET parent_id = parent_id WHERE parent_id IS NOT NULL;
UPDATE sections SET parent_id = NULL WHERE parent_id IS NULL;