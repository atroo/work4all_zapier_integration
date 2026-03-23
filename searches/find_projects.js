const { getAccessToken } = require('../utils/auth');

const GQL_GET_PROJEKTE = `
  query getProjekte($querySize: Int, $queryPage: Int, $filter: String) {
    getProjekte(querySize: $querySize, queryPage: $queryPage, querySortBy: "name", querySortOrder: ASCENDING, filter: $filter) {
      total
      size
      page
      data {
        id: code
        name
        number: nummer
        startDateInner: anfangDatum
        startDateOuter: vonDatum
        endDateInner: endeDatum
        endDateOuter: bisDatum
        customerId: kundenCode
        customer: kunde {
          id: code
          name
          number: nummer
          website: interNet
          mainContact: hauptansprechpartner {
            id: code
            displayName: anzeigename
          }
        }
        supplierId: lieferantenCode
        supplier: lieferant {
          id: code
          name
          number: nummer
          website: interNet
          mainContact: hauptansprechpartner {
            id: code
            displayName: anzeigename
          }
        }
        projectProcessList: projectSteps {
          id: code
          process: vorgang
          duration: dauer
          startDatum
          endDateInner: endeDatum
          parentId: parentCode
          comment: bemerkung
          kindId: art
          isClosed: abgeschlossen
          number: nummer
          planningAmount: planungsAnzahl
          planningCosts: planKosten
          ressource
          projectId: projektCode
          ressourceClassId: ressourcenKlasseCode
          index
          ressourceClass: ressourcenKlasse {
            id: code
            color: farbe
            name
            hexColorPair
          }
        }
      }
    }
  }
`;

const perform = async (z, bundle) => {
  const baseUrl = String(bundle.authData.base_url).replace(/\/$/, '');
  const accessToken = await getAccessToken(
    bundle.authData.token_url,
    bundle.authData.client_id,
    bundle.authData.client_secret,
  );

  const querySize = parseInt(bundle.inputData.query_size || 100, 10);
  const queryPage = parseInt(bundle.inputData.query_page || 1, 10);
  const filterRaw = bundle.inputData.filter || '';

  const variables = { querySize, queryPage };
  if (filterRaw.trim()) variables.filter = filterRaw;

  return z.request({
    url: baseUrl + '/graphql',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: GQL_GET_PROJEKTE, variables }),
  }).then(function (response) {
    const json = response.json || JSON.parse(response.content);
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
    }
    // Return the paginated response as a single result so callers can access
    // total, size, page, and data in subsequent Zap steps.
    return [json.data.getProjekte];
  });
};

const SAMPLE = {
  total: 12,
  size: 10,
  page: 1,
  data: [
    {
      id: 1610906012,
      name: 'Test Project',
      number: 'P-001',
      startDateInner: '2026-01-01T00:00:00Z',
      startDateOuter: null,
      endDateInner: null,
      endDateOuter: null,
      customerId: 123456789,
      customer: null,
      supplierId: null,
      supplier: null,
      projectProcessList: [],
    },
  ],
};

module.exports = {
  key: 'find_projects',
  noun: 'Projects',
  display: {
    label: 'Find Projects',
    description: 'Returns a paginated list of projects from work4all.',
    hidden: false,
  },
  operation: {
    perform,
    sample: SAMPLE,
    outputFields: [
      { key: 'total', label: 'Total Projects', type: 'integer' },
      { key: 'size', label: 'Page Size', type: 'integer' },
      { key: 'page', label: 'Current Page', type: 'integer' },
    ],
    inputFields: [
      {
        key: 'query_size',
        label: 'Page Size',
        type: 'integer',
        required: false,
        default: '100',
        helpText: 'Number of projects to return per page.',
      },
      {
        key: 'query_page',
        label: 'Page',
        type: 'integer',
        required: false,
        default: '1',
        helpText: 'Page number (1-based).',
      },
      {
        key: 'filter',
        label: 'Filter (JSON)',
        type: 'text',
        required: false,
        helpText: 'Optional filter as a JSON array, e.g. [{"name":{"$eq":"My Project"}}]',
        placeholder: '[{"name":{"$eq":"My Project"}}]',
      },
    ],
  },
};
