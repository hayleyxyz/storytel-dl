const { parseArgs } = require('node:util');
const { getToken } = require('./storytel-token.js');

async function search(query, {
  token,
  page,
  searchFor,
  includeFormats,
  includeLanguages,
  kidsMode = false,
  accept = 'application/vnd.storytel.search-v10+json',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Provide a non-empty search query.');
  }
  if (typeof token !== 'string' || !token || /\s/.test(token)) {
    throw new Error('Provide a current STORYTEL_GCP_TOKEN without a bearer prefix or whitespace.');
  }
  const url = new URL('https://api.storytel.net/search/client');
  url.searchParams.set('query', query);
  url.searchParams.set('v2', '');
  url.searchParams.set('kidsMode', String(kidsMode));
  for (const [name, value] of Object.entries({
    page, searchFor, includeFormats, includeLanguages,
  })) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'accept-language': 'en',
        'X-Storytel-Version': '26.41',
        'X-Storytel-PreviewStore': '',
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    const result = await response.json();
    if (!Array.isArray(result?.items)) throw new Error();
    return result;
  } catch {
    const status = response ? ` (HTTP ${response.status})` : '';
    throw new Error(`Search failed${status}. Check your token, query, media type, and connectivity.`);
  }
}

async function main(args = process.argv.slice(2)) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: {
        page: { type: 'string' },
        'search-for': { type: 'string' },
        formats: { type: 'string' },
        languages: { type: 'string' },
        'kids-mode': { type: 'boolean' },
        accept: { type: 'string' },
        format: { type: 'string', default: 'table' },
      },
      allowPositionals: true,
    }));
    if (positionals.length !== 1 || !['table', 'json'].includes(values.format)) throw new Error();
  } catch {
    throw new Error('Usage: node storytel-search.js "<query>" [--format <table|json>] [--page <cursor>] [--search-for <selector>] [--formats <value>] [--languages <value>] [--kids-mode] [--accept <media-type>]');
  }
  const result = await search(positionals[0], {
    token: await getToken(),
    page: values.page,
    searchFor: values['search-for'],
    includeFormats: values.formats,
    includeLanguages: values.languages,
    kidsMode: values['kids-mode'],
    accept: values.accept,
  });
  if (values.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const rows = result.items.map((item) => ({
      ID: item?.id ?? '',
      Type: item?.resultType ?? '',
      Title: item?.title ?? item?.name ?? '',
      Authors: (item?.authors ?? [item?.author]).map((author) => author?.name).filter(Boolean).join(', '),
      Narrators: (item?.narrators ?? []).map((narrator) => narrator?.name).filter(Boolean).join(', '),
    }));
    if (rows.length) console.table(rows);
    else console.log('No results.');
    if (typeof result.totalCount === 'number') console.log(`Total results: ${result.totalCount}`);
    if (result.nextPageToken) console.log(`Next page token: ${result.nextPageToken}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { search, main };
