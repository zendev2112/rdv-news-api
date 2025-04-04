/**
 * Simple logger utility with different log levels
 */

function debug(message, ...args) {
  console.debug(`[DEBUG] ${message}`, ...args);
}

function log(message, ...args) {
  console.log(`[LOG] ${message}`, ...args);
}

function info(message, ...args) {
  console.info(`[INFO] ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`[WARN] ${message}`, ...args);
}

function error(message, ...args) {
  console.error(`[ERROR] ${message}`, ...args);
}

// Create a default export with all methods
const logger = {
  debug,
  log,
  info,
  warn,
  error
};

// Export both as named exports and as default export
export { debug, log, info, warn, error };
export default logger;
