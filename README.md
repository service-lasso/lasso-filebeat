# lasso-filebeat

`lasso-filebeat` packages Filebeat as a Service Lasso managed log shipper.

Filebeat is an app-owned observability sidecar. It is disabled by default because the consuming app owns the log paths, output destination, credentials, and retention policy.

## Service Contract

- Service ID: `filebeat`
- Upstream version: `8.14.2`
- Default HTTP metrics port: `5066`
- Default dependency: `openobserve`
- Default healthcheck: `GET http://127.0.0.1:${SERVICE_PORT}/`
- Default start command: `filebeat -c runtime/filebeat.yml -e`
- Manual setup command: `filebeat setup -e`
- First package platforms: Windows x64, Linux x64, macOS arm64

## OpenObserve Output

The default `service.json` writes a Filebeat config that sends events through the Elasticsearch-compatible OpenObserve endpoint:

```yaml
output.elasticsearch:
  hosts: ['${FILEBEAT_OUTPUT_HOST}']
  path: '${FILEBEAT_OUTPUT_PATH}'
  index: '${FILEBEAT_OUTPUT_INDEX}'
  username: '${FILEBEAT_OUTPUT_USERNAME}'
  password: '${FILEBEAT_OUTPUT_PASSWORD}'
```

When `openobserve` is present in the same consuming app, Service Lasso resolves `FILEBEAT_OUTPUT_HOST` from `OPENOBSERVE_URL`. Override the env values in the consuming app's `services/filebeat/service.json` if logs should ship somewhere else.

## Release Artifacts

Pushes to `main` create a GitHub release named with the Service Lasso version pattern:

```text
yyyy.m.d-<shortsha>
```

The release contains:

- `lasso-filebeat-8.14.2-win32.zip`
- `lasso-filebeat-8.14.2-linux.tar.gz`
- `lasso-filebeat-8.14.2-darwin.tar.gz`
- `service.json`
- `SHA256SUMS.txt`

## Local Validation

```powershell
npm test
```

The verifier downloads the upstream Filebeat release asset for the current platform, repackages it, validates the manifest/config, starts Filebeat with a temporary log input, checks the HTTP metrics endpoint, and stops the process.

## Consumer Notes

- Keep `FILEBEAT_LOG_GLOB` app-specific. The repo default points to `logs/*.log` under the Filebeat service root.
- Keep local development credentials out of production usage.
- Run the manual `setup-dashboards` step only when the configured output supports Filebeat setup assets.
- Remove or change `depend_on: ["openobserve"]` if shipping to an external Elasticsearch-compatible endpoint.

## Sources

- OpenObserve Filebeat docs: https://openobserve.ai/docs/ingestion/logs/filebeat/
- Elastic Filebeat Elasticsearch output docs: https://www.elastic.co/guide/en/beats/filebeat/8.19/elasticsearch-output.html
