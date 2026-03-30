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

  const customerCode = parseInt(bundle.inputData.customer_code, 10);
  if (!customerCode || Number.isNaN(customerCode)) {
    throw new Error('Customer Code must be a valid number.');
  }

  return z.request({
    url: baseUrl + '/graphql',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: GQL_GET_KUNDEN,
      variables: {
        querySize: 1,
        filter: JSON.stringify([{ code: { $eq: String(customerCode) } }]),
      },
    }),
  }).then(function (response) {
    const json = response.json || JSON.parse(response.content);
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
    }
    // Searches must return an array; empty array means "not found"
    return json.data.getKunden.data;
  });
};

const SAMPLE = {
  code: 123456789,
  nummer: 1001,
  name: 'Test GmbH',
  eMail: 'info@test.de',
  telefon: '+49 30 123456',
  telefon2: '',
  strasse: 'Teststraße 1',
  plz: '10115',
  ort: 'Berlin',
  notiz: 'Test note',
  interNet: 'https://test.de',
  privatkunde: false,
  hauptansprechpartnerCode: null,
  zahlungsfrist: 30,
  erstkontakt: null,
  gesperrt: false,
  gruppe: null,
  ansprechpartner: [],
};

module.exports = {
  key: 'find_customer',
  noun: 'Customer',
  display: {
    label: 'Find Customer',
    description: 'Finds a single customer by their internal work4all code.',
    hidden: false,
  },
  operation: {
    perform,
    sample: SAMPLE,
    outputFields: [
      { key: 'code', label: 'Customer Code', type: 'integer' },
      { key: 'nummer', label: 'Customer Number', type: 'integer' },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'eMail', label: 'Email', type: 'string' },
      { key: 'telefon', label: 'Phone', type: 'string' },
      { key: 'telefon2', label: 'Phone 2', type: 'string' },
      { key: 'strasse', label: 'Street', type: 'string' },
      { key: 'plz', label: 'Postal Code', type: 'string' },
      { key: 'ort', label: 'City', type: 'string' },
      { key: 'notiz', label: 'Note', type: 'string' },
      { key: 'interNet', label: 'Website', type: 'string' },
      { key: 'privatkunde', label: 'Private Customer', type: 'boolean' },
      { key: 'gesperrt', label: 'Blocked', type: 'boolean' },
      { key: 'zahlungsfrist', label: 'Payment Term (Days)', type: 'integer' },
      { key: 'gruppe__code', label: 'Group Code', type: 'integer' },
      { key: 'gruppe__name', label: 'Group Name', type: 'string' },
    ],
    inputFields: [
      {
        key: 'customer_code',
        label: 'Customer Code',
        type: 'integer',
        required: true,
        helpText: 'Internal work4all customer code.',
      },
    ],
  },
};
