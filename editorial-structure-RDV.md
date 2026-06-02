## **Overview: Two Publishing Layers**

**Layer 1 — Manual/Curated** (your bottleneck, requires editorial attention): Coronel Suárez, Pueblos Alemanes, La Sexta, Huanguelén

**Layer 2 — Semi-automated** (editorial line is defined, articles are created/selected in Airtable, publishing can be scheduled): Everything else

---

## **Total Daily Volume**

| Period | Articles/day |
| :---- | :---- |
| Weekday | \~100–115 |
| Weekend | \~50–55 |

---

## **Airtable → Supabase → Frontend Mapping**

| Airtable Table | Supabase Section | Frontend Section |
| :---- | :---- | :---- |
| Primera Plana, Instituciones, Local, Local Facebook | Coronel Suárez / Actualidad | PrincipalSection, NoticiasImportantes, ActualidadSection |
| Pueblos Alemanes, Instituciones, Local | Pueblos Alemanes (+ subsections) | PueblosAlemanesSection |
| Huanguelen | Huanguelén | HuanguelenSection |
| La Sexta | La Sexta | LaSextaSection |
| Primera Plana, Politica, Economia | Política / Economía | PoliticaYEconomiaSection, TendenciasSection |
| Deportes, Deporte Local y Regional | Deportes | DeportesSection |
| Mundo | Mundo | MundoSection |
| Quiniela, Horoscopo, Efemerides, Turismo, Vinos, Autos | Lifestyle subsections | MasNoticiasSection |
| Agro | Agro | AgroSection |
| Historia y Literatura, Cine y Series, Cultura, Espectaculos | Cultura / Espectáculos | EnFocoSection |
| Recetas, Lifestyle, Salud | El Recetario / Salud / Lifestyle | RecetasSection |
| Espectaculos, Primera Plana | Espectáculos / Actualidad | TendenciasSection |
| Tecnologia | Economía/Tecnología | TechSection, IActualidadSection |
| Espectaculos | Espectáculos | EspectaculosSection |
| Economia (Dólar) | Economía/Dólar | PoliticaYEconomiaSection (mandatory daily) |
| Lifestyle, Turismo, Salud, Horoscopo, Vinos | Lifestyle / Salud | LifestyleSection |
| Salud | Salud | BienestarSection |
| Cine y Series, Espectaculos | Cultura / Espectáculos | EstrenosSection |
|  |  |  |
| Pymes | Pymes y Emprendimientos | PymesSection |
| Economia | Economía | InversionesSection |

---

## **Proposed Daily Schedule (Weekday)**

### **🌅 Morning Batch — 6:30–8:00am (Priority: Local \+ Hard News)**

*Goal: Homepage is fresh and complete when most users arrive*

| Task | Articles | Source |
| :---- | :---- | :---- |
| Coronel Suárez (Principal \+ Noticias) — **first rotation** | 8 | Instituciones, Local, Local FB, Primera Plana |
| Pueblos Alemanes — first batch | 4 | Pueblos Alemanes, Instituciones, Local |
| Huanguelén | 3 | Huanguelén |
| La Sexta — first batch | 5–6 | La Sexta |
| **Dollar article** (mandatory) | 1 | Economía/Dólar |
| Mundo | 3 | Mundo |
| Deportes | 3 | Deportes, Deporte Local y Regional |

**Total: \~27–28 articles**

---

### **☀️ Midday Batch — 12:00–1:00pm (Priority: Rotation \+ National)**

*Goal: Refresh main sections, fill national/political content*

| Task | Articles | Source |
| :---- | :---- | :---- |
| Coronel Suárez — **second rotation** | 8 | Primera Plana, Local |
| La Sexta — second batch | 5–6 | La Sexta |
| Pueblos Alemanes — second batch | 4 | Pueblos Alemanes, Instituciones |
| Actualidad | 7 | Primera Plana \+ Coronel Suárez overflow |
| Política y Economía (minus dollar) | 7 | Política, Economía, Primera Plana |
| Más Noticias — first batch | 6 | Quiniela, Horóscopo, Efemérides, Turismo |
| Mundo — second push | 1–3 | Mundo |

**Total: \~38–41 articles**

---

### **🌆 Afternoon Batch — 4:30–6:00pm (Priority: Lifestyle, Culture, Sports close)**

*Goal: Entertainment, soft news, sports results*

| Task | Articles | Source |
| :---- | :---- | :---- |
| Actualidad — second push | 6 | Primera Plana overflow |
| Más Noticias — second batch | 6 | Vinos, Autos, Efemérides |
| Deportes — second push | 2–4 | Deportes \+ local |
| En Foco | 4 | Historia y Literatura, Cine y Series, Cultura, Espectáculos |
| Espectáculos | 3 | Espectáculos |
| Estrenos | 2–3 | Cine y Series, Espectáculos |
| Lifestyle | 4 | Lifestyle, Turismo, Horóscopo, Vinos |
| Bienestar | 2 | Salud |
| Tendencias | 3 | Espectáculos, Primera Plana |
| Tech | 2 | Tecnología |
| IActualidad | 2 | Tecnología |
| Agro | 4 | Agro |
| Recetas | 2–3 | Recetas, Lifestyle, Salud |
| Pymes | 1 | Pymes |
| Inversiones *(every other day)* | 0–1 | Economía |
|  |  |  |

**Total: \~46–50 articles**

---

## **Weekend: Half Production**

On Sat/Sun, only the **morning batch** runs, scaled down:

| Section | Weekend articles |
| :---- | :---- |
| Principal \+ Noticias | 4–5 (one rotation only) |
| Pueblos Alemanes | 2 |
| Huanguelén | 1–2 |
| La Sexta | 4–5 |
| Dollar article | 1 (mandatory) |
| Actualidad | 4–5 |
| Deportes | 2–3 |
| Mundo | 2 |
| Más Noticias | 4 |
| Everything else | 0 or 1 at most |

**Skip on weekends:** IActualidad, Tech, Pymes, Inversiones, Política y Economía (except dollar)

---

## **Key Structural Decisions to Make**

**1\. How does the cron know what to publish?** Two models:

- **Pull model**: Cron queries Airtable for articles marked "ready to publish" in a status field → pushes to Supabase  
- **Push model**: You or editors mark articles in Airtable → a webhook or scheduled job picks them up

The pull model is more automatable. Each Airtable table would need a Status field (Draft → Ready → Published).

**2\. Section assignment** Articles need a section field in Supabase that maps to the frontend section name (e.g. PrincipalSection, ActualidadSection). Some articles can appear in multiple sections (e.g., a Coronel Suárez article in both PrincipalSection and ActualidadSection).

**3\. Article rotation** The frontend sections fetch the N most recent articles by created\_at or an order field. So "rotation" \= publishing new articles, which naturally pushes old ones out of view.

**4\. The dollar article** This is a daily recurring item. It should be semi-automated: fetch the exchange rate, generate a standard-format article, auto-publish to Economía/Dólar and assign it to PoliticaYEconomiaSection. This already seems to exist in your system.

---

## **Suggested Next Steps (in order)**

1. **Define the Airtable Status field** convention across all tables (Borrador / Listo / Publicado)  
2. **Define the cron job architecture**: a single Next.js API route or a separate Node.js service that runs at 6:30am / 12:00pm / 4:30pm  
3. **Build the section-to-schedule mapping** as a config object (which sections publish at which time slot)  
4. **Weekend flag logic**: detect if new Date().getDay() is 0 or 6, switch to weekend config  
5. **Build the Airtable → Supabase pipeline** per table

When you're ready to start implementing, I'd suggest starting with the cron config/schedule structure and the Airtable pull logic. Let me know.

rdv\_live\_9k3mf8n2p4q7r1s5t6u8v0w2x4y6z8

