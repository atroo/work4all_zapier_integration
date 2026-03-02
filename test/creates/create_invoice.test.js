const fs = require('fs');
const http = require('http');
const path = require('path');

const zapier = require('zapier-platform-core');

const App = require('../../index');
const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const perform = App.creates['create_invoice'].operation.perform;

const RECEIPTS_DIR = path.join(__dirname, '../../data/receipts');

// Use WORK4ALL_SUPPLIER_CODE if set, otherwise fall back to WORK4ALL_MEMBER_CODE,
// otherwise use the known-good supplier from the backend developer's sample.
// NOTE: the supplier must exist as a Lieferant in the work4all test instance —
// a plain member/contact code will cause a ValidationError.
const SUPPLIER_CODE =
  process.env.WORK4ALL_SUPPLIER_CODE ||
  process.env.WORK4ALL_MEMBER_CODE ||
  '1245558295';

// Use today's date so test invoices are easy to find and delete in work4all.
const TODAY = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

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
  invoice_date: TODAY,
  entry_date: TODAY,
  receipt_date: TODAY,
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

  it('throws when a receipt_file_url is unreachable', async () => {
    await expect(
      appTester(
        perform,
        makeBundle({
          supplier_code: '123',
          receipt_file_urls: ['https://invalid.example.invalid/file.pdf'],
        }),
      ),
    ).rejects.toThrow();
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
  // Local HTTP server that serves files from data/receipts/ so the perform
  // function can download them via URL (as it would in a real Zapier zap).
  let fileServer;
  let fileServerPort;

  beforeAll(async () => {
    if (!process.env.WORK4ALL_BEARER_TOKEN) {
      throw new Error('WORK4ALL_BEARER_TOKEN is required to run integration tests.');
    }
    if (!process.env.WORK4ALL_MEMBER_CODE) {
      throw new Error('WORK4ALL_MEMBER_CODE is required to run integration tests.');
    }

    await new Promise((resolve) => {
      fileServer = http.createServer((req, res) => {
        const filename = decodeURIComponent(req.url.slice(1));
        const filePath = path.join(RECEIPTS_DIR, filename);
        try {
          const data = fs.readFileSync(filePath);
          const ext = path.extname(filename).toLowerCase();
          const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': data.length });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      fileServer.listen(0, '127.0.0.1', () => {
        fileServerPort = fileServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (fileServer) {
      await new Promise((resolve) => fileServer.close(resolve));
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

  it('creates invoice with receipt files from data/receipts/ attached', async () => {
    const files = fs.readdirSync(RECEIPTS_DIR).filter((f) => !f.startsWith('.'));
    expect(files.length).toBeGreaterThan(0);

    const fileUrls = files.map(
      (f) => `http://127.0.0.1:${fileServerPort}/${encodeURIComponent(f)}`,
    );

    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: `Receipt-upload test (${files.length} file(s))`,
        invoice_items: '[]',
        invoice_date: TODAY,
        entry_date: TODAY,
        receipt_date: TODAY,
        receipt_file_urls: fileUrls,
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.sDObjMemberCode).toBe(parseInt(SUPPLIER_CODE, 10));
    // If the upload or the mutation failed, the perform function would have
    // thrown — reaching this assertion means all files were uploaded and
    // linked to the invoice successfully.
  }, 60000);

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
