const zapier = require('zapier-platform-core');

// Use this to make test calls into your app:
const App = require('../../index');
const appTester = zapier.createAppTester(App);
// read the `.env` file into the environment, if available
zapier.tools.env.inject();

describe('creates.create_invoice', () => {
  it('should run', async () => {
    const bearerToken = process.env.WORK4ALL_BEARER_TOKEN;
    const memberCode = process.env.WORK4ALL_MEMBER_CODE;
    const note = process.env.WORK4ALL_INVOICE_NOTE || 'Zapier invoice test';

    if (!bearerToken) {
      throw new Error(
        'WORK4ALL_BEARER_TOKEN is required to run this test.',
      );
    }
    if (!memberCode) {
      throw new Error('WORK4ALL_MEMBER_CODE is required to run this test.');
    }

    const bundle = {
      authData: { bearer_token: bearerToken },
      inputData: {
        member_code: memberCode,
        note: note,
      },
    };

    const results = await appTester(
      App.creates['create_invoice'].operation.perform,
      bundle,
    );
    expect(results).toBeDefined();
    // TODO: add more assertions
  });
});
