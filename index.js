const authentication = require('./authentication');
const createInvoiceCreate = require('./creates/create_invoice.js');
const createCustomerCreate = require('./creates/create_customer.js');
const updateCustomerCreate = require('./creates/update_customer.js');
const findCustomerSearch = require('./searches/find_customer.js');
const findCustomersSearch = require('./searches/find_customers.js');
const findProjectSearch = require('./searches/find_project.js');
const findProjectsSearch = require('./searches/find_projects.js');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication: authentication,
  creates: {
    [createInvoiceCreate.key]: createInvoiceCreate,
    [createCustomerCreate.key]: createCustomerCreate,
    [updateCustomerCreate.key]: updateCustomerCreate,
  },
  searches: {
    [findCustomerSearch.key]: findCustomerSearch,
    [findCustomersSearch.key]: findCustomersSearch,
    [findProjectSearch.key]: findProjectSearch,
    [findProjectsSearch.key]: findProjectsSearch,
  },
};
