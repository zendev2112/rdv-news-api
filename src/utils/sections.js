import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Get section by ID or slug
 */
export async function getSection(idOrSlug) {
  if (!idOrSlug) return null;
  
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .or(`id.eq.${idOrSlug},slug.eq.${idOrSlug}`)
    .single();
    
  if (error) {
    console.error('Error fetching section:', error);
    return null;
  }
  
  return data;
}

/**
 * Get all main navigation sections (top level)
 */
export async function getMainSections() {
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .is('parent_id', null)
    .order('position');
    
  if (error) {
    console.error('Error fetching main sections:', error);
    return [];
  }
  
  return data;
}

/**
 * Get immediate children of a section
 */
export async function getChildSections(parentId) {
  const { data, error } = await supabase
    .rpc('get_child_sections', { parent_section_id: parentId });
    
  if (error) {
    console.error('Error fetching child sections:', error);
    return [];
  }
  
  return data;
}

/**
 * Get a section with its immediate children
 */
export async function getSectionWithChildren(idOrSlug) {
  const section = await getSection(idOrSlug);
  
  if (!section) return null;
  
  const children = await getChildSections(section.id);
  
  return {
    ...section,
    children: children || []
  };
}

/**
 * Get full breadcrumb for a section
 */
export async function getSectionBreadcrumb(idOrSlug) {
  const section = await getSection(idOrSlug);
  
  if (!section) return [];
  
  const { data, error } = await supabase
    .rpc('get_section_breadcrumb', { section_id: section.id });
    
  if (error) {
    console.error('Error fetching breadcrumb:', error);
    return [];
  }
  
  return data.sort((a, b) => a.level - b.level);
}

/**
 * Get articles from a section with optional pagination
 */
export async function getSectionArticles(idOrSlug, includeDescendants = true, page = 1, limit = 12) {
  const section = await getSection(idOrSlug);
  
  if (!section) {
    throw new Error(`Section not found: ${idOrSlug}`);
  }
  
  const offset = (page - 1) * limit;
  
  // Get article count
  const { data: countData, error: countError } = await supabase
    .rpc('count_section_articles', {
      section_id: section.id,
      include_descendants: includeDescendants
    });
    
  const count = countError ? 0 : countData;
  
  // Get articles
  const { data: articles, error: articlesError } = await supabase
    .rpc('get_section_articles', {
      section_id: section.id,
      include_descendants: includeDescendants,
      p_limit: limit,
      p_offset: offset
    });
    
  if (articlesError) {
    console.error('Error fetching section articles:', articlesError);
    throw articlesError;
  }
  
  // Get breadcrumb
  const breadcrumb = await getSectionBreadcrumb(section.id);
  
  // Get child sections
  const children = await getChildSections(section.id);
  
  return {
    section: {
      ...section,
      children: children || []
    },
    breadcrumb,
    articles: articles || [],
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit)
    }
  };
}

/**
 * Add an article to one or more sections
 */
export async function addArticleToSections(articleId, sectionIds, primarySectionId = null) {
  if (!articleId) throw new Error('Article ID is required');
  
  // Ensure we're working with arrays
  const sectionsToAdd = Array.isArray(sectionIds) ? sectionIds : [sectionIds].filter(Boolean);
  
  if (sectionsToAdd.length === 0) {
    throw new Error('At least one section ID is required');
  }
  
  // If primarySectionId isn't specified, use the first section
  const primaryId = primarySectionId || sectionsToAdd[0];
  
  const records = sectionsToAdd.map(sectionId => ({
    article_id: articleId,
    section_id: sectionId,
    is_primary: sectionId === primaryId
  }));
  
  const { data, error } = await supabase
    .from('article_sections')
    .upsert(records, {
      onConflict: ['article_id', 'section_id']
    });
    
  if (error) {
    console.error('Error adding article to sections:', error);
    throw error;
  }
  
  return true;
}

/**
 * Get the full section tree for navigation
 */
export async function getSectionTree() {
  // Get all sections
  const { data: allSections, error } = await supabase
    .from('sections')
    .select('*')
    .order('position, id');
    
  if (error) {
    console.error('Error fetching all sections:', error);
    return [];
  }
  
  // Build the tree structure
  const sectionsById = {};
  allSections.forEach(section => {
    sectionsById[section.id] = {
      ...section,
      children: []
    };
  });
  
  // Populate children
  const rootSections = [];
  
  allSections.forEach(section => {
    if (section.parent_id === null) {
      rootSections.push(sectionsById[section.id]);
    } else if (sectionsById[section.parent_id]) {
      sectionsById[section.parent_id].children.push(sectionsById[section.id]);
    }
  });
  
  return rootSections;
}