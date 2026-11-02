const { spawn } = require('node:child_process');
const { chmod, mkdtemp, open, rename, rmdir, stat, unlink, writeFile } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');
const { parseArgs } = require('node:util');
const { downloadAudioAsset } = require('./storytel-download.js');
const { createAudioAssetRequest } = require('./storytel-request.js');
const { getToken } = require('./storytel-token.js');

function audioFilename(title, id) {
  let name = (typeof title === 'string' ? title : '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 180)
    .replace(/[. ]+$/g, '');
  if (!name) name = id;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.mp3`;
}

function createChapterMetadata(chapters) {
  const escape = (value) => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/([=;#])/g, '\\$1')
    .replace(/\r\n|\r|\n/g, '\\\n');
  let position = 0;
  const sections = [...chapters].sort((a, b) => a?.number - b?.number).map((chapter, index) => {
    const milliseconds = chapter?.durationInMilliseconds;
    const seconds = chapter?.durationInSeconds;
    const duration = Math.round(
      typeof milliseconds === 'number' && milliseconds > 0
        ? milliseconds
        : typeof seconds === 'number' ? seconds * 1000 : NaN,
    );
    if (!Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(position + duration)) {
      throw new Error('Chapter metadata contains an invalid duration.');
    }
    const start = position;
    position += duration;
    const title = chapter.title?.trim() || `Chapter ${chapter.number ?? index + 1}`;
    return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${position}\ntitle=${escape(title)}\n`;
  });
  return `;FFMETADATA1\n${sections.join('')}`;
}

function runFfmpeg(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', (error) => reject(new Error(error.code === 'ENOENT'
      ? 'ffmpeg was not found in PATH. Install it or add its bin directory to PATH.'
      : 'Could not start ffmpeg.')));
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error('ffmpeg failed. The downloaded audio could not be muxed without re-encoding.'));
    });
  });
}

async function downloadBook(id, outputPath, {
  token,
  narrationId,
  fetchImpl = globalThis.fetch,
  ffmpegImpl = runFfmpeg,
} = {}) {
  const request = createAudioAssetRequest(id, { token, narrationId });
  await ffmpegImpl(['-version']);
  const fetchMetadata = async (path, accept) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, request.url.origin), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { ...request.headers, Accept: accept },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const result = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result;
    } catch {
      throw new Error(`Could not load book/chapter metadata${response ? ` (HTTP ${response.status})` : ''}.`);
    }
  };
  const [book, playback] = await Promise.all([
    fetchMetadata(`/book-details/consumables/${id}?kidsMode=false`, 'application/vnd.storytel.bookdetails-v7+json'),
    fetchMetadata(`/playback-metadata/consumable/${id}`, 'application/json'),
  ]);
  const chapters = playback.formats?.find((format) => format?.type === 'abook')?.chapters ?? [];
  if (!Array.isArray(chapters)) throw new Error('Invalid audio chapter metadata.');
  const metadata = createChapterMetadata(chapters);
  const title = book.title || playback.title || id;
  outputPath ??= audioFilename(title, id);
  let temporary;
  let reserved = false;
  let complete = false;
  try {
    const destination = await open(outputPath, 'wx', 0o600);
    reserved = true;
    await destination.close();
    temporary = await mkdtemp(join(dirname(resolve(outputPath)), '.storytel-dl-'));
    const source = join(temporary, 'source.mp3');
    const chapterFile = join(temporary, 'chapters.ffmetadata');
    const muxed = join(temporary, 'muxed.mp3');
    const result = await downloadAudioAsset(id, source, { token, narrationId, fetchImpl });
    let finished = source;
    if (chapters.length) {
      await writeFile(chapterFile, metadata, { mode: 0o600 });
      await ffmpegImpl([
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-i', source, '-f', 'ffmetadata', '-i', chapterFile,
        '-map', '0:a:0', '-map_metadata', '0', '-map_chapters', '1',
        '-c', 'copy', '-id3v2_version', '3', '-f', 'mp3', muxed,
      ]);
      finished = muxed;
    }
    const { size } = await stat(finished);
    if (size === 0) throw new Error('The finished audio file was empty.');
    await chmod(finished, 0o600);
    await rename(finished, outputPath);
    complete = true;
    return { outputPath, title, bytesWritten: size, contentType: result.contentType, chapters: chapters.length };
  } finally {
    if (temporary) {
      for (const name of ['source.mp3', 'chapters.ffmetadata', 'muxed.mp3']) {
        await unlink(join(temporary, name)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      await rmdir(temporary);
    }
    if (reserved && !complete) await unlink(outputPath);
  }
}

async function main(args = process.argv.slice(2)) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { 'narration-id': { type: 'string' } },
      allowPositionals: true,
    }));
    if (positionals.length < 1 || positionals.length > 2 || !/^\d+$/.test(positionals[0])) {
      throw new Error();
    }
  } catch {
    throw new Error('Usage: node storytel-dl.js <consumable-id> [output-file] [--narration-id <id>]');
  }
  const [id, outputPath] = positionals;
  const result = await downloadBook(id, outputPath, {
    token: await getToken(),
    narrationId: values['narration-id'],
  });
  if (!result.chapters) console.error('No audio chapters were provided; saved without chapter markers.');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { downloadAudioAsset, downloadBook, audioFilename, createChapterMetadata, main };
