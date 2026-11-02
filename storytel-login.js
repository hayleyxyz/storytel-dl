const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const { parseArgs, parseEnv } = require('node:util');
const { TOKEN_FILE, saveToken, loadCachedToken } = require('./storytel-token.js');

async function loadEnvCredentials(envFile, { optional = false } = {}) {
  let values;
  try {
    values = parseEnv(await readFile(envFile, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error('Could not read the credentials .env file.');
  }
  if (!values.EMAIL?.trim() || !values.PASSWORD) {
    throw new Error('The credentials file must contain non-empty EMAIL and PASSWORD.');
  }
  return { email: values.EMAIL, password: values.PASSWORD };
}

async function signIn({ email, password, fetchImpl = globalThis.fetch } = {}) {
  if (typeof email !== 'string' || !email.trim()
    || typeof password !== 'string' || !password) {
    throw new Error('Provide an email and password.');
  }
  try {
    const response = await fetchImpl(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAPsaBlt8o0uw_h1wdx9gleKfsILNdhuUI',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://www.storytel.com/',
          Origin: 'https://www.storytel.com',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          returnSecureToken: true,
          clientType: 'CLIENT_TYPE_WEB',
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    const result = await response.json();
    if (typeof result?.idToken !== 'string' || !result.idToken.trim()) {
      throw new Error();
    }
    return result.idToken;
  } catch {
    throw new Error('Storytel sign-in failed. Check your credentials, or use the official website for CAPTCHA/MFA. No authentication response was displayed.');
  }
}

async function promptCredentials({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Run login in an interactive terminal; passwords are not accepted through arguments or pipes.');
  }
  let hidden = false;
  const display = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) output.write(chunk, encoding);
      callback();
    },
  });
  const controller = new AbortController();
  const readline = createInterface({ input, output: display, terminal: true });
  const abort = () => controller.abort();
  readline.on('SIGINT', abort);
  readline.on('close', abort);
  try {
    const email = await readline.question('Storytel email: ', { signal: controller.signal });
    hidden = true;
    output.write('Storytel password: ');
    const password = await readline.question('', { signal: controller.signal });
    return { email, password };
  } finally {
    readline.close();
    display.destroy();
    if (hidden) output.write('\n');
  }
}

async function main(args = process.argv.slice(2)) {
  delete process.env.STORYTEL_GCP_TOKEN;
  const separator = args.indexOf('--');
  const command = separator === -1 ? [] : args.slice(separator + 1);
  let values;
  try {
    ({ values } = parseArgs({
      args: separator === -1 ? args : args.slice(0, separator),
      options: {
        'env-file': { type: 'string' },
        force: { type: 'boolean' },
      },
      allowPositionals: false,
    }));
    if (separator !== -1 && !command.length) throw new Error();
  } catch {
    throw new Error('Usage: node storytel-login.js [--env-file <file>] [--force] [-- <command> [arguments...]]');
  }
  let credentials;
  try {
    let token = values.force || values['env-file'] !== undefined
      ? null
      : await loadCachedToken();
    const reused = token !== null;
    if (!token) {
      credentials = await loadEnvCredentials(values['env-file'] ?? '.env', {
        optional: values['env-file'] === undefined,
      });
      credentials ??= await promptCredentials();
      token = await signIn(credentials);
      credentials = null;
      await saveToken(token);
    }
    process.env.STORYTEL_GCP_TOKEN = token;
    if (!command.length) {
      console.log(reused ? 'Using the cached token.' : `Signed in. Token saved to ${TOKEN_FILE}.`);
      return 0;
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        stdio: 'inherit',
        env: { ...process.env },
        shell: false,
      });
      child.once('error', () => reject(new Error('Could not start the requested command.')));
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    credentials = null;
    delete process.env.STORYTEL_GCP_TOKEN;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.name === 'AbortError' ? 'Sign-in cancelled.' : error.message);
    process.exitCode = 1;
  });
}

module.exports = { signIn, promptCredentials, loadEnvCredentials, main };
