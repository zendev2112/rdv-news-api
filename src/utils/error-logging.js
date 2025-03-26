const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Error log directory for structured error tracking
const ERROR_LOG_DIR = path.join(__dirname, '../../.errors');
if (!fs.existsSync(ERROR_LOG_DIR)) {
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
}

/**
 * Enhanced error logging with context and persistence
 * @param {string} context - Where the error occurred
 * @param {Error} error - The error object
 * @param {Object} additionalInfo - Any extra context information
 * @returns {string} - The generated error ID for reference
 */
function logError(context, error, additionalInfo = {}) {
  // Generate timestamp and unique error ID
  const timestamp = new Date().toISOString();
  const errorId = crypto.randomBytes(4).toString('hex');
  
  // Format error details
  const errorDetails = {
    id: errorId,
    timestamp,
    context,
    message: error.message,
    stack: error.stack,
    ...additionalInfo
  };
  
  // Log to console with reference ID
  console.error(`[${timestamp}][${errorId}] ERROR in ${context}: ${error.message}`);
  
  // Write to dated error log file for persistence
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const logFile = path.join(ERROR_LOG_DIR, `${today}.json`);
    
    // Load existing logs for today if they exist
    let existingLogs = [];
    if (fs.existsSync(logFile)) {
      existingLogs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    
    // Add new error and save
    existingLogs.push(errorDetails);
    fs.writeFileSync(logFile, JSON.stringify(existingLogs, null, 2), 'utf8');
  } catch (logError) {
    console.error('Failed to write to error log file:', logError.message);
  }
  
  return errorId; // Return the error ID for reference in code
}

module.exports = {
  logError
};