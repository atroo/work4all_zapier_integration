const authentication = require('./authentication');
const createInvoiceCreate = require('./creates/create_invoice.js');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication: authentication,
  creates: { [createInvoiceCreate.key]: createInvoiceCreate },
};
