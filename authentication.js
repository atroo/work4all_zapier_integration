const test = async (_z, bundle) => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: bundle.authData.client_id,
    client_secret: bundle.authData.client_secret,
  });

  const response = await fetch(bundle.authData.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      'Authentication failed (HTTP ' + response.status + '): Invalid credentials or token URL.',
    );
  }

  const json = await response.json();
  if (!json.access_token) {
    throw new Error('Authentication failed: No access_token in response.');
  }

  return json;
};

module.exports = {
  type: 'custom',
  test: test,
  fields: [
    {
      key: 'base_url',
      label: 'API URL',
      required: true,
      type: 'string',
      default: 'https://api.work4all.de',
      helpText: 'Base URL of the work4all API, e.g. https://api.work4all.de',
    },
    {
      key: 'token_url',
      label: 'Token URL',
      required: true,
      type: 'string',
      helpText: 'OAuth2 token endpoint, e.g. https://auth.work4all.de/connect/token',
    },
    {
      key: 'client_id',
      label: 'Client ID',
      required: true,
      type: 'string',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      required: true,
      type: 'password',
    },
  ],
  customConfig: {},
};
