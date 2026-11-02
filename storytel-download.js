const { open, unlink, stat } = require('node:fs/promises');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createAudioAssetRequest } = require('./storytel-request.js');
const { getToken } = require('./storytel-token.js');

async function downloadAudioAsset(consumableId, outputPath, {
  token,
  narrationId,
  fetchImpl = globalThis.fetch,
} = {}) {
  const request = createAudioAssetRequest(consumableId, { token, narrationId });
  const file = await open(outputPath, 'wx', 0o600);
  const controller = new AbortController();
  let response;
  let complete = false;
  try {
    let url = request.url;
    for (let redirects = 0; ; redirects++) {
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: url.origin === request.url.origin ? request.headers : { Accept: '*/*' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects >= 5) {
        throw new Error('Missing redirect target or too many redirects.');
      }
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Only HTTPS redirects without embedded credentials are accepted.');
      }
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (response.status !== 200 || !response.body) {
      if (response.status === 451) {
        throw new Error('Content unavailable in your region. Use a VPN.');
      }
      throw new Error('A complete successful response is required.');
    }
    if (!contentType || !(
      contentType.startsWith('audio/')
      || ['video/mp4', 'application/mp4', 'application/octet-stream'].includes(contentType)
    )) {
      throw new Error('Response is not an identified audio or binary asset.');
    }
    await pipeline(Readable.fromWeb(response.body), file.createWriteStream(), {
      signal: controller.signal,
    });
    const { size } = await stat(outputPath);
    if (size === 0) {
      throw new Error('The audio response was empty.');
    }
    complete = true;
    return { bytesWritten: size, contentType };
  } finally {
    controller.abort();
    if (response?.body && !response.body.locked) {
      await response.body.cancel().catch(() => {});
    }
    await file.close();
    if (!complete) {
      await unlink(outputPath);
    }
  }
}

if (require.main === module) {
  if (process.argv.length < 4 || process.argv.length > 5) {
    console.error('Usage: node storytel-download.js <consumable-id> <output-file> [narration-id]');
    process.exitCode = 1;
  } else {
    getToken().then((token) => downloadAudioAsset(process.argv[2], process.argv[3], {
      token,
      narrationId: process.argv[4],
    })).then((result) => {
      console.log(JSON.stringify(result, null, 2));
    }).catch(() => {
      console.error('Download failed. Check credentials, entitlement, destination, and connectivity.');
      process.exitCode = 1;
    });
  }
}

module.exports = { downloadAudioAsset };
