import axios from 'axios';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Fetch and log JSON data from a URL
 * @param {string} url - URL to fetch JSON data from (optional - can use section ID instead)
 * @param {boolean} saveToFile - Whether to save output to a file
 * @param {boolean} verbose - Whether to display all data fields
 */
async function logJsonData(url = null, saveToFile = false, verbose = false) {
  try {
    let urls = [];
    
    // If no URL is provided, use section rssUrl from config
    if (!url) {
      // Get sections to process
      const sections = config.getSections();
      
      if (sections.length === 0) {
        console.error('No sections found to process');
        return;
      }
      
      urls = sections.map(section => ({
        name: section.name,
        id: section.id,
        url: section.rssUrl
      }));
      
      console.log(`Processing ${urls.length} feeds from config...\n`);
    } 
    // If URL looks like a section ID, use that section's rssUrl
    else if (!url.includes('://') && !url.startsWith('http')) {
      const section = config.getSection(url);
      if (section) {
        urls = [{
          name: section.name,
          id: section.id,
          url: section.rssUrl
        }];
        console.log(`Processing feed for section: ${section.name}\n`);
      } else {
        console.error(`Section '${url}' not found in config`);
        return;
      }
    }
    // Otherwise, use the provided URL directly
    else {
      urls = [{
        name: 'Custom URL',
        id: 'custom',
        url: url
      }];
      console.log(`Processing custom URL: ${url}\n`);
    }
    
    // Results storage
    const results = {};
    
    // Process each URL
    for (const item of urls) {
      try {
        console.log(`Fetching JSON from ${item.name} (${item.url})...`);
        
        const response = await axios.get(item.url, {
          timeout: 30000,
          headers: {
            'User-Agent': 'JSON-Fetcher/1.0',
            'Accept': 'application/json, text/plain, */*'
          }
        });
        
        // Log the response structure
        const data = response.data;
        
        // Store basic results
        results[item.id] = {
          name: item.name,
          url: item.url,
          status: 'success'
        };
        
        // Check if it's an RSS-like structure
        if (data.items && Array.isArray(data.items)) {
          results[item.id].itemCount = data.items.length;
          results[item.id].firstItem = data.items.length > 0 ? data.items[0] : null;
          
          console.log(`✓ Successfully fetched data with ${data.items.length} items`);
          
          // Store feed metadata if present
          if (data.title || data.description || data.link) {
            results[item.id].feed = {
              title: data.title || null,
              description: data.description || null,
              link: data.link || null,
              lastBuildDate: data.lastBuildDate || null
            };
            console.log(`  Feed title: ${results[item.id].feed?.title || 'N/A'}\n`);
          }
          
          // For verbose mode or custom URLs, include full data
          if (verbose || item.id === 'custom') {
            results[item.id].fullData = data;
          }
        } 
        // For non-RSS JSON structures
        else {
          console.log(`✓ Successfully fetched JSON data`);
          
          // Try to determine structure
          if (Array.isArray(data)) {
            results[item.id].type = 'array';
            results[item.id].itemCount = data.length;
            results[item.id].firstItem = data.length > 0 ? data[0] : null;
            console.log(`  Found array with ${data.length} items\n`);
          } else if (typeof data === 'object') {
            results[item.id].type = 'object';
            const keys = Object.keys(data);
            results[item.id].keys = keys;
            console.log(`  Found object with ${keys.length} top-level keys: ${keys.join(', ')}\n`);
          } else {
            results[item.id].type = typeof data;
            console.log(`  Found ${typeof data} data\n`);
          }
          
          // Include full data for custom URLs or verbose mode
          if (verbose || item.id === 'custom') {
            results[item.id].fullData = data;
          }
        }
      } catch (error) {
        console.error(`Error fetching data from ${item.url}:`, error.message);
        
        results[item.id] = {
          name: item.name,
          url: item.url,
          status: 'error',
          error: error.message
        };
      }
    }
    
    // Output detailed inspection of the data
    console.log('\n=== DETAILED DATA INSPECTION ===\n');
    
    for (const [id, result] of Object.entries(results)) {
      if (result.status === 'error') {
        console.log(`\n${result.name} (${id}) - ERROR: ${result.error}`);
        continue;
      }
      
      console.log(`\n${result.name} (${id}):`);
      
      // RSS-like structure
      if (result.firstItem) {
        console.log('First item structure:');
        const firstItem = result.firstItem;
        
        // Output fields and types
        Object.keys(firstItem).forEach(key => {
          const value = firstItem[key];
          const type = Array.isArray(value) ? 'array' : typeof value;
          const preview = type === 'string' ? 
            (value.length > 100 ? value.substring(0, 97) + '...' : value) : 
            (type === 'object' ? '[Object]' : value);
          
          console.log(`  - ${key} (${type}): ${preview}`);
        });
        
        // Show full first item for verbose or custom URLs
        if (verbose || id === 'custom') {
          console.log('\nFull first item:');
          console.log(JSON.stringify(result.firstItem, null, 2));
        }
      }
      // For non-RSS JSON structures
      else if (result.fullData) {
        if (result.type === 'array' && result.fullData.length > 0) {
          console.log('First array item:');
          console.log(JSON.stringify(result.fullData[0], null, 2));
        } else if (result.type === 'object') {
          console.log('Top-level object structure:');
          Object.keys(result.fullData).forEach(key => {
            const value = result.fullData[key];
            const type = Array.isArray(value) ? 'array' : typeof value;
            console.log(`  - ${key} (${type})`);
          });
          
          if (verbose || id === 'custom') {
            console.log('\nFull data:');
            console.log(JSON.stringify(result.fullData, null, 2));
          }
        }
      }
      
      console.log('\n' + '-'.repeat(80));
    }
    
    // Save to file if requested
    if (saveToFile) {
      const outputDir = path.join(__dirname, '../../temp');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const filename = path.join(outputDir, 
        url && !url.includes('://') && url !== 'all' ? 
          `json-data-${url}.json` : 'json-data-output.json');
      
      fs.writeFileSync(filename, JSON.stringify(results, null, 2));
      console.log(`\nSaved data to ${filename}`);
    }
    
    return results;
  } catch (error) {
    console.error('Error processing JSON data:', error.message);
    return null;
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const urlOrSectionId = args.find(arg => !arg.startsWith('--')) || null;
  const saveToFile = args.includes('--save');
  const verbose = args.includes('--verbose');
  
  console.log(`
=======================================
JSON DATA INSPECTOR
=======================================
URL/Section: ${urlOrSectionId || 'ALL SECTIONS'}
Save to file: ${saveToFile ? 'YES' : 'NO'}
Verbose mode: ${verbose ? 'YES' : 'NO'}
  `);
  
  logJsonData(urlOrSectionId, saveToFile, verbose)
    .then(() => {
      console.log('\nJSON data inspection complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { logJsonData };