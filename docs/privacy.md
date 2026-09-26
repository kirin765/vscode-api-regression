# Privacy

API Regression runs locally. It does not operate a telemetry service and sends no API data, endpoint URLs, request or response contents, workspace paths or secrets to any licensing server or third party.

## What is stored, and where

- **Configuration** — `.api-regression/config.json` in your workspace. It contains endpoint definitions and credential *references* only, never secret values.
- **Baselines** — in VS Code's extension-managed workspace storage by default. A baseline records the endpoint id, environment, source origin, capture time, HTTP status, rule/schema versions, and the response body **after redaction**.
- **Reports** — written only when you explicitly export, to a location you choose.
- **Credentials** — in VS Code SecretStorage, keyed by workspace, profile and destination origin.
- **License keys** — in VS Code SecretStorage.

## What the extension sends

The only network requests API Regression makes are the ones you explicitly run, to the URLs in your configuration. Redirects are not followed. TLS verification stays enabled.

## Redaction and reporting

Values matching `redactPaths` are replaced with `[REDACTED]` before preview, storage or report generation. Authorization headers, cookies and raw secrets are never included in logs or reports. Automatic masking is best-effort — review a capture preview before saving a baseline.

## Deleting your data

Remove a baseline with **API Regression: Delete Baseline**, delete credentials with **API Regression: Manage Credentials**, and remove stored extension data by uninstalling the extension and clearing its workspace storage. Exported files are yours to delete.

## Questions

Open an issue via the support channel in [support.md](support.md).
