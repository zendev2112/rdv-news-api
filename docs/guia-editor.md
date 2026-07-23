# Guía del Editor — Radio del Volga

Spec de uso del panel editorial (admin / News Picker) del sistema de noticias de
RDV. Pensada para que una editora nueva pueda operar la herramienta sin saber
nada del código.

---

## 1. Qué es esto

El **admin** es el tablero desde donde se produce el diario. La máquina junta
noticias de más de 25 fuentes (RSS) y redacta borradores con IA; la editora
selecciona, revisa, corrige y **aprueba**; el sistema publica en el sitio y en
las redes. La aprobación humana es el último control, siempre.

## 2. El principio que manda

> **Claude sugiere. Vos decidís. Nada se publica sin tu aprobación.**

Ningún borrador sale al sitio hasta que la editora tilda `aprobado` en Airtable.
Ese criterio humano ES la calidad del producto — no es un trámite.

## 3. El flujo diario (paso a paso)

1. Abrí el admin e iniciá sesión.
2. En **News Picker**, tocá **🤖 Buscar y proponer**. Claude pre-selecciona las
   noticias que valen la pena cubrir, cada una con un puntaje y un motivo.
3. Recorré las **solapas** (una por fuente). Agregá o sacá lo que quieras — la
   selección de Claude es una sugerencia, no una orden. En cada nota elegí su
   **sección** y su **caja de portada**, y si querés, una **🕐 hora**.
4. Tocá **Enviar seleccionados**. Se generan los borradores en Airtable. **Nacen
   sin aprobar.**
5. Abrí **Airtable**. Por cada borrador: leelo, corregí lo que haga falta,
   asegurate de que tenga buena imagen, y **tildá `aprobado`** cuando estés
   conforme.
6. La **publicación es automática**: el sistema saca al aire solo los aprobados,
   en los horarios de abajo.

## 4. Revisar y aprobar (en Airtable)

- Leé y corregí: **título, volanta, bajada, cuerpo**.
- **Imagen:** arrastrá el JPG al campo **`image`**. **No pegues URLs** — el
  sistema arma solo el enlace permanente (Cloudinary) al publicar. Un enlace
  pegado a mano se vence en horas y deja la foto rota.
- **`aprobado`:** ese tilde es tu decisión de publicar. Sin él, no sale.

## 5. Programar una nota

- El **🕐** del picker (o el campo **`publicarEn`** en Airtable) fija **cuándo**
  sale la nota.
- Solo dispara **después** de que tildaste `aprobado`. Sin hora = sale en la
  próxima corrida.

## 6. Horarios de publicación (hora Argentina)

| Qué | Cuándo |
|---|---|
| **Artículos → sitio** | Cada hora en punto, **07:00 a 23:00** |
| **Redes sociales** | **09:00 · 13:00 · 18:00 · 21:00** |

Los dos publican **solo** lo que ya tiene `aprobado` tildado.

## 7. Reglas que no se rompen

- **Nada sin `aprobado`.** Es el único camino a la publicación.
- **Las imágenes van en el campo `image`** (adjunto), nunca como URL pegada.
- **Imágenes locales = lupa.** La foto de las notas hechas a partir de **otros
  medios de Coronel Suárez** pide criterio extra: no se reutiliza la foto de otro
  medio.
- **Local y Local Facebook** no llevan embed de Facebook (el campo `fb-post`
  queda vacío por diseño).

## 8. Ruteo — dónde cae cada cosa

Cada nota lleva tres etiquetas:

- **Feed RSS → Tabla Airtable:** la fuente automática; es la *solapa* del picker.
- **Sección:** la página temática del sitio (`/deportes`, `/economia`…). Siempre
  lleva una.
- **Caja de portada:** el recuadro en la home. Opcional; se elige en el picker.

El mapa completo de las 28 tablas (fuente → sección → cajas) está en la **Guía
visual**: RSS → Airtable → Portada.

## 9. El botón que queda: Process Social Media

`process:social` toma los borradores **aprobados** de todas las tablas y arma los
posteos de redes. Los demás botones de "fetch" manual están ocultos a propósito:
el flujo normal es el **News Picker**.
