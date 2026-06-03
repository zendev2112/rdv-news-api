import { createClient } from '@supabase/supabase-js'

// ── Homepage block config ─────────────────────────────────────────────
// `front` is the component name string the frontend queries by
// (utils/api.ts → fetchSectionArticles). `slots` is the number of articles
// the component actually RENDERS — the count passed to sortArticlesForSlots()
// inside each <Name>Section.tsx — which is what the board measures against.
// Note: the homepage over-fetches (page.tsx limit) but only `slots` are
// visible, so `slots` is the true target. Order follows homepage render order.
const BLOCKS = [
  { front: 'PrincipalSection', label: 'Principal', slots: 6 },
  { front: 'NoticiasImportantesSection', label: 'Noticias Importantes', slots: 4 },
  { front: 'PueblosAlemanesSection', label: 'Pueblos Alemanes', slots: 4 },
  { front: 'HuanguelenSection', label: 'Huanguelén', slots: 3 },
  { front: 'LaSextaSection', label: 'La Sexta', slots: 8 },
  { front: 'ActualidadSection', label: 'Actualidad', slots: 13 },
  { front: 'PoliticaYEconomiaSection', label: 'Política y Economía', slots: 8 },
  { front: 'DeportesSection', label: 'Deportes', slots: 5 },
  { front: 'MundoSection', label: 'Mundo', slots: 4 },
  { front: 'MasNoticiasSection', label: 'Más Noticias', slots: 12 },
  { front: 'AgroSection', label: 'Agro', slots: 4 },
  { front: 'EnFocoSection', label: 'En Foco', slots: 8 },
  { front: 'RecetasSection', label: 'Recetas', slots: 3 },
  { front: 'TendenciasSection', label: 'Tendencias', slots: 3 },
  { front: 'IActualidadSection', label: 'IActualidad', slots: 4 },
  { front: 'TechSection', label: 'Tech', slots: 3 },
  { front: 'EspectaculosSection', label: 'Espectáculos', slots: 3 },
  { front: 'InversionesSection', label: 'Inversiones', slots: 2 },
  { front: 'PymesYEmprendimientosSection', label: 'Pymes y Emprendimientos', slots: 2 },
  { front: 'LifestyleSection', label: 'Lifestyle', slots: 4 },
  { front: 'BienestarSection', label: 'Bienestar', slots: 5 },
  { front: 'EstrenosSection', label: 'Estrenos', slots: 3 },
  // Currently commented out on the homepage — kept hidden for reference.
  { front: 'PropiedadesSection', label: 'Propiedades', slots: 4, hidden: true },
]

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN
const VIEW = 'article_with_sections'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

async function blockCoverage({ front, label, slots, hidden }) {
  // Same query the frontend runs, capped at the component's real slot count,
  // plus an exact count of the full published pool for backlog context.
  const { data, count, error } = await supabase
    .from(VIEW)
    .select('title, slug, created_at', { count: 'exact' })
    .eq('front', front)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(slots)

  if (error) {
    return { front, label, slots, hidden: !!hidden, error: error.message }
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
    slots,
    hidden: !!hidden,
    pool: count ?? rows.length, // total published articles tagged to this block
    filled: Math.min(count ?? rows.length, slots), // slots actually occupied
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
