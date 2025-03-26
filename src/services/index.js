const airtableService = require('./airtable')
const { structureArticleData } = require('./structureBuilder')
const embeds = require('./embeds')

module.exports = {
  airtableService,
  structureArticleData,
  embeds,
}
