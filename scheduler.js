const { exec } = require('child_process');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { promisify } = require('util');

// Configuration
const SCHEDULE = process.env.CRON_SCHEDULE || '0 */1 * * *'; // Default to every hour
const LOG_FILE = path.join(__dirname, 'fetch.log');
const ERROR_LOG_FILE = path.join(__dirname, 'fetch.error.log');

console.log(`Starting scheduler with cron schedule: ${SCHEDULE}`);
console.log(`Logs will be written to: ${LOG_FILE}`);
console.log(`Error logs will be written to: ${ERROR_LOG_FILE}`);

// Ensure log file directories exist
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Function to append to log file
function appendToLog(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  const filePath = isError ? ERROR_LOG_FILE : LOG_FILE;
  
  try {
    fs.appendFileSync(filePath, logMessage);
    console.log(message);
  } catch (error) {
    console.error(`Failed to write to log file ${filePath}:`, error.message);
  }
}

// Function to process a single section
function processSection(section) {
  return new Promise((resolve) => {
    appendToLog(`Processing section: ${section.name}`);
    
    // Ensure the section has a valid tableName
    if (!section.tableName) {
      appendToLog(`Section ${section.id} has no tableName defined! Skipping.`, true);
      resolve();
      return;
    }
    
    const fetchProcess = exec(`node fetch-to-airtable.js ${section.id}`);
    
    fetchProcess.stdout.on('data', (data) => {
      const lines = data.trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          appendToLog(`[${section.id}] ${line.trim()}`);
        }
      });
    });
    
    fetchProcess.stderr.on('data', (data) => {
      const lines = data.trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          appendToLog(`[${section.id}] ERROR: ${line.trim()}`, true);
        }
      });
    });
    
    fetchProcess.on('close', (code) => {
      if (code === 0) {
        appendToLog(`Section ${section.id} processing completed successfully`);
      } else {
        appendToLog(`Section ${section.id} processing exited with code ${code}`, true);
      }
      resolve();
    });
  });
}

// Function to validate all sections before processing
async function validateSections() {
  appendToLog('Validating sections configuration...');
  
  let hasErrors = false;
  
  // Verify that all sections have required properties
  for (const section of config.sections) {
    if (!section.id) {
      appendToLog(`ERROR: Section missing ID: ${JSON.stringify(section)}`, true);
      hasErrors = true;
    }
    
    if (!section.tableName) {
      appendToLog(`ERROR: Section ${section.id} missing tableName property`, true);
      hasErrors = true;
    }
    
    if (!section.rssUrl) {
      appendToLog(`ERROR: Section ${section.id} missing rssUrl property`, true);
      hasErrors = true;
    }
  }
  
  // Verify Airtable configuration
  if (!config.airtable?.baseId) {
    appendToLog('ERROR: Airtable baseId is not configured', true);
    hasErrors = true;
  }
  
  if (!config.airtable?.personalAccessToken) {
    appendToLog('ERROR: Airtable personalAccessToken is not configured', true);
    hasErrors = true;
  }
  
  if (hasErrors) {
    appendToLog('Configuration validation failed. Please fix the errors before continuing.', true);
    return false;
  }
  
  appendToLog('Configuration validation passed.');
  return true;
}

// Function to check if Airtable tables exist
async function checkAirtableTables() {
  appendToLog('Checking Airtable tables...');
  
  try {
    // Import the airtable service
    const { airtableService } = require('./src/services');
    
    for (const section of config.sections) {
      try {
        // Try to get a single record to test if the table exists and is accessible
        const testResult = await airtableService.getRecords(section.id, { maxRecords: 1 });
        
        if (testResult === null) {
          appendToLog(`WARNING: Could not access Airtable table for section ${section.id}. Make sure table '${section.tableName}' exists.`, true);
        } else {
          appendToLog(`Confirmed access to Airtable table for section ${section.id}: ${section.tableName}`);
        }
      } catch (error) {
        appendToLog(`ERROR: Failed to access Airtable table for section ${section.id}: ${error.message}`, true);
      }
    }
  } catch (error) {
    appendToLog(`ERROR: Failed to check Airtable tables: ${error.message}`, true);
    return false;
  }
  
  return true;
}

// Function to run the fetch process for all sections sequentially
async function runFetchProcess() {
  appendToLog('Starting fetch process for all sections');
  
  // Validate configuration before running
  const isValid = await validateSections();
  if (!isValid) {
    appendToLog('Fetch process aborted due to configuration errors.', true);
    return;
  }
  
  // Check Airtable tables
  await checkAirtableTables();
  
  // Get sections sorted by priority
  const sortedSections = [...config.sections].sort((a, b) => a.priority - b.priority);
  
  // Process each section with a delay between them
  for (const section of sortedSections) {
    try {
      await processSection(section);
      
      // Add a delay between sections (except after the last one)
      if (section !== sortedSections[sortedSections.length - 1]) {
        appendToLog(`Waiting for 30 seconds before processing next section...`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds delay
      }
    } catch (error) {
      appendToLog(`Error processing section ${section.id}: ${error.message}`, true);
    }
  }
  
  appendToLog('Completed processing all sections');
}

// Schedule the job
cron.schedule(SCHEDULE, () => {
  appendToLog('Running scheduled task');
  runFetchProcess();
});

// Run immediately on startup
appendToLog('Scheduler started');
runFetchProcess();

// Handle termination
process.on('SIGINT', () => {
  appendToLog('Scheduler stopping...');
  process.exit();
});

process.on('SIGTERM', () => {
  appendToLog('Scheduler stopping...');
  process.exit();
});
