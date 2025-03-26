/**
 * Creates a delay of specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} - Resolves after delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  delay,
}
