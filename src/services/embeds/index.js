const { extractInstagramEmbeds } = require('./instagram.js')
const { extractFacebookEmbeds } = require('./facebook.js')
const { extractTwitterEmbeds } = require('./twitter.js')
const { extractYoutubeEmbeds } = require('./youtube.js')

module.exports = {
  extractInstagramEmbeds,
  extractFacebookEmbeds,
  extractTwitterEmbeds,
  extractYoutubeEmbeds,
}
