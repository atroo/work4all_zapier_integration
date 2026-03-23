const { getAccessToken } = require('../utils/auth');

const GQL_UPSERT_KUNDE = `
  mutation upsertKunde($input: InputKunde!, $relations: InputKundeRelation) {
    upsertKunde(input: $input, relations: $relations) {
      code
      nummer
      name
      eMail
      telefon
      strasse
      plz
      ort
      notiz
      interNet
      gruppe { code name }
      ansprechpartner {
        code
        anzeigename
        vorname
        name
        telefon
        mobilfunk
        eMail
        funktion
        hauptansprechpartner
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
    throw new Error('customer_code must be a valid integer.');
  }

  const input = { code: customerCode };
  const fields = ['firma1', 'eMail', 'telefon', 'strasse', 'plz', 'ort', 'interNet', 'notiz'];
  for (const field of fields) {
    if (bundle.inputData[field] != null && String(bundle.inputData[field]).trim()) {
      input[field] = String(bundle.inputData[field]);
    }
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
      query: GQL_UPSERT_KUNDE,
      variables: { input, relations: {} },
    }),
  }).then(function (response) {
    const json = response.json || JSON.parse(response.content);
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
    }
    return json.data.upsertKunde;
  });
};

const SAMPLE = {
  code: 123456789,
  nummer: 1001,
  name: 'Test GmbH',
  eMail: 'info@test.de',
  telefon: '+49 30 123456',
  strasse: 'Teststraße 1',
  plz: '10115',
  ort: 'Berlin',
  notiz: 'Updated note',
  interNet: 'https://test.de',
  gruppe: null,
  ansprechpartner: [],
};

module.exports = {
  key: 'update_customer',
  noun: 'Customer',
  display: {
    label: 'Update Customer',
    description: 'Updates an existing customer in work4all.',
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
      { key: 'strasse', label: 'Street', type: 'string' },
      { key: 'plz', label: 'Postal Code', type: 'string' },
      { key: 'ort', label: 'City', type: 'string' },
      { key: 'notiz', label: 'Note', type: 'string' },
      { key: 'interNet', label: 'Website', type: 'string' },
      { key: 'gruppe__code', label: 'Group Code', type: 'integer' },
      { key: 'gruppe__name', label: 'Group Name', type: 'string' },
    ],
    inputFields: [
      {
        key: 'customer_code',
        label: 'Customer Code',
        type: 'integer',
        required: true,
        helpText: 'Internal work4all customer code of the customer to update.',
      },
      {
        key: 'firma1',
        label: 'Company Name',
        type: 'string',
        required: false,
        helpText: 'Company / firm name (Firma 1). Leave empty to keep the existing value.',
      },
      { key: 'eMail', label: 'Email', type: 'string', required: false },
      { key: 'telefon', label: 'Phone', type: 'string', required: false },
      { key: 'strasse', label: 'Street', type: 'string', required: false },
      { key: 'plz', label: 'Postal Code', type: 'string', required: false },
      { key: 'ort', label: 'City', type: 'string', required: false },
      { key: 'interNet', label: 'Website', type: 'string', required: false },
      { key: 'notiz', label: 'Note', type: 'string', required: false },
    ],
  },
};
