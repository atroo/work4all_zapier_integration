const zapier = require('zapier-platform-core');

const App = require('../../index');
const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const perform = App.creates['create_invoice'].operation.perform;

// Use WORK4ALL_SUPPLIER_CODE if set, otherwise fall back to WORK4ALL_MEMBER_CODE,
// otherwise use the known-good supplier from the backend developer's sample.
// NOTE: the supplier must exist as a Lieferant in the work4all test instance —
// a plain member/contact code will cause a ValidationError.
const SUPPLIER_CODE =
  process.env.WORK4ALL_SUPPLIER_CODE ||
  process.env.WORK4ALL_MEMBER_CODE ||
  '1245558295';

// Full header payload from the backend developer's sample.
// invoiceItems uses an empty array because specific account/taxCode values
// are environment-dependent — the backend returns NullReferenceException
// when invoiceItems is null/omitted, and ValidationError for unknown codes.
// Provide WORK4ALL_INVOICE_ITEMS in .env with a JSON array of valid positions
// to test line-item creation in your specific environment.
const FULL_INPUT = {
  supplier_code: SUPPLIER_CODE,
  project_code: '1610906012',
  note: 'Eingangsrechnungs-Notiz',
  invoice_number_supplier: 'xy1234-4022',
  invoice_date: '2026-02-13T00:00:00Z',
  entry_date: '2026-02-16T00:00:00Z',
  receipt_date: '2026-02-17T00:00:00Z',
  payment_term_days: '11',
  discount1_rate: '2',
  discount1_days: '8',
  discount2_rate: '5',
  discount2_days: '3',
  currency_code: '1',
  invoice_items: process.env.WORK4ALL_INVOICE_ITEMS || '[]',
};

function makeBundle(inputData) {
  return {
    authData: { bearer_token: process.env.WORK4ALL_BEARER_TOKEN || 'dummy-token' },
    inputData,
  };
}

// ---------------------------------------------------------------------------
// Input validation tests — these throw before any HTTP call is made
// ---------------------------------------------------------------------------
describe('creates.create_invoice – input validation', () => {
  it('throws when supplier_code is missing', async () => {
    await expect(
      appTester(perform, makeBundle({ note: 'test' })),
    ).rejects.toThrow('supplier_code is required');
  });

  it('throws when supplier_code is null', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: null })),
    ).rejects.toThrow('supplier_code is required');
  });

  it('throws when supplier_code is not a valid integer', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: 'not-a-number' })),
    ).rejects.toThrow('supplier_code must be an integer');
  });

  it('throws when invoice_items is not valid JSON', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '123', invoice_items: '{broken json' })),
    ).rejects.toThrow('invoice_items must be a valid JSON array');
  });

  it('throws when invoice_items is a JSON object instead of array', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '123', invoice_items: '{"account":1}' })),
    ).rejects.toThrow('invoice_items must be a JSON array');
  });

  it('throws when invoice_items is a JSON string instead of array', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '123', invoice_items: '"just a string"' })),
    ).rejects.toThrow('invoice_items must be a JSON array');
  });

  it('throws when receipts_add is not valid JSON', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '123', receipts_add: '{broken' })),
    ).rejects.toThrow('receipts_add must be a valid JSON array');
  });

  it('throws when receipts_add is a JSON object instead of array', async () => {
    await expect(
      appTester(
        perform,
        makeBundle({ supplier_code: '123', receipts_add: '{"tempFileId":"abc"}' }),
      ),
    ).rejects.toThrow('receipts_add must be a JSON array');
  });

  it('throws when project_code is not a valid integer', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '123', project_code: 'bad' })),
    ).rejects.toThrow('project_code must be an integer');
  });
});

// ---------------------------------------------------------------------------
// API integration tests — require real credentials and network access
// ---------------------------------------------------------------------------
describe('creates.create_invoice – API integration', () => {
  beforeAll(() => {
    if (!process.env.WORK4ALL_BEARER_TOKEN) {
      throw new Error('WORK4ALL_BEARER_TOKEN is required to run integration tests.');
    }
    if (!process.env.WORK4ALL_MEMBER_CODE) {
      throw new Error('WORK4ALL_MEMBER_CODE is required to run integration tests.');
    }
  });

  it('creates invoice with full header input', async () => {
    const result = await appTester(perform, makeBundle(FULL_INPUT));

    // Required field — always present
    expect(typeof result.code).toBe('number');
    expect(result.code).toBeGreaterThan(0);

    // Supplier echoed back
    expect(result.sDObjMemberCode).toBe(parseInt(FULL_INPUT.supplier_code, 10));

    // Note preserved
    expect(result.notiz).toBe(FULL_INPUT.note);

    // Dates present (backend shifts to UTC so exact value may differ by timezone)
    expect(result.datum).toBeDefined();
    expect(result.eingangsDatum).toBeDefined();
    expect(result.faelligDatum).toBeDefined();
    expect(result.creationDate).toBeDefined();

    // Amounts are numeric (zero when no items provided)
    expect(typeof result.rBetrag).toBe('number');
    expect(typeof result.rMwst).toBe('number');
    expect(typeof result.summe).toBe('number');

    // Supplier invoice number echoed back
    expect(result.rNummerbeiLieferant).toBe(FULL_INPUT.invoice_number_supplier);

    // Discount and payment terms
    expect(result.skontoProzent).toBe(2);
    expect(result.skontoTg).toBe(8);
    expect(result.paymentTermDays).toBe(11);

    // Currency and project
    expect(result.waehrungCode).toBe(1);
    expect(result.projektCode).toBe(parseInt(FULL_INPUT.project_code, 10));

    // buchungen is always an array (empty when no items)
    expect(Array.isArray(result.buchungen)).toBe(true);

    // If WORK4ALL_INVOICE_ITEMS was provided, assert line items are populated
    if (process.env.WORK4ALL_INVOICE_ITEMS) {
      const expectedCount = JSON.parse(process.env.WORK4ALL_INVOICE_ITEMS).length;
      expect(result.buchungen.length).toBe(expectedCount);
      if (result.buchungen.length > 0) {
        const line = result.buchungen[0];
        expect(typeof line.code).toBe('number');
        expect(typeof line.valueNet).toBe('number');
      }
    }
  }, 15000);

  it('creates invoice with invoice_items passed as a pre-parsed array (Zapier passthrough)', async () => {
    // Zapier sometimes passes already-parsed arrays from upstream steps instead of JSON strings
    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: 'Array passthrough test',
        invoice_items: [],
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(Array.isArray(result.buchungen)).toBe(true);
  }, 15000);

  it('returns all expected output field keys', async () => {
    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: 'Output field shape test',
        invoice_items: '[]',
      }),
    );

    const expectedKeys = [
      'code',
      'rNummer',
      'notiz',
      'sDObjMemberCode',
      'rBetrag',
      'rMwst',
      'summe',
      'statusCode',
      'creationDate',
      'buchungen',
    ];
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  }, 15000);
});
