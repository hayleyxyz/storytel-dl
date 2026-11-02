const { readFile, writeFile } = require('node:fs/promises');

const TOKEN_FILE = '.storytel-token.json';

async function saveToken(idToken, file = TOKEN_FILE) {
  try {
    await writeFile(file, `${JSON.stringify({ idToken })}\n`, { mode: 0o600 });
  } catch {
    throw new Error('Could not save the token cache.');
  }
}

async function loadCachedToken(file = TOKEN_FILE) {
  let saved;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw new Error('Could not read the token cache.');
  }
  try {
    const token = saved?.idToken;
    if (typeof token !== 'string' || /\s/.test(token)) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const { exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    // Leave enough time for a request to start before the token expires.
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= Date.now() + 30000) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

async function getToken() {
  const token = process.env.STORYTEL_GCP_TOKEN || await loadCachedToken();
  if (!token) {
    throw new Error('No current token found. Run node storytel-login.js to sign in.');
  }
  return token;
}

module.exports = { TOKEN_FILE, saveToken, loadCachedToken, getToken };
