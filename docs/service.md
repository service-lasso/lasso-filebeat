# Filebeat Service

`lasso-filebeat` provides Filebeat 8.14.2 as a release-backed Service Lasso service.

## Defaults

- `filebeat` is disabled by default.
- The service exposes Filebeat's HTTP metrics endpoint on port `5066`.
- The generated config watches `${SERVICE_ROOT}/logs/*.log` unless `FILEBEAT_LOG_GLOB` is overridden.
- The generated config targets OpenObserve through `output.elasticsearch` using `OPENOBSERVE_URL`.

## Setup

The manifest includes one manual setup step:

```text
setup-dashboards
```

Use it only when the configured output supports Filebeat setup assets. Normal log shipping does not require this step.

## Override Points

Consumers can edit their committed `services/filebeat/service.json` to change:

- `FILEBEAT_LOG_GLOB`
- `FILEBEAT_OUTPUT_HOST`
- `FILEBEAT_OUTPUT_PATH`
- `FILEBEAT_OUTPUT_INDEX`
- `FILEBEAT_OUTPUT_USERNAME`
- `FILEBEAT_OUTPUT_PASSWORD`
- `depend_on`

## Release Assets

Each GitHub release publishes platform archives, `service.json`, and `SHA256SUMS.txt`.
