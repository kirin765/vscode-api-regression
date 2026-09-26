# API Regression

Save an API response baseline, rerun the endpoint, and inspect meaningful JSON differences using explicit comparison rules — inside VS Code.

The workflow: **capture a baseline → rerun the endpoint → review a native JSON diff → optionally replace the baseline.**

Example: the baseline has `price: 19.99`; the new response has `price: "19.99"`. API Regression reports a number-to-string change while ignoring a configured `updatedAt` field.

> API Regression reports observed differences. A changed response is **not necessarily a breaking change**, and an unchanged response does **not** prove the API is correct.

## What it does

- Named HTTP/HTTPS **GET** endpoints returning JSON, in named environments.
- Auth modes: none, bearer token, and API-key header. Credentials live in VS Code SecretStorage, never in the config file.
- Capture a **reviewed baseline** (with redaction), rerun, and compare status + JSON.
- Comparison rules: ignore JSON Pointer paths (with `*` wildcards), redact secret values, and optional array matching by key.
- Reports **added / removed / type-changed / value-changed** paths with bounded previews and summary counts.
- Native VS Code diff editor for each run, plus a redacted **Markdown report** export.
- Small **batch runs** with progress, cancellation and per-endpoint results.
- Never runs requests on install, workspace open, config change or file save. Every run asks for explicit confirmation of the resolved target.

## Quick start

1. Open a **trusted local folder** in VS Code.
2. Run **API Regression: Create Configuration** to write `.api-regression/config.json`.
3. Start the included synthetic API:

   ```bash
   npm run fixture
   ```

4. In the API Regression view (activity bar), pick **Products (demo)**, then **Capture Baseline**.
5. Pick **Products with a changed response (demo)** and **Rerun and Compare Endpoint**. A native diff opens showing a number-to-string change with the timestamp field ignored.

## Configuration

`.api-regression/config.json`:

```json
{
  "schemaVersion": 1,
  "environments": {
    "local": { "baseUrl": "http://127.0.0.1:8787" }
  },
  "endpoints": [
    {
      "id": "products",
      "name": "Products",
      "environment": "local",
      "path": "/api/products",
      "auth": { "type": "bearer", "profile": "local" },
      "rules": {
        "ignorePaths": ["/meta/updatedAt", "/items/*/updatedAt"],
        "redactPaths": ["/items/*/secret"],
        "arrayMatchKeys": { "/items": "id" }
      }
    }
  ]
}
```

- `ignorePaths` — JSON Pointer paths excluded from comparison. `*` matches exactly one segment. Ignored paths are listed in every result so a match is not misleading.
- `redactPaths` — values replaced with `[REDACTED]` before preview, storage and report. Redaction hides data; ignores remove it from comparison.
- `arrayMatchKeys` — match array items by a configured field. Missing or duplicate keys are reported as ambiguous, never silently paired.
- Credentials are **references** (`auth.profile`), not values. Set them with **API Regression: Manage Credentials**.

## Comparison semantics

- Object key order is ignored. Array order is preserved by default; arrays are never globally sorted.
- Missing, `null`, empty string, numeric values and numeric strings are all distinct.
- Numbers are compared as exact decimal literals, so large integers and high-precision decimals are not silently rounded.
- Transport errors, timeouts, redirects, oversized responses and invalid JSON are **execution failures**, not response differences.
- A baseline records the endpoint, environment, capture time, rule version and schema version. Changing rules cannot silently reinterpret a baseline: you are asked to use the new rules (recorded) or recapture.
- Baselines are stored per workspace in extension-managed storage and written atomically with conflict detection.

## Safety and privacy

- **Workspace Trust is required** for network execution and is enforced at command execution, not just in menus.
- Redirects are not followed; the target and status are reported instead.
- Credentials are scoped to a workspace, profile and destination origin. A changed origin cannot silently inherit a credential.
- Authorization headers, raw secrets, cookies and unreviewed responses are never persisted in logs or reports. Automatic masking is best-effort; the capture preview shows exactly what will be stored.
- Redacted baselines can be exported into a repository only through an explicit action, with a warning. Local does not mean safe to commit.
- No API data is sent to any licensing service.

## Commands

| Command | Purpose |
|---|---|
| API Regression: Create Configuration | Write the starter config |
| API Regression: Capture Baseline | Run, preview/redact, save a reviewed baseline |
| API Regression: Rerun and Compare Endpoint | Rerun and open a native diff |
| API Regression: Rerun and Compare Selected Endpoints | Sequential batch (bounded, cancellable) |
| API Regression: Replace Baseline From Last Run | Explicit replacement after review |
| API Regression: Export Markdown Report | Redacted difference report |
| API Regression: Export Redacted Baseline | Copy a baseline into the repo (explicit) |
| API Regression: Manage Credentials | Add/delete/re-associate SecretStorage credentials |
| API Regression: License Status | Trial and license state |

## Settings

- `apiRegression.requestTimeoutMs` (default 15000)
- `apiRegression.maxResponseBytes` (default 2097152)
- `apiRegression.maxBatchEndpoints` (default 10)
- `apiRegression.maxDiffEntries` (default 2000)

## Licensing

API Regression includes a **14-day trial**. A paid license is a signed, offline-verifiable key tied to a major version; verification uses an embedded public key. Continued use of a purchased major version remains available. See [docs/licensing.md](docs/licensing.md).

## Known limits (this version)

Only GET, JSON, local filesystem workspaces. Not supported: POST/PUT/PATCH/DELETE, OAuth flows, cookies, scripts, `.http`/Postman import, GraphQL/gRPC/WebSockets, cloud sync, team dashboards, scheduled monitoring, CI runners, browser/remote/WSL hosts, AI explanations, custom certificates/proxies. A request to unsupported environments produces a clear message rather than executing somewhere unexpected.

## Privacy, support, license

- [Privacy](docs/privacy.md) · [Support](docs/support.md) · [License](LICENSE)

## Development

```bash
npm install
npm run verify       # typecheck + lint + tests + package
npm test             # unit and fixture integration tests
npm run fixture      # synthetic local API on :8787
npm run vsce:package # build a VSIX
```
