const fs = require('fs');
const http = require('http');
const path = require('path');

const zapier = require('zapier-platform-core');

const App = require('../../index');
const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const perform = App.creates['create_invoice'].operation.perform;

const RECEIPTS_DIR = path.join(__dirname, '../../data/receipts');

const SUPPLIER_CODE = process.env.W4A_TEST_SUPPLIER_CODE;
const ACCOUNT_CODE = parseInt(process.env.W4A_TEST_ACCOUNT_CODE || '0', 10);

// Use today's date so test invoices are easy to find and delete in work4all.
const TODAY = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');

/** One line item hitting the test account — mirrors the n8n baseItems() helper */
function baseItems() {
  if (!ACCOUNT_CODE) return '[]';
  return JSON.stringify([
    {
      account: ACCOUNT_CODE,
      taxRate: 19,
      netAmount: 10.0,
      grossAmount: 11.9,
      vatAmount: 1.9,
      note: '[Zapier test]',
    },
  ]);
}

const FULL_INPUT = {
  supplier_code: SUPPLIER_CODE,
  note: '[Zapier test] Full header input',
  invoice_number_supplier: `ZAP-${Date.now()}`,
  invoice_date: TODAY,
  entry_date: TODAY,
  receipt_date: TODAY,
  payment_term_days: '11',
  discount1_rate: '2',
  discount1_days: '8',
  discount2_rate: '5',
  discount2_days: '3',
  currency_code: '1',
  invoice_items: baseItems(),
};

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
describe('creates.create_invoice – input validation', () => {
  it('throws when all supplier fields are missing', async () => {
    await expect(
      appTester(perform, makeBundle({ note: 'test' })),
    ).rejects.toThrow('At least one supplier field is required');
  });

  it('throws when all supplier fields are null', async () => {
    await expect(
      appTester(
        perform,
        makeBundle({
          supplier_code: null,
          supplier_name: null,
          supplier_customer_number_at_supplier: null,
          supplier_contact_mail_address: null,
          supplier_iban: null,
        }),
      ),
    ).rejects.toThrow('At least one supplier field is required');
  });

  it('throws when invoice_items is not valid JSON', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '12345', invoice_items: '{broken json' })),
    ).rejects.toThrow('invoice_items must be a valid JSON array');
  });

  it('throws when invoice_items is a JSON object instead of array', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '12345', invoice_items: '{"account":1}' })),
    ).rejects.toThrow('invoice_items must be a JSON array');
  });

  it('throws when invoice_items is a JSON string instead of array', async () => {
    await expect(
      appTester(
        perform,
        makeBundle({ supplier_code: '12345', invoice_items: '"just a string"' }),
      ),
    ).rejects.toThrow('invoice_items must be a JSON array');
  });

  it('throws when project_code is not a valid integer', async () => {
    await expect(
      appTester(perform, makeBundle({ supplier_code: '12345', project_code: 'bad' })),
    ).rejects.toThrow('project_code must be an integer');
  });

  it('throws when invoice_data_json is not valid JSON', async () => {
    await expect(
      appTester(perform, makeBundle({ invoice_data_json: '{broken' })),
    ).rejects.toThrow('invoice_data_json must be valid JSON');
  });

  it('throws when invoice_data_json has no supplier field', async () => {
    await expect(
      appTester(perform, makeBundle({ invoice_data_json: '{"note":"test"}' })),
    ).rejects.toThrow('invoice_data_json must include at least one supplier field');
  });

  it('throws when a receipt_file_url is unreachable', async () => {
    await expect(
      appTester(
        perform,
        makeBundle({
          supplier_code: SUPPLIER_CODE || '12345',
          receipt_file_urls: ['https://invalid.example.invalid/file.pdf'],
        }),
      ),
    ).rejects.toThrow();
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
    const hasCredentials =
      process.env.W4A_BASE_URL &&
      process.env.W4A_API_ACCESS_TOKEN_URL &&
      process.env.W4A_API_CLIENT_ID &&
      process.env.W4A_API_CLIENT_SECRET &&
      process.env.W4A_TEST_SUPPLIER_CODE &&
      process.env.W4A_TEST_ACCOUNT_CODE;

    if (!hasCredentials) {
      throw new Error(
        'W4A_BASE_URL, W4A_API_ACCESS_TOKEN_URL, W4A_API_CLIENT_ID, W4A_API_CLIENT_SECRET, ' +
          'W4A_TEST_SUPPLIER_CODE, and W4A_TEST_ACCOUNT_CODE are required to run integration tests.',
      );
    }

    await new Promise((resolve) => {
      fileServer = http.createServer((req, res) => {
        const filename = decodeURIComponent(req.url.slice(1));
        const filePath = path.join(RECEIPTS_DIR, filename);
        try {
          const data = fs.readFileSync(filePath);
          const ext = path.extname(filename).toLowerCase();
          const mimeTypes = { '.pdf': 'application/pdf', '.xml': 'application/xml', '.zip': 'application/zip' };
          const mimeType = mimeTypes[ext] || 'application/octet-stream';
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

    expect(typeof result.code).toBe('number');
    expect(result.code).toBeGreaterThan(0);

    expect(typeof result.sDObjMemberCode).toBe('number');
    expect(result.sDObjMemberCode).toBeGreaterThan(0);

    expect(result.lieferant).toBeDefined();
    expect(typeof result.lieferant.code).toBe('number');

    expect(result.notiz).toBe(FULL_INPUT.note);

    expect(result.datum).toBeDefined();
    expect(result.eingangsDatum).toBeDefined();
    expect(result.faelligDatum).toBeDefined();
    expect(result.creationDate).toBeDefined();

    expect(typeof result.rBetrag).toBe('number');
    expect(typeof result.rMwst).toBe('number');
    expect(typeof result.summe).toBe('number');

    expect(result.skontoProzent).toBe(2);
    expect(result.skontoTg).toBe(8);
    expect(result.paymentTermDays).toBe(11);
    expect(result.waehrungCode).toBe(1);

    expect(Array.isArray(result.buchungen)).toBe(true);
    if (ACCOUNT_CODE) {
      expect(result.buchungen.length).toBe(1);
      expect(typeof result.buchungen[0].valueNet).toBe('number');
    }
  }, 15000);

  it('creates invoice with invoice_items passed as a pre-parsed array (Zapier passthrough)', async () => {
    // Zapier sometimes passes already-parsed arrays from upstream steps instead of JSON strings
    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: '[Zapier test] Array passthrough',
        invoice_items: [],
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(Array.isArray(result.buchungen)).toBe(true);
  }, 15000);

  it('creates invoice via JSON mode (LLM output path)', async () => {
    const invoiceData = {
      supplierCode: parseInt(SUPPLIER_CODE, 10),
      invoiceNumberSupplier: `ZAP-JSON-${Date.now()}`,
      note: '[Zapier test] JSON mode',
      invoiceDate: TODAY,
      entryDate: TODAY,
      invoiceItems: ACCOUNT_CODE
        ? [{ account: ACCOUNT_CODE, taxRate: 19, netAmount: 10.0, grossAmount: 11.9, vatAmount: 1.9, note: '[Zapier test]' }]
        : [],
    };

    const result = await appTester(
      perform,
      makeBundle({ invoice_data_json: JSON.stringify(invoiceData) }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.lieferant).toBeDefined();
    expect(Array.isArray(result.buchungen)).toBe(true);
  }, 15000);

  // Helper: build a local file server URL for a fixture file
  function fileUrl(filename) {
    return `http://127.0.0.1:${fileServerPort}/${encodeURIComponent(filename)}`;
  }

  // Helper: base bundle for a single-attachment test
  function singleFileBundle(note, filename) {
    return makeBundle({
      supplier_code: SUPPLIER_CODE,
      note,
      invoice_items: baseItems(),
      invoice_date: TODAY,
      receipt_file_urls: [fileUrl(filename)],
    });
  }

  // NOTE: supplierName / supplierContactMailAddress / supplierIban lookup fields may not yet
  // be deployed on the test server — supplierCode is added as fallback until then.
  // Once deployed, remove the supplierCode line.
  it('creates invoice from JSON mode with supplier lookup by name/email/IBAN', async () => {
    const invoiceData = {
      supplierCode: parseInt(SUPPLIER_CODE, 10), // TODO: remove once backend lookup fields are deployed
      supplierName: 'atroo GmbH',
      supplierContactMailAddress: 'info@atroo.de',
      supplierIban: 'DE16100100100937368106',
      invoiceNumberSupplier: `ZAP-LOOKUP-${Date.now()}`,
      note: '[Zapier test] Supplier lookup by name/email/IBAN',
      invoiceDate: TODAY,
      invoiceItems: ACCOUNT_CODE
        ? [{ account: ACCOUNT_CODE, taxRate: 19, netAmount: 10.0, grossAmount: 11.9, vatAmount: 1.9, note: '[Zapier test]' }]
        : [],
    };

    const result = await appTester(
      perform,
      makeBundle({ invoice_data_json: JSON.stringify(invoiceData) }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.lieferant).toBeDefined();
  }, 15000);

  it('creates invoice via JSON mode with one PDF attachment', async () => {
    const invoiceData = {
      supplierCode: parseInt(SUPPLIER_CODE, 10),
      invoiceNumberSupplier: `ZAP-JSON-PDF-${Date.now()}`,
      note: '[Zapier test] JSON mode with PDF',
      invoiceDate: TODAY,
      invoiceItems: ACCOUNT_CODE
        ? [{ account: ACCOUNT_CODE, taxRate: 19, netAmount: 10.0, grossAmount: 11.9, vatAmount: 1.9, note: '[Zapier test]' }]
        : [],
    };

    const result = await appTester(
      perform,
      makeBundle({
        invoice_data_json: JSON.stringify(invoiceData),
        receipt_file_urls: [fileUrl('Teamviewer - normales PDF.pdf')],
      }),
    );

    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with one normal PDF attachment', async () => {
    const result = await appTester(perform, singleFileBundle('[Zapier test] PDF normal', 'Teamviewer - normales PDF.pdf'));
    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with one ZUGFeRD PDF attachment', async () => {
    const result = await appTester(perform, singleFileBundle('[Zapier test] PDF ZUGFeRD', 'Lisa Jäckel - ZUGFeRD.pdf'));
    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with one XRechnung XML attachment', async () => {
    const result = await appTester(perform, singleFileBundle('[Zapier test] XML XRechnung', 'atroo xrechnung.xml'));
    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with multiple PDF attachments', async () => {
    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: '[Zapier test] Multiple PDFs',
        invoice_items: baseItems(),
        invoice_date: TODAY,
        receipt_file_urls: [
          fileUrl('Teamviewer - normales PDF.pdf'),
          fileUrl('Teamviewer - normales Addition.pdf'),
        ],
      }),
    );
    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with non-valid ZUGFeRD PDF (API should still accept the file)', async () => {
    const result = await appTester(perform, singleFileBundle('[Zapier test] PDF invalid ZUGFeRD', 'EMOVA - nicht valides ZUGFeRD.pdf'));
    expect(result.code).toBeGreaterThan(0);
  }, 15000);

  it('creates invoice with form fields and one PDF attachment', async () => {
    const result = await appTester(
      perform,
      makeBundle({
        ...FULL_INPUT,
        invoice_number_supplier: `ZAP-FORM-PDF-${Date.now()}`,
        note: '[Zapier test] Form fields with PDF',
        receipt_file_urls: [fileUrl('Teamviewer - normales PDF.pdf')],
      }),
    );
    expect(result.code).toBeGreaterThan(0);
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
        note: `[Zapier test] Receipt upload (${files.length} file(s))`,
        invoice_items: baseItems(),
        invoice_date: TODAY,
        entry_date: TODAY,
        receipt_date: TODAY,
        receipt_file_urls: fileUrls,
      }),
    );

    expect(result.code).toBeGreaterThan(0);
    expect(result.sDObjMemberCode).toBeGreaterThan(0);
  }, 60000);

  it('extracts a ZIP and uploads each contained file individually', async () => {
    const zipPath = path.join(RECEIPTS_DIR, 'Invoice.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: '[Zapier test] ZIP extraction',
        invoice_items: baseItems(),
        invoice_date: TODAY,
        entry_date: TODAY,
        receipt_date: TODAY,
        receipt_file_urls: [
          `http://127.0.0.1:${fileServerPort}/${encodeURIComponent('Invoice.zip')}`,
        ],
      }),
    );

    expect(result.code).toBeGreaterThan(0);
  }, 60000);

  it('returns all expected output field keys', async () => {
    const result = await appTester(
      perform,
      makeBundle({
        supplier_code: SUPPLIER_CODE,
        note: '[Zapier test] Output field shape',
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
      'lieferant',
    ];
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  }, 15000);
});
