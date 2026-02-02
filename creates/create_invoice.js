const perform = async (z, bundle) => {
  var endpoint = 'https://backend-dev.work4alltest.work4allcloud.de/graphql';
  var memberCode = bundle.inputData.member_code;
  var note = bundle.inputData.note;

  if (memberCode === undefined || memberCode === null) {
    throw new Error('member_code is required');
  }
  if (note === undefined || note === null) {
    throw new Error('note is required');
  }

  var gql = function (operationName, query, variables) {
    var options = {
      url: endpoint,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + bundle.authData.bearer_token,
        'GraphQL-Require-Preflight': 'true',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        operationName: operationName,
        query: query,
        variables: variables,
      }),
      removeMissingValuesFrom: {
        body: false,
        params: false,
      },
    };

    return z.request(options).then(function (response) {
      var json = response.json || JSON.parse(response.content);

      if (json.errors && json.errors.length) {
        throw new Error(
          json.errors
            .map(function (e) {
              return e.message;
            })
            .join('; '),
        );
      }
      return json.data;
    });
  };

  var createQuery = `
    mutation CreateShadowRe($memberCode: Int!) {
      createShadowRe(sdObjMemberCode: $memberCode) {
        id
        name
        benutzerCode
        sdObjMemberCode
        incommingInvoiceCode
        generatedLineCodes
      }
    }
  `;

  var modifyQuery = `
    mutation ModifyShadowRe($shadowId: ID!, $note: String!) {
      modifyShadowRe(id: $shadowId, invoiceData: { notiz: $note }) {
        id
        name
        benutzerCode
        sdObjMemberCode
        incommingInvoiceCode
        generatedLineCodes
      }
    }
  `;

  var persistQuery = `
    mutation PersistShadowRe($shadowId: ID!) {
      persistShadowRe(id: $shadowId) {
        id
        name
        benutzerCode
        sdObjMemberCode
        incommingInvoiceCode
        generatedLineCodes
      }
    }
  `;

  var parsedMemberCode = parseInt(memberCode, 10);
  if (Number.isNaN(parsedMemberCode)) {
    throw new Error('member_code must be an integer');
  }
  var noteString = String(note);

  var createResult = await gql('CreateShadowRe', createQuery, {
    memberCode: parsedMemberCode,
  });
  var shadowId =
    createResult &&
    createResult.createShadowRe &&
    createResult.createShadowRe.id;
  if (!shadowId) {
    throw new Error('createShadowRe did not return an id');
  }

  await gql('ModifyShadowRe', modifyQuery, {
    shadowId: String(shadowId),
    note: noteString,
  });
  var persistResult = await gql('PersistShadowRe', persistQuery, {
    shadowId: String(shadowId),
  });

  return persistResult.persistShadowRe || persistResult;
};

module.exports = {
  operation: {
    perform: perform,
    inputFields: [
      {
        key: 'member_code',
        label: 'the id of the member for which the invoice should be created',
        type: 'integer',
        required: true,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'note',
        label: 'note for the invoice',
        type: 'string',
        required: true,
        list: false,
        altersDynamicFields: false,
      },
    ],
  },
  display: {
    description:
      'Create an invoice using the shadow object api: 1. create shadow object RE, 2. modifies shadow object RE, 3. persists shadow object RE',
    hidden: false,
    label: 'Create invoice',
  },
  key: 'create_invoice',
  noun: 'Invoice',
};
