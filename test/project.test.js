const zapier = require('zapier-platform-core');

const App = require('../index');
const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const findProjectPerform = App.searches['find_project'].operation.perform;
const findProjectsPerform = App.searches['find_projects'].operation.perform;

const PROJECT_CODE = parseInt(process.env.W4A_TEST_PROJECT_CODE || '0', 10);

function makeBundle(inputData) {
  return {
    authData: {
      base_url: process.env.W4A_BASE_URL || 'https://api.work4all.de',
      token_url: process.env.W4A_API_ACCESS_TOKEN_URL || 'https://dummy.invalid/token',
      client_id: process.env.W4A_API_CLIENT_ID || 'dummy-client-id',
      client_secret: process.env.W4A_API_CLIENT_SECRET || 'dummy-secret',
    },
    inputData,
  };
}

// ---------------------------------------------------------------------------
// Input validation tests — these throw before any HTTP call is made
// ---------------------------------------------------------------------------
describe('project – input validation', () => {
  it('find_project throws when project_code is missing', async () => {
    await expect(
      appTester(findProjectPerform, makeBundle({})),
    ).rejects.toThrow('project_code');
  });
});

// ---------------------------------------------------------------------------
// API integration tests — require real credentials and network access
// ---------------------------------------------------------------------------
describe('project – API integration', () => {
  const hasCredentials =
    process.env.W4A_BASE_URL &&
    process.env.W4A_API_ACCESS_TOKEN_URL &&
    process.env.W4A_API_CLIENT_ID &&
    process.env.W4A_API_CLIENT_SECRET;

  // find_project additionally requires W4A_TEST_PROJECT_CODE
  const itWithProject = hasCredentials && PROJECT_CODE ? it : it.skip;
  const itWithCreds = hasCredentials ? it : it.skip;

  beforeAll(() => {
    if (!hasCredentials) {
      throw new Error(
        'W4A_BASE_URL, W4A_API_ACCESS_TOKEN_URL, W4A_API_CLIENT_ID, and W4A_API_CLIENT_SECRET ' +
          'are required to run integration tests.',
      );
    }
  });

  itWithCreds('gets all projects (first page, 10 results)', async () => {
    const results = await appTester(
      findProjectsPerform,
      makeBundle({ query_size: 10, query_page: 1 }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].data).toBeInstanceOf(Array);
    expect(results[0].data.length).toBeGreaterThan(0);
    expect(typeof results[0].total).toBe('number');
  }, 15000);

  itWithCreds('gets all projects — page 2', async () => {
    const results = await appTester(
      findProjectsPerform,
      makeBundle({ query_size: 5, query_page: 2 }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results[0].data).toBeInstanceOf(Array);
  }, 15000);

  itWithProject('gets a single project by code', async () => {
    const results = await appTester(
      findProjectPerform,
      makeBundle({ project_code: PROJECT_CODE }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(PROJECT_CODE);
  }, 15000);
});
