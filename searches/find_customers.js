const { getAccessToken } = require('../utils/auth');

const GQL_GET_KUNDEN = `
  query getKunden($querySize: Int, $queryPage: Int, $filter: String) {
    getKunden(querySize: $querySize, queryPage: $queryPage, querySortBy: "name", querySortOrder: ASCENDING, filter: $filter) {
      total
      size
      page
      data {
        code
        nummer
        name
        eMail
        telefon
        telefon2
        strasse
        plz
        ort
        notiz
        interNet
        privatkunde
        hauptansprechpartnerCode
        zahlungsfrist
        erstkontakt
        gesperrt
        gruppe { code name }
        ansprechpartner {
          code
          anzeigename
          vorname
          name
          telefon
          telefon2
          mobilfunk
          eMail
          notiz
          funktion
          hauptansprechpartner
          abteilungCode
          anrede { code maennlich weiblich }
        }
      }
    }
  }
`;

const perform = async (z, bundle) => {
  const baseUrl = String(bundle.authData.base_url).replace(/\/$/, '');
  const accessToken = await getAccessToken(
    bundle.authData.token_url,
    bundle.authData.client_id,
    bundle.authData.client_secret,
  );

  const querySize = parseInt(bundle.inputData.query_size || 100, 10);
  const queryPage = parseInt(bundle.inputData.query_page || 1, 10);
  const filterRaw = bundle.inputData.filter || '';

  const variables = { querySize, queryPage };
  if (filterRaw.trim()) variables.filter = filterRaw;

  return z.request({
    url: baseUrl + '/graphql',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: GQL_GET_KUNDEN, variables }),
  }).then(function (response) {
    const json = response.json || JSON.parse(response.content);
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
    }
    // Return the paginated response as a single result so callers can access
    // total, size, page, and data in subsequent Zap steps.
    return [json.data.getKunden];
  });
};

const SAMPLE = {
  total: 42,
  size: 10,
  page: 1,
  data: [
    {
      code: 123456789,
      nummer: 1001,
      name: 'Test GmbH',
      eMail: 'info@test.de',
      telefon: '+49 30 123456',
      strasse: 'Teststraße 1',
      plz: '10115',
      ort: 'Berlin',
      notiz: '',
      interNet: 'https://test.de',
      privatkunde: false,
      gesperrt: false,
      gruppe: null,
      ansprechpartner: [],
    },
  ],
};

module.exports = {
  key: 'find_customers',
  noun: 'Customers',
  display: {
    label: 'Find Customers',
    description: 'Returns a paginated list of customers from work4all.',
    hidden: false,
  },
  operation: {
    perform,
    sample: SAMPLE,
    outputFields: [
      { key: 'total', label: 'Total Customers', type: 'integer' },
      { key: 'size', label: 'Page Size', type: 'integer' },
      { key: 'page', label: 'Current Page', type: 'integer' },
    ],
    inputFields: [
      {
        key: 'query_size',
        label: 'Page Size',
        type: 'integer',
        required: false,
        default: '100',
        helpText: 'Number of customers to return per page.',
      },
      {
        key: 'query_page',
        label: 'Page',
        type: 'integer',
        required: false,
        default: '1',
        helpText: 'Page number (1-based).',
      },
      {
        key: 'filter',
        label: 'Filter',
        type: 'text',
        required: false,
        helpText:
          'Optional filter as a JSON array, e.g. [{"name":{"$eq":"work4all GmbH"}}]',
        placeholder: '[{"name":{"$eq":"work4all GmbH"}}]',
      },
    ],
  },
};
