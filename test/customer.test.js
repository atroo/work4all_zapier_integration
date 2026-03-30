const zapier = require('zapier-platform-core');

const App = require('../index');
const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const createCustomerPerform = App.creates['create_customer'].operation.perform;
const updateCustomerPerform = App.creates['update_customer'].operation.perform;
const findCustomerPerform = App.searches['find_customer'].operation.perform;
const findCustomersPerform = App.searches['find_customers'].operation.perform;

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
describe('customer – input validation', () => {
  it('create_customer throws when firma1 is missing', async () => {
    await expect(
      appTester(createCustomerPerform, makeBundle({ eMail: 'test@example.com' })),
    ).rejects.toThrow('Company Name is required');
  });

  it('update_customer throws when customer_code is missing', async () => {
    await expect(
      appTester(updateCustomerPerform, makeBundle({ firma1: 'Test GmbH' })),
    ).rejects.toThrow('Customer Code must be a valid number');
  });

  it('find_customer throws when customer_code is missing', async () => {
    await expect(
      appTester(findCustomerPerform, makeBundle({})),
    ).rejects.toThrow('Customer Code must be a valid number');
  });
});

// ---------------------------------------------------------------------------
// API integration tests — require real credentials and network access
// ---------------------------------------------------------------------------
describe('customer – API integration', () => {
  // Code of the customer created in the create test — reused by get/update tests.
  let createdCustomerCode = 0;

  beforeAll(() => {
    const hasCredentials =
      process.env.W4A_BASE_URL &&
      process.env.W4A_API_ACCESS_TOKEN_URL &&
      process.env.W4A_API_CLIENT_ID &&
      process.env.W4A_API_CLIENT_SECRET;

    if (!hasCredentials) {
      throw new Error(
        'W4A_BASE_URL, W4A_API_ACCESS_TOKEN_URL, W4A_API_CLIENT_ID, and W4A_API_CLIENT_SECRET ' +
          'are required to run integration tests.',
      );
    }
  });

  it('gets all customers (first page, 10 results)', async () => {
    const results = await appTester(
      findCustomersPerform,
      makeBundle({ query_size: 10, query_page: 1 }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1); // wrapped paginated response
    expect(results[0].data).toBeInstanceOf(Array);
    expect(results[0].data.length).toBeGreaterThan(0);
    expect(typeof results[0].total).toBe('number');
  }, 15000);

  it('gets all customers — page 2', async () => {
    const results = await appTester(
      findCustomersPerform,
      makeBundle({ query_size: 5, query_page: 2 }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results[0].data).toBeInstanceOf(Array);
  }, 15000);

  it('creates a new customer', async () => {
    const testName = `zapier-test-${Date.now()}`;
    const result = await appTester(
      createCustomerPerform,
      makeBundle({
        firma1: testName,
        eMail: 'test@zapier-integration.example',
        telefon: '+49 000 000000',
        strasse: 'Teststraße 1',
        plz: '12345',
        ort: 'Teststadt',
        notiz: '[Zapier test — safe to delete]',
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    createdCustomerCode = result.code;
  }, 15000);

  it('gets a single customer by code (uses customer created above)', async () => {
    if (!createdCustomerCode) return;

    const results = await appTester(
      findCustomerPerform,
      makeBundle({ customer_code: createdCustomerCode }),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].code).toBe(createdCustomerCode);
  }, 15000);

  it('updates the created customer note', async () => {
    if (!createdCustomerCode) return;

    const newNote = `[Zapier test update ${Date.now()}]`;
    const result = await appTester(
      updateCustomerPerform,
      makeBundle({
        customer_code: createdCustomerCode,
        notiz: newNote,
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.notiz).toBe(newNote);
  }, 15000);
});
