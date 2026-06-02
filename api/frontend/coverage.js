import { createClient } from '@supabase/supabase-js'

// ── Homepage block config ─────────────────────────────────────────────
// Mirrors exactly how the frontend homepage fills each block:
//   utils/api.ts → fetchSectionArticles(front, limit)
//   .from('article_with_sections').eq('front', <front>).eq('status','published')
//   .order('created_at', { ascending: false }).limit(<limit>)
// `front` is the component name string; `limit` is the target count passed
// in app/page.tsx. Order below follows the homepage render order.
const BLOCKS = [
  { front: 'PrincipalSection', label: 'Principal', limit: 10 },
  { front: 'NoticiasImportantesSection', label: 'Noticias Importantes', limit: 10 },
  { front: 'PueblosAlemanesSection', label: 'Pueblos Alemanes', limit: 10 },
  { front: 'HuanguelenSection', label: 'Huanguelén', limit: 10 },
  { front: 'LaSextaSection', label: 'La Sexta', limit: 8 },
  { front: 'ActualidadSection', label: 'Actualidad', limit: 13 },
  { front: 'PoliticaYEconomiaSection', label: 'Política y Economía', limit: 10 },
  { front: 'DeportesSection', label: 'Deportes', limit: 5 },
  { front: 'MundoSection', label: 'Mundo', limit: 10 },
  { front: 'MasNoticiasSection', label: 'Más Noticias', limit: 12 },
  { front: 'AgroSection', label: 'Agro', limit: 10 },
  { front: 'EnFocoSection', label: 'En Foco', limit: 8 },
  { front: 'RecetasSection', label: 'Recetas', limit: 10 },
  { front: 'TendenciasSection', label: 'Tendencias', limit: 10 },
  { front: 'IActualidadSection', label: 'IActualidad', limit: 4 },
  { front: 'TechSection', label: 'Tech', limit: 10 },
  { front: 'EspectaculosSection', label: 'Espectáculos', limit: 10 },
  { front: 'InversionesSection', label: 'Inversiones', limit: 2 },
  { front: 'PymesYEmprendimientosSection', label: 'Pymes y Emprendimientos', limit: 2 },
  { front: 'LifestyleSection', label: 'Lifestyle', limit: 10 },
  { front: 'BienestarSection', label: 'Bienestar', limit: 5 },
  { front: 'EstrenosSection', label: 'Estrenos', limit: 10 },
  // Currently commented out on the homepage — kept hidden for reference.
  { front: 'PropiedadesSection', label: 'Propiedades', limit: 4, hidden: true },
]

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN
const VIEW = 'article_with_sections'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

async function blockCoverage({ front, label, limit, hidden }) {
  // Same query the frontend runs, plus an exact count of the full pool.
  const { data, count, error } = await supabase
    .from(VIEW)
    .select('title, slug, created_at', { count: 'exact' })
    .eq('front', front)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { front, label, limit, hidden: !!hidden, error: error.message }
  }

  const rows = data || []
  const now = Date.now()
  const ageHours = (ts) =>
    ts ? Math.round((now - new Date(ts).getTime()) / 36e5) : null

  const newest = rows[0]?.created_at || null
  const oldestVisible = rows.length ? rows[rows.length - 1].created_at : null
  const last24h = rows.filter(
    (r) => now - new Date(r.created_at).getTime() < 24 * 36e5,
  ).length

  return {
    front,
    label,
    limit,
    hidden: !!hidden,
    pool: count ?? rows.length, // total published articles tagged to this block
    visible: rows.length, // how many the homepage actually shows
    filled: Math.min(count ?? rows.length, limit),
    newestAgeHours: ageHours(newest),
    oldestVisibleAgeHours: ageHours(oldestVisible),
    last24h,
    items: rows.map((r) => ({
      title: r.title,
      slug: r.slug,
      ageHours: ageHours(r.created_at),
    })),
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const blocks = await Promise.all(BLOCKS.map(blockCoverage))
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      blocks,
    })
  } catch (error) {
    console.error('coverage error:', error)
    return res.status(500).json({ error: error.message })
  }
}
