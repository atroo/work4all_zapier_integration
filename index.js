const authentication = require('./authentication');
const createInvoiceCreate = require('./creates/create_invoice.js');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  requestTemplate: {
    params: { bearer_token: '{{bundle.authData.bearer_token}}' },
    headers: { 'X-BEARER-TOKEN': '{{bundle.authData.bearer_token}}' },
  },
  authentication: authentication,
  creates: { [createInvoiceCreate.key]: createInvoiceCreate },
};
