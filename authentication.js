const test = async (z, bundle) => {
  const options = {
    url: 'https://backend-dev.work4alltest.work4allcloud.de/graphql',
    method: 'POST',
    headers: {
      'X-BEARER-TOKEN': bundle.authData.bearer_token,
      Authorization: bundle.authData.bearer_token,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
    },
    params: {},
    body: JSON.stringify({
      query: 'query { __typename }',
      // operationName: 'TestAuth',     // optional
      // variables: {},                 // optional
    }),
    removeMissingValuesFrom: {
      body: false,
      params: false,
    },
  };

  return z.request(options).then((response) => {
    const results = response.json;

    return results;
  });
};

module.exports = {
  type: 'custom',
  test: test,
  fields: [
    { computed: false, key: 'bearer_token', required: true, type: 'string' },
  ],
  customConfig: {},
};
