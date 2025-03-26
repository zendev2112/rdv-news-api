/**
 * Simple logger function to standardize log format
 */
function info(message, data = '') {
  const dataString = data ? `: ${JSON.stringify(data)}` : ''
  console.log(`[INFO] ${new Date().toISOString()} - ${message}${dataString}`)
}

function warn(message, data = '') {
  const dataString = data ? `: ${JSON.stringify(data)}` : ''
  console.warn(`[WARN] ${new Date().toISOString()} - ${message}${dataString}`)
}

function error(message, error = null) {
  console.error(`[ERROR] ${new Date().toISOString()} - ${message}`)
  if (error && error.message) {
    console.error(`        ${error.message}`)
    if (error.stack) {
      console.error(`        ${error.stack}`)
    }
  }
}

function debug(message, data = '') {
  if (process.env.DEBUG) {
    const dataString = data ? `: ${JSON.stringify(data)}` : ''
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}${dataString}`)
  }
}

module.exports = {
  info,
  warn,
  error,
  debug,
}
