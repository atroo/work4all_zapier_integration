const authentication = require('./authentication');
const createInvoiceCreate = require('./creates/create_invoice.js');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  requestTemplate: {
    headers: { Authorization: 'Bearer {{bundle.authData.bearer_token}}' },
  },
  authentication: authentication,
  creates: { [createInvoiceCreate.key]: createInvoiceCreate },
};
