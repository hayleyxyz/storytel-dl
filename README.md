# storytel-dl

Command-line tools for signing in to Storytel, searching the catalogue, and downloading audiobooks your account has access to as MP3 files with chapter markers.

## Requirements

- [Node.js](https://nodejs.org/) 20.12 or newer (uses built-in `fetch` and `util.parseEnv`)
- [ffmpeg](https://ffmpeg.org/) on your `PATH` (used to add chapter markers without re-encoding)
- A Storytel account with an active subscription

No npm dependencies are required.

## Quick start

```sh
# 1. Sign in (prompts for email and password, caches a token)
node storytel-login.js

# 2. Find a book and note its ID
node storytel-search.js "the hobbit"

# 3. Download it
node storytel-dl.js 5678
```

## Authentication

### `storytel-login.js`

```
node storytel-login.js [--env-file <file>] [--force] [-- <command> [arguments...]]
```

Signs in and saves an ID token to `.storytel-token.json` in the current directory. Other scripts reuse this token until it expires, then you need to sign in again.

Credentials are read from, in order:

1. The file given with `--env-file`
2. `.env` in the current directory, if it exists
3. An interactive prompt (the password isn't shown as you type)

A credentials file needs these keys:

```ini
EMAIL=you@example.com
PASSWORD=your-password
```

| Option | Description |
| --- | --- |
| `--env-file <file>` | Read `EMAIL` and `PASSWORD` from this file. Always signs in again. |
| `--force` | Ignore the cached token and sign in again. |
| `-- <command> ...` | Run a command with `STORYTEL_GCP_TOKEN` set in its environment. |

Example of running a command with the token:

```sh
node storytel-login.js -- node storytel-dl.js 5678
```

Passwords can't be passed as arguments or piped in. If you can't sign in because of a CAPTCHA or multi-factor authentication, sign in on the Storytel website first.

### Token lookup

All other scripts use the token from:

1. The `STORYTEL_GCP_TOKEN` environment variable, if set
2. Otherwise, the cached `.storytel-token.json`

> Keep `.env` and `.storytel-token.json` private, and don't commit them to version control.

## Searching

### `storytel-search.js`

```
node storytel-search.js "<query>" [--format <table|json>] [--page <cursor>]
  [--search-for <selector>] [--formats <value>] [--languages <value>]
  [--kids-mode] [--accept <media-type>]
```

Prints a table of results with ID, type, title, authors and narrators. Use the **ID** column with the download commands.

| Option | Description |
| --- | --- |
| `--format <table\|json>` | Output format. Default: `table`. |
| `--page <cursor>` | Get the next page using the `Next page token` from a previous search. |
| `--search-for <selector>` | Passed to the API as `searchFor`. |
| `--formats <value>` | Passed to the API as `includeFormats`. |
| `--languages <value>` | Passed to the API as `includeLanguages`. |
| `--kids-mode` | Search in kids mode. |
| `--accept <media-type>` | Override the `Accept` header. Default: `application/vnd.storytel.search-v10+json`. |

Examples:

```sh
node storytel-search.js "agatha christie"
node storytel-search.js "agatha christie" --page <next-page-token>
node storytel-search.js "dune" --format json > results.json
```

## Downloading

### `storytel-dl.js` (recommended)

```
node storytel-dl.js <consumable-id> [output-file] [--narration-id <id>]
```

Downloads an audiobook and embeds chapter markers using ffmpeg. The audio isn't re-encoded.

- If you don't give `output-file`, the book title is used as the file name, for example `The Hobbit.mp3`.
- Existing files are never overwritten. The command fails if the output file already exists.
- If the download fails, the partial file is removed.
- If Storytel doesn't provide chapter data, the file is saved without chapter markers.

| Option | Description |
| --- | --- |
| `--narration-id <id>` | Choose a specific narration when a book has more than one. |

Examples:

```sh
node storytel-dl.js 5678
node storytel-dl.js 5678 "C:\Audiobooks\My Book.mp3"
node storytel-dl.js 5678 --narration-id 1234
```

When the download finishes, a JSON summary is printed:

```json
{
  "outputPath": "The Hobbit.mp3",
  "title": "The Hobbit",
  "bytesWritten": 123456789,
  "contentType": "audio/mpeg",
  "chapters": 19
}
```

### `storytel-download.js` (raw download)

```
node storytel-download.js <consumable-id> <output-file> [narration-id]
```

Downloads only the audio file, without fetching metadata or adding chapters. You don't need ffmpeg for this command.

### `storytel-request.js` (diagnostics)

```
node storytel-request.js <consumable-id> [narration-id]
```

Requests the audio file and prints only the HTTP status, content type and size. Nothing is downloaded. Use this to check whether a book is available to your account.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `No current token found` | Run `node storytel-login.js`. |
| `Storytel sign-in failed` | Check your credentials. If you get a CAPTCHA or MFA prompt, sign in on the website first. |
| `ffmpeg was not found in PATH` | Install ffmpeg, or add its `bin` folder to `PATH`. |
| `Content unavailable in your region` | The book isn't available in your account's region. |
| `Download failed` / HTTP 401/403 | Your token may have expired, or your subscription may not include this book. Run `node storytel-login.js --force`. |
| `EEXIST` error | The output file already exists. Choose a different name or delete the existing file. |

## Disclaimer

Only use this tool with your own Storytel account, for content you're entitled to, and in line with Storytel's terms of service. This project isn't affiliated with Storytel.

## License

MIT
