async function getAccessToken(tokenUrl, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error('Authentication failed (HTTP ' + response.status + ')');
  }
  const json = await response.json();
  return json.access_token;
}

module.exports = { getAccessToken };
