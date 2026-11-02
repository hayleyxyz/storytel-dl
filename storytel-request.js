const { getToken } = require('./storytel-token.js');

function createAudioAssetRequest(consumableId, {
  token,
  narrationId,
} = {}) {
  if (typeof consumableId !== 'string' || !/^\d+$/.test(consumableId)) {
    throw new Error('Provide a numeric consumable ID.');
  }
  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    throw new Error('Provide a current GCP token without a Bearer prefix or whitespace.');
  }

  const url = new URL(
    `https://api.storytel.net/assets/v2/consumables/${consumableId}/abook`,
  );
  if (narrationId) {
    url.searchParams.set('narration_id', narrationId);
  }
  return {
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*',
      'accept-language': 'en',
      'X-Storytel-Version': '26.41',
      'X-Storytel-PreviewStore': '',
    },
  };
}

async function probeAudioAsset(consumableId, {
  token,
  narrationId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { url, headers } = createAudioAssetRequest(consumableId, { token, narrationId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers,
    });
    try {
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        hasRedirectLocation: response.headers.get('location'),
      };
    } finally {
      await response.body?.cancel();
    }
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

if (require.main === module) {
  if (process.argv.length < 3 || process.argv.length > 4) {
    console.error('Usage: node storytel-request.js <consumable-id> [narration-id]');
    process.exitCode = 1;
  } else {
    getToken().then((token) => probeAudioAsset(process.argv[2], {
      token,
      narrationId: process.argv[3],
    })).then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status >= 400 ? 1 : 0;
    }).catch(() => {
      console.error('Request failed. Check the ID, GCP token, and network connection.');
      process.exitCode = 1;
    });
  }
}

module.exports = { createAudioAssetRequest, probeAudioAsset };
