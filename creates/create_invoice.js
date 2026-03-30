const JSZip = require('jszip');
const { getAccessToken } = require('../utils/auth');

const perform = async (z, bundle) => {
  var input = {};

  const rawJson = bundle.inputData.invoice_data_json;
  if (rawJson != null && String(rawJson).trim()) {
    // ── JSON mode: single JSON blob — ideal for LLM output ─────────────────
    var parsed;
    try {
      parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    } catch (e) {
      throw new Error('invoice_data_json must be valid JSON. ' + e.message);
    }
    const hasSupplierInJson =
      parsed.supplierCode != null ||
      parsed.supplierName != null ||
      parsed.supplierCustomerNumberAtSupplier != null ||
      parsed.supplierContactMailAddress != null ||
      parsed.supplierIban != null;
    if (!hasSupplierInJson) {
      throw new Error(
        'invoice_data_json must include at least one supplier field: supplierCode, supplierName, ' +
          'supplierCustomerNumberAtSupplier, supplierContactMailAddress, or supplierIban.',
      );
    }
    const { invoiceItems: jsonItems, ...rest } = parsed;
    Object.assign(input, rest);
    input.invoiceItems = Array.isArray(jsonItems) ? jsonItems : [];
  } else {
    // ── Form fields mode ────────────────────────────────────────────────────
    const hasSupplier =
      bundle.inputData.supplier_code != null ||
      bundle.inputData.supplier_name != null ||
      bundle.inputData.supplier_customer_number_at_supplier != null ||
      bundle.inputData.supplier_contact_mail_address != null ||
      bundle.inputData.supplier_iban != null;

    if (!hasSupplier) {
      throw new Error(
        'At least one supplier field is required: supplier_code, supplier_name, ' +
          'supplier_customer_number_at_supplier, supplier_contact_mail_address, or supplier_iban.',
      );
    }

    // Supplier fields (server resolves in priority order: Code > Name > CustomerNumber > Email > IBAN)
    if (bundle.inputData.supplier_code != null)
      input.supplierCode = parseInt(bundle.inputData.supplier_code, 10);
    if (bundle.inputData.supplier_name != null)
      input.supplierName = String(bundle.inputData.supplier_name);
    if (bundle.inputData.supplier_customer_number_at_supplier != null)
      input.supplierCustomerNumberAtSupplier = String(
        bundle.inputData.supplier_customer_number_at_supplier,
      );
    if (bundle.inputData.supplier_contact_mail_address != null)
      input.supplierContactMailAddress = String(bundle.inputData.supplier_contact_mail_address);
    if (bundle.inputData.supplier_iban != null)
      input.supplierIban = String(bundle.inputData.supplier_iban);

    // Project fields (server resolves in priority order: Code > Number > Name)
    if (bundle.inputData.project_code != null) {
      var pc = parseInt(bundle.inputData.project_code, 10);
      if (Number.isNaN(pc)) throw new Error('project_code must be an integer');
      input.projectCode = pc;
    }
    if (bundle.inputData.project_number != null)
      input.projectNumber = String(bundle.inputData.project_number);
    if (bundle.inputData.project_name != null)
      input.projectName = String(bundle.inputData.project_name);

    if (bundle.inputData.note != null) input.note = String(bundle.inputData.note);
    if (bundle.inputData.invoice_number_supplier != null)
      input.invoiceNumberSupplier = String(bundle.inputData.invoice_number_supplier);
    if (bundle.inputData.invoice_date != null) input.invoiceDate = bundle.inputData.invoice_date;
    if (bundle.inputData.entry_date != null) input.entryDate = bundle.inputData.entry_date;
    if (bundle.inputData.receipt_date != null) input.receiptDate = bundle.inputData.receipt_date;
    if (bundle.inputData.payment_term_days != null)
      input.paymentTermDays = parseInt(bundle.inputData.payment_term_days, 10);
    if (bundle.inputData.discount1_days != null)
      input.discount1Days = parseInt(bundle.inputData.discount1_days, 10);
    if (bundle.inputData.discount1_rate != null)
      input.discount1Rate = parseFloat(bundle.inputData.discount1_rate);
    if (bundle.inputData.discount2_days != null)
      input.discount2Days = parseInt(bundle.inputData.discount2_days, 10);
    if (bundle.inputData.discount2_rate != null)
      input.discount2Rate = parseFloat(bundle.inputData.discount2_rate);
    if (bundle.inputData.currency_code != null)
      input.currencyCode = parseInt(bundle.inputData.currency_code, 10);

    // The work4all backend throws NullReferenceException when invoiceItems is
    // omitted from the mutation, so we always send at least an empty array.
    var rawItems = bundle.inputData.invoice_items != null ? bundle.inputData.invoice_items : [];
    var parsedItems;
    try {
      parsedItems = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
    } catch (e) {
      throw new Error(
        'invoice_items must be a valid JSON array of position objects. ' + e.message,
      );
    }
    if (!Array.isArray(parsedItems)) {
      throw new Error('invoice_items must be a JSON array.');
    }
    input.invoiceItems = parsedItems.map(function (item) {
      var pos = {};
      if (item.account != null) pos.account = parseInt(item.account, 10);
      if (item.costCenter != null) pos.costCenter = parseInt(item.costCenter, 10);
      if (item.costGroup != null) pos.costGroup = parseInt(item.costGroup, 10);
      if (item.projectCode != null) pos.projectCode = parseInt(item.projectCode, 10);
      if (item.taxCode != null) pos.taxCode = parseInt(item.taxCode, 10);
      if (item.taxRate != null) pos.taxRate = parseFloat(item.taxRate);
      if (item.netAmount != null) pos.netAmount = parseFloat(item.netAmount);
      if (item.grossAmount != null) pos.grossAmount = parseFloat(item.grossAmount);
      if (item.vatAmount != null) pos.vatAmount = parseFloat(item.vatAmount);
      if (item.note != null) pos.note = String(item.note);
      return pos;
    });
  }

  // ── Authenticate ───────────────────────────────────────────────────────────
  const baseUrl = String(bundle.authData.base_url).replace(/\/$/, '');
  const accessToken = await getAccessToken(
    bundle.authData.token_url,
    bundle.authData.client_id,
    bundle.authData.client_secret,
  );
  const endpoint = baseUrl + '/graphql';

  // ── Receipt file uploads ───────────────────────────────────────────────────
  var receipts;
  if (bundle.inputData.receipt_file_urls != null) {
    var fileUrls = Array.isArray(bundle.inputData.receipt_file_urls)
      ? bundle.inputData.receipt_file_urls
      : [bundle.inputData.receipt_file_urls];

    fileUrls = fileUrls.map(function (u) { return String(u).trim(); }).filter(Boolean);

    if (fileUrls.length > 0) {
      var fileUploadUrl = baseUrl + '/api/file?type=TempDatei';

      // Uploads a single Blob to work4all and returns { tempFileId }.
      async function uploadBlob(blob, name) {
        var form = new FormData();
        form.append('myFile', blob, name);
        var uploadResponse = await fetch(fileUploadUrl, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + accessToken },
          body: form,
        });
        if (!uploadResponse.ok) {
          throw new Error(
            'File upload failed for "' + name + '" (HTTP ' + uploadResponse.status + ')',
          );
        }
        var uploadJson = await uploadResponse.json();
        if (!uploadJson.fileStored || !uploadJson.generatedObject) {
          throw new Error(
            'File upload rejected for "' + name + '": ' +
              (uploadJson.errorMessage || JSON.stringify(uploadJson)),
          );
        }
        return { tempFileId: String(uploadJson.generatedObject) };
      }

      var uploadedFiles = [];
      for (var fi = 0; fi < fileUrls.length; fi++) {
        var fileUrl = fileUrls[fi];

        // Download using native fetch (not z.request) so no Authorization header
        // is added — pre-signed S3 URLs are self-authenticating and S3 rejects
        // requests that carry an extra Authorization header.
        var fileResp = await fetch(fileUrl);
        if (!fileResp.ok) {
          throw new Error(
            'Failed to download file "' + fileUrl + '" (HTTP ' + fileResp.status + ')',
          );
        }

        // Resolve the filename: prefer Content-Disposition (Zapier S3 sets this to
        // the original filename), fall back to the URL path segment, then append
        // the correct extension from Content-Type when the path has none.
        var filename = '';
        var contentDisposition = fileResp.headers.get('content-disposition') || '';
        var cdMatch = contentDisposition.match(/filename[^;=\n]*=(?:(['"])([^'"]*)\1|([^;\n]*))/);
        if (cdMatch) {
          filename = (cdMatch[2] || cdMatch[3] || '').trim();
        }
        if (!filename) {
          var urlPath = fileUrl.split('?')[0];
          filename = urlPath.split('/').pop() || 'attachment';
        }
        var ct = fileResp.headers.get('content-type') || '';
        if (!filename.includes('.')) {
          if (ct.includes('pdf')) filename += '.pdf';
          else if (ct.includes('xml')) filename += '.xml';
          else if (ct.includes('jpeg') || ct.includes('jpg')) filename += '.jpg';
          else if (ct.includes('png')) filename += '.png';
          else if (ct.includes('zip')) filename += '.zip';
        }

        var isZip =
          filename.toLowerCase().endsWith('.zip') ||
          ct.includes('zip');

        if (isZip) {
          // Extract ZIP and upload each contained file individually.
          var zipBuffer = await fileResp.arrayBuffer();
          var zip = await JSZip.loadAsync(zipBuffer);
          var entries = Object.values(zip.files).filter(function (e) {
            if (e.dir) return false;
            var base = e.name.split('/').pop() || '';
            // Skip macOS resource-fork files (__MACOSX/ folder and ._* entries)
            if (e.name.startsWith('__MACOSX/')) return false;
            if (base.startsWith('._')) return false;
            return true;
          });
          if (entries.length === 0) {
            throw new Error('ZIP archive "' + filename + '" contains no files.');
          }
          for (var ei = 0; ei < entries.length; ei++) {
            var entry = entries[ei];
            var entryName = entry.name.split('/').pop() || entry.name;
            var entryBuffer = await entry.async('arraybuffer');
            var entryBlob = new Blob([entryBuffer]);
            uploadedFiles.push(await uploadBlob(entryBlob, entryName));
          }
        } else {
          // Regular file: read as Blob (preserves MIME type, avoids Buffer→Blob issues).
          var fileBlob = await fileResp.blob();
          uploadedFiles.push(await uploadBlob(fileBlob, filename));
        }
      }

      receipts = { add: uploadedFiles };
    }
  }

  var mutation = `
    mutation CreateCompleteIncomingInvoice(
      $input: InputCompleteIncomingInvoice!
      $receipts: InputErpAnhangAttachementsRelation
    ) {
      ahf_CreateCompleteIncomingInvoice(input: $input, receipts: $receipts) {
        code
        rNummer
        rNummerbeiLieferant
        datum
        eingangsDatum
        faelligDatum
        buchungsDatum
        notiz
        sDObjMemberCode
        projektCode
        rBetrag
        rMwst
        summe
        waehrungCode
        paymentTermDays
        skontoProzent
        skontoTg
        statusCode
        creationDate
        buchungen {
          code
          sachkontoCode
          sachkontoNummer
          kostenstelleCode
          kostenstelleNummer
          kostengruppeCode
          projektCode
          steuerschluessel
          mwst
          valueNet
          mwstBetrag
          anteilDM
          notiz
        }
        lieferant { code nummer name }
        projekt { code nummer name }
      }
    }
  `;

  var variables = { input: input };
  if (receipts) variables.receipts = receipts;

  var options = {
    url: endpoint,
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      operationName: 'CreateCompleteIncomingInvoice',
      query: mutation,
      variables: variables,
    }),
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

    return json.data.ahf_CreateCompleteIncomingInvoice;
  });
};

module.exports = {
  operation: {
    perform: perform,
    sample: {
      code: 1582980996,
      rNummer: 250291,
      rNummerbeiLieferant: 'xy1234-4022',
      datum: '2026-02-12T23:00:00.000Z',
      eingangsDatum: '2026-02-16T23:00:00.000Z',
      faelligDatum: '2026-02-23T23:00:00.000Z',
      buchungsDatum: null,
      notiz: 'Internal invoice note',
      sDObjMemberCode: 1245558295,
      projektCode: 1610906012,
      rBetrag: 219.0,
      rMwst: 19.0,
      summe: 219.0,
      waehrungCode: 1,
      paymentTermDays: 11,
      skontoProzent: 2,
      skontoTg: 8,
      statusCode: 0,
      creationDate: '2026-03-02T12:22:20.840Z',
      buchungen: [
        {
          code: 1,
          sachkontoCode: 4500,
          sachkontoNummer: '4500',
          kostenstelleCode: 1000,
          kostenstelleNummer: '1000',
          kostengruppeCode: 1178852147,
          projektCode: 1610906012,
          steuerschluessel: 9,
          mwst: 19.0,
          valueNet: 100.0,
          mwstBetrag: 19.0,
          anteilDM: 119.0,
          notiz: 'Test',
        },
      ],
      lieferant: { code: 1245558295, nummer: 70361, name: 'TO Test' },
      projekt: { code: 1610906012, nummer: 'P-001', name: 'Test Project' },
    },
    outputFields: [
      { key: 'code', label: 'Invoice Code', type: 'integer' },
      { key: 'rNummer', label: 'Invoice Number', type: 'integer' },
      { key: 'rNummerbeiLieferant', label: 'Supplier Invoice Number', type: 'string' },
      { key: 'datum', label: 'Invoice Date', type: 'datetime' },
      { key: 'eingangsDatum', label: 'Receipt Date', type: 'datetime' },
      { key: 'faelligDatum', label: 'Due Date', type: 'datetime' },
      { key: 'buchungsDatum', label: 'Posting Date', type: 'datetime' },
      { key: 'notiz', label: 'Note', type: 'string' },
      { key: 'sDObjMemberCode', label: 'Supplier Internal Code', type: 'integer' },
      { key: 'projektCode', label: 'Project Code', type: 'integer' },
      { key: 'rBetrag', label: 'Invoice Amount (Gross)', type: 'number' },
      { key: 'rMwst', label: 'VAT Amount', type: 'number' },
      { key: 'summe', label: 'Total Sum', type: 'number' },
      { key: 'waehrungCode', label: 'Currency Code', type: 'integer' },
      { key: 'paymentTermDays', label: 'Payment Term (Days)', type: 'integer' },
      { key: 'skontoProzent', label: 'Discount 1 Rate (%)', type: 'number' },
      { key: 'skontoTg', label: 'Discount 1 Days', type: 'integer' },
      { key: 'statusCode', label: 'Status Code', type: 'integer' },
      { key: 'creationDate', label: 'Creation Date', type: 'datetime' },
      { key: 'buchungen[]code', label: 'Line Item: Code', type: 'integer' },
      { key: 'buchungen[]sachkontoCode', label: 'Line Item: Account Code', type: 'integer' },
      { key: 'buchungen[]sachkontoNummer', label: 'Line Item: Account Number', type: 'string' },
      { key: 'buchungen[]kostenstelleCode', label: 'Line Item: Cost Center Code', type: 'integer' },
      { key: 'buchungen[]kostenstelleNummer', label: 'Line Item: Cost Center Number', type: 'string' },
      { key: 'buchungen[]kostengruppeCode', label: 'Line Item: Cost Group Code', type: 'integer' },
      { key: 'buchungen[]projektCode', label: 'Line Item: Project Code', type: 'integer' },
      { key: 'buchungen[]steuerschluessel', label: 'Line Item: Tax Code', type: 'integer' },
      { key: 'buchungen[]mwst', label: 'Line Item: Tax Rate (%)', type: 'number' },
      { key: 'buchungen[]valueNet', label: 'Line Item: Net Amount', type: 'number' },
      { key: 'buchungen[]mwstBetrag', label: 'Line Item: VAT Amount', type: 'number' },
      { key: 'buchungen[]anteilDM', label: 'Line Item: Gross Amount', type: 'number' },
      { key: 'buchungen[]notiz', label: 'Line Item: Note', type: 'string' },
      { key: 'lieferant__code', label: 'Supplier: Code', type: 'integer' },
      { key: 'lieferant__nummer', label: 'Supplier: Number', type: 'integer' },
      { key: 'lieferant__name', label: 'Supplier: Name', type: 'string' },
      { key: 'projekt__code', label: 'Project: Code', type: 'integer' },
      { key: 'projekt__nummer', label: 'Project: Number', type: 'string' },
      { key: 'projekt__name', label: 'Project: Name', type: 'string' },
    ],
    inputFields: [
      {
        key: 'invoice_data_json',
        label: 'Invoice Data',
        helpText:
          'Provide all invoice data as a single JSON object — ideal for LLM output. ' +
          'When filled, all individual fields below are ignored. ' +
          'Field names use camelCase and match the work4all API directly. ' +
          'Example: {"supplierCode":123,"invoiceNumberSupplier":"INV-001","invoiceDate":"2026-01-15T00:00:00Z",' +
          '"invoiceItems":[{"account":4500,"taxRate":19,"netAmount":100,"grossAmount":119,"vatAmount":19}]}',
        type: 'text',
        required: false,
      },
      {
        key: 'supplier_code',
        label: 'Supplier Code',
        helpText:
          'Internal work4all supplier code. Takes priority over all other supplier lookup fields.',
        type: 'integer',
        required: false,
      },
      {
        key: 'supplier_name',
        label: 'Supplier Name',
        helpText: 'Look up supplier by name. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'supplier_customer_number_at_supplier',
        label: 'Customer Number at Supplier',
        helpText: 'Your own customer number at this supplier. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'supplier_contact_mail_address',
        label: 'Supplier Contact Email',
        helpText: 'Email address of the supplier or one of their contacts. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'supplier_iban',
        label: 'Supplier IBAN',
        helpText: 'IBAN of the supplier. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'note',
        label: 'Note',
        helpText: 'Internal note for the invoice.',
        type: 'string',
        required: false,
      },
      {
        key: 'invoice_number_supplier',
        label: 'Invoice Number (Supplier)',
        helpText: "The supplier's own invoice number.",
        type: 'string',
        required: false,
      },
      {
        key: 'invoice_date',
        label: 'Invoice Date',
        helpText: 'Date on the invoice (ISO 8601).',
        type: 'datetime',
        required: false,
      },
      {
        key: 'entry_date',
        label: 'Entry Date',
        helpText: 'Date the invoice was entered.',
        type: 'datetime',
        required: false,
      },
      {
        key: 'receipt_date',
        label: 'Receipt Date',
        helpText: 'Date the invoice was received.',
        type: 'datetime',
        required: false,
      },
      {
        key: 'project_code',
        label: 'Project Code',
        helpText:
          'Internal work4all project code. Takes priority over project number and name.',
        type: 'integer',
        required: false,
      },
      {
        key: 'project_number',
        label: 'Project Number',
        helpText: 'Human-readable project number. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'project_name',
        label: 'Project Name',
        helpText: 'Project name. Match must be unique.',
        type: 'string',
        required: false,
      },
      {
        key: 'payment_term_days',
        label: 'Payment Term (Days)',
        helpText: 'Number of days until payment is due.',
        type: 'integer',
        required: false,
      },
      {
        key: 'discount1_days',
        label: 'Discount 1 – Days',
        helpText: 'Number of days within which discount 1 applies.',
        type: 'integer',
        required: false,
      },
      {
        key: 'discount1_rate',
        label: 'Discount 1 – Rate (%)',
        helpText: 'Discount 1 percentage rate.',
        type: 'number',
        required: false,
      },
      {
        key: 'discount2_days',
        label: 'Discount 2 – Days',
        helpText: 'Number of days within which discount 2 applies.',
        type: 'integer',
        required: false,
      },
      {
        key: 'discount2_rate',
        label: 'Discount 2 – Rate (%)',
        helpText: 'Discount 2 percentage rate.',
        type: 'number',
        required: false,
      },
      {
        key: 'currency_code',
        label: 'Currency Code',
        helpText: 'Internal currency code.',
        type: 'integer',
        required: false,
      },
      {
        key: 'invoice_items',
        label: 'Invoice Line Items',
        helpText:
          'Optional list of invoice positions as a JSON array. Each item may contain: ' +
          'account (Int), costCenter (Int), costGroup (Int), projectCode (Int), ' +
          'taxCode (Int), taxRate (Float), netAmount (Decimal), grossAmount (Float), ' +
          'vatAmount (Float), note (String). ' +
          'Example: [{"account":4500,"costCenter":1000,"taxCode":9,"taxRate":19,"netAmount":100,"grossAmount":119,"vatAmount":19,"note":"Test"}]',
        type: 'text',
        required: false,
      },
      {
        key: 'receipt_file_urls',
        label: 'Receipt File URLs',
        helpText:
          'One or more URLs of files to attach to the invoice (e.g. a PDF from a previous ' +
          'step). Each file is automatically uploaded to work4all and linked as a receipt ' +
          'attachment. ZIP archives are extracted and each contained file is uploaded individually. ' +
          'You can map multiple values using Zapier line items.',
        type: 'string',
        required: false,
        list: true,
      },
    ],
  },
  display: {
    description: 'Creates a complete incoming invoice in work4all.',
    hidden: false,
    label: 'Create Invoice',
  },
  key: 'create_invoice',
  noun: 'Invoice',
};
