const JSZip = require('jszip');

const perform = async (z, bundle) => {
  var endpoint = 'https://backend-dev.work4alltest.work4allcloud.de/graphql';

  var supplierNumber = bundle.inputData.supplier_number;
  var supplierName = bundle.inputData.supplier_name;

  if (supplierNumber == null && supplierName == null) {
    throw new Error('Either supplier_number or supplier_name is required');
  }

  // ── Build input (pure validation — no API calls) ───────────────────────────
  var input = {};

  if (bundle.inputData.note != null) input.note = String(bundle.inputData.note);
  if (bundle.inputData.project_code != null) {
    var pc = parseInt(bundle.inputData.project_code, 10);
    if (Number.isNaN(pc)) throw new Error('project_code must be an integer');
    input.projectCode = pc;
  }
  if (bundle.inputData.invoice_number_supplier != null)
    input.invoiceNumberSupplier = String(bundle.inputData.invoice_number_supplier);
  if (bundle.inputData.invoice_date != null)
    input.invoiceDate = bundle.inputData.invoice_date;
  if (bundle.inputData.entry_date != null)
    input.entryDate = bundle.inputData.entry_date;
  if (bundle.inputData.receipt_date != null)
    input.receiptDate = bundle.inputData.receipt_date;
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

  // ── Supplier lookup: resolve nummer/name → internal supplierCode ──────────
  // The work4all API does not support server-side filtering or pagination with
  // the current token permissions — queryPage, filter, and sort are all blocked.
  // We fetch up to SUPPLIER_PAGE_SIZE records and search client-side. If the
  // tenant has more suppliers than this limit, we surface a clear error instead
  // of silently returning a wrong result.
  var SUPPLIER_PAGE_SIZE = 500;

  var supplierResp = await z.request({
    url: endpoint,
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + bundle.authData.bearer_token,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: '{ getLieferanten(querySize: ' + SUPPLIER_PAGE_SIZE + ') { total data { code nummer name firma1 } } }',
    }),
  });

  var supplierJson = supplierResp.json || JSON.parse(supplierResp.content);
  if (supplierJson.errors && supplierJson.errors.length) {
    throw new Error(
      'Failed to fetch suppliers: ' +
        supplierJson.errors.map(function (e) { return e.message; }).join('; '),
    );
  }

  var supplierPage = supplierJson.data.getLieferanten;
  var suppliers = supplierPage.data;

  if (supplierPage.total > SUPPLIER_PAGE_SIZE) {
    throw new Error(
      'Your work4all instance has ' + supplierPage.total + ' suppliers, but the API only ' +
        'allows fetching ' + SUPPLIER_PAGE_SIZE + ' at a time without server-side filtering. ' +
        'Please contact work4all support to enable the queryPage or filter capabilities ' +
        'for your API token, or provide the supplier_id directly.',
    );
  }

  var foundSupplier = null;

  // 1st: match by supplier number (Lieferant.nummer)
  if (supplierNumber != null) {
    var parsedNum = parseInt(String(supplierNumber).trim(), 10);
    if (!Number.isNaN(parsedNum)) {
      foundSupplier = suppliers.find(function (s) { return s.nummer === parsedNum; }) || null;
    }
  }

  // 2nd: fallback — case-insensitive substring match on firma1 or name
  if (!foundSupplier && supplierName != null) {
    var nameLower = String(supplierName).toLowerCase();
    foundSupplier =
      suppliers.find(function (s) {
        return (
          (s.firma1 && s.firma1.toLowerCase().includes(nameLower)) ||
          (s.name && s.name.toLowerCase().includes(nameLower))
        );
      }) || null;
  }

  if (!foundSupplier) {
    var searchDesc =
      supplierNumber != null
        ? 'supplier_number=' + supplierNumber
        : 'supplier_name=' + supplierName;
    throw new Error(
      'No supplier found for ' + searchDesc + '. ' +
        'Please verify the supplier number or name in work4all.',
    );
  }

  input.supplierCode = foundSupplier.code;

  var receipts;
  if (bundle.inputData.receipt_file_urls != null) {
    var fileUrls = Array.isArray(bundle.inputData.receipt_file_urls)
      ? bundle.inputData.receipt_file_urls
      : [bundle.inputData.receipt_file_urls];

    fileUrls = fileUrls.map(function (u) { return String(u).trim(); }).filter(Boolean);

    if (fileUrls.length > 0) {
      var fileUploadUrl =
        endpoint.replace('/graphql', '') + '/api/file?type=TempDatei';

      // Uploads a single Blob to work4all and returns { tempFileId }.
      async function uploadBlob(blob, name) {
        var form = new FormData();
        form.append('myFile', blob, name);
        var uploadResponse = await fetch(fileUploadUrl, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + bundle.authData.bearer_token },
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
          kostenstelleCode
          kostengruppeCode
          projektCode
          steuerschluessel
          mwst
          valueNet
          mwstBetrag
          anteilDM
          notiz
        }
      }
    }
  `;

  var variables = { input: input };
  if (receipts) variables.receipts = receipts;

  var options = {
    url: endpoint,
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + bundle.authData.bearer_token,
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
      notiz: 'Eingangsrechnungs-Notiz',
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
          kostenstelleCode: 1000,
          kostengruppeCode: 1178852147,
          projektCode: 1610906012,
          steuerschluessel: 9,
          mwst: 19.0,
          valueNet: 100.0,
          mwstBetrag: 19.0,
          anteilDM: 119.0,
          notiz: 'Test n8n',
        },
        {
          code: 2,
          sachkontoCode: 0,
          kostenstelleCode: 0,
          kostengruppeCode: 0,
          projektCode: 0,
          steuerschluessel: 0,
          mwst: 0.0,
          valueNet: 100.0,
          mwstBetrag: 0.0,
          anteilDM: 100.0,
          notiz: null,
        },
      ],
    },
    outputFields: [
      { key: 'code', label: 'Invoice Code', type: 'integer' },
      { key: 'rNummer', label: 'Invoice Number', type: 'integer' },
      { key: 'rNummerbeiLieferant', label: 'Supplier Invoice Number', type: 'string' },
      { key: 'datum', label: 'Invoice Date', type: 'datetime' },
      { key: 'eingangsDatum', label: 'Receipt Date', type: 'datetime' },
      { key: 'faelligDatum', label: 'Due Date', type: 'datetime' },
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
      { key: 'buchungen[]kostenstelleCode', label: 'Line Item: Cost Center Code', type: 'integer' },
      { key: 'buchungen[]kostengruppeCode', label: 'Line Item: Cost Group Code', type: 'integer' },
      { key: 'buchungen[]projektCode', label: 'Line Item: Project Code', type: 'integer' },
      { key: 'buchungen[]steuerschluessel', label: 'Line Item: Tax Code', type: 'integer' },
      { key: 'buchungen[]mwst', label: 'Line Item: Tax Rate (%)', type: 'number' },
      { key: 'buchungen[]valueNet', label: 'Line Item: Net Amount', type: 'number' },
      { key: 'buchungen[]mwstBetrag', label: 'Line Item: VAT Amount', type: 'number' },
      { key: 'buchungen[]anteilDM', label: 'Line Item: Gross Amount', type: 'number' },
      { key: 'buchungen[]notiz', label: 'Line Item: Note', type: 'string' },
    ],
    inputFields: [
      {
        key: 'supplier_number',
        label: 'Supplier Number',
        helpText:
          'The human-readable supplier number (Lieferantennummer) as shown in work4all. ' +
          'The integration looks up the internal supplier ID automatically.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'supplier_name',
        label: 'Supplier Name (Fallback)',
        helpText:
          'Company name of the supplier. Used as a fallback if no match is found by ' +
          'Supplier Number. Case-insensitive substring match against firma1 and name.',
        type: 'string',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'note',
        label: 'Note',
        helpText: 'Internal note for the invoice.',
        type: 'string',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'invoice_number_supplier',
        label: 'Invoice Number (Supplier)',
        helpText: "The supplier's own invoice number.",
        type: 'string',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'invoice_date',
        label: 'Invoice Date',
        helpText: 'Date on the invoice (ISO 8601).',
        type: 'datetime',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'entry_date',
        label: 'Entry Date',
        helpText: 'Date the invoice was entered.',
        type: 'datetime',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'receipt_date',
        label: 'Receipt Date',
        helpText: 'Date the invoice was received.',
        type: 'datetime',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'project_code',
        label: 'Project Code',
        helpText: 'Code of the project to assign this invoice to.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'payment_term_days',
        label: 'Payment Term (Days)',
        helpText: 'Number of days until payment is due.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'discount1_days',
        label: 'Discount 1 – Days',
        helpText: 'Number of days within which discount 1 applies.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'discount1_rate',
        label: 'Discount 1 – Rate (%)',
        helpText: 'Discount 1 percentage rate.',
        type: 'number',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'discount2_days',
        label: 'Discount 2 – Days',
        helpText: 'Number of days within which discount 2 applies.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'discount2_rate',
        label: 'Discount 2 – Rate (%)',
        helpText: 'Discount 2 percentage rate.',
        type: 'number',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'currency_code',
        label: 'Currency Code',
        helpText: 'Internal currency code.',
        type: 'integer',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'invoice_items',
        label: 'Invoice Line Items (JSON)',
        helpText:
          'Optional list of invoice positions as a JSON array. Each item may contain: ' +
          'account (Int), costCenter (Int), costGroup (Int), projectCode (Int), ' +
          'taxCode (Int), taxRate (Float), netAmount (Decimal), grossAmount (Float), ' +
          'vatAmount (Float), note (String). ' +
          'Example: [{"account":4500,"costCenter":1000,"taxCode":9,"taxRate":19,"netAmount":100,"grossAmount":119,"vatAmount":19,"note":"Test"}]',
        type: 'text',
        required: false,
        list: false,
        altersDynamicFields: false,
      },
      {
        key: 'receipt_file_urls',
        label: 'Receipt File URLs',
        helpText:
          'One or more URLs of files to attach to the invoice (e.g. a PDF from a previous ' +
          'step). Each file is automatically uploaded to work4all and linked as a receipt ' +
          'attachment. You can map multiple values using Zapier line items.',
        type: 'string',
        required: false,
        list: true,
        altersDynamicFields: false,
      },
    ],
  },
  display: {
    description:
      'Creates a complete incoming invoice in a single atomic call using ahf_CreateCompleteIncomingInvoice.',
    hidden: false,
    label: 'Create Invoice',
  },
  key: 'create_invoice',
  noun: 'Invoice',
};
