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

  const projectCode = parseInt(bundle.inputData.project_code, 10);
  if (!projectCode || Number.isNaN(projectCode)) {
    throw new Error('Project Code must be a valid number.');
  }

  return z.request({
    url: baseUrl + '/graphql',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'GraphQL-Require-Preflight': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: GQL_GET_PROJEKTE,
      variables: {
        querySize: 1,
        filter: JSON.stringify([{ code: { $in: [projectCode] } }]),
      },
    }),
  }).then(function (response) {
    const json = response.json || JSON.parse(response.content);
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(function (e) { return e.message; }).join('; '));
    }
    // Searches must return an array; empty array means "not found"
    return json.data.getProjekte.data;
  });
};

const SAMPLE = {
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
};

module.exports = {
  key: 'find_project',
  noun: 'Project',
  display: {
    label: 'Find Project',
    description: 'Finds a single project by its internal work4all code.',
    hidden: false,
  },
  operation: {
    perform,
    sample: SAMPLE,
    outputFields: [
      { key: 'id', label: 'Project Code', type: 'integer' },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'number', label: 'Project Number', type: 'string' },
      { key: 'startDateInner', label: 'Start Date (Inner)', type: 'datetime' },
      { key: 'startDateOuter', label: 'Start Date (Outer)', type: 'datetime' },
      { key: 'endDateInner', label: 'End Date (Inner)', type: 'datetime' },
      { key: 'endDateOuter', label: 'End Date (Outer)', type: 'datetime' },
      { key: 'customerId', label: 'Customer Code', type: 'integer' },
      { key: 'supplierId', label: 'Supplier Code', type: 'integer' },
    ],
    inputFields: [
      {
        key: 'project_code',
        label: 'Project Code',
        type: 'integer',
        required: true,
        helpText: 'Internal work4all project code.',
      },
    ],
  },
};
