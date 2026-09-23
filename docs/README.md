# Signage CMS: technical documentation

Developer hand-off documentation for the Signage CMS: a multi-tenant digital signage platform (.NET 8 + PostgreSQL + React) with Android TV, Android tablet and web players.

**All diagrams are Mermaid.** They render on GitHub, GitLab, Azure DevOps and in VS Code (Markdown Preview Mermaid Support). Every diagram is machine-checked with the real Mermaid 11 parser (`_tools/validate_mermaid.py`).

## Reading order

| # | Document | For | Contents |
|---|---|---|---|
| 1 | [System overview](01-system-overview.md) | everyone | purpose, capabilities, glossary, repo layout, quick start, status and limitations |
| 2 | [Architecture](02-architecture.md) | architects, backend | context, high-level and clean-architecture diagrams, request pipeline, auth, real-time, player architecture, scaling |
| 3 | [Database](03-database.md) | backend, DBA | **complete ERD**, per-domain ERDs, every table/column/key/index, constraints, delete rules, tenancy, enums, retention |
| 4 | [Workflows](04-workflows.md) | everyone | flowcharts and sequence diagrams: registration, organization and locations, pairing, media upload, playlists, scheduling, sync, offline playback, heartbeat monitoring, commands |
| 5 | [API reference](05-api-reference.md) | frontend, integrators | all 70 endpoints by feature with permissions, request/response types, real examples, errors, SignalR contracts |
| 6 | [Frontend](06-frontend.md) | frontend | routes, component tree, state and data flow, design system, player internals |
| 7 | [Backend](07-backend.md) | backend | projects, controllers, services, data access (no repository layer, and why), middleware, security primitives, extension guide |
| 8 | [Players](08-players.md) | mobile, field ops | Android TV and tablet app (technology, build, install, controls), web player, device protocol |
| 9 | [Deployment](09-deployment.md) | DevOps | environment setup, configuration, **migrations**, Docker, reverse proxy/HTTPS, systemd, backups, monitoring, CI/CD, production checklist |
| 10 | [Testing](10-testing.md) | QA, all devs | strategy, suites and commands, coverage matrix, hardware acceptance checklist, recommended additions |
| 11 | [Security](11-security.md) | security, leads | trust boundaries, controls, **findings S1–S13 with fixes**, secrets, hardening checklist |
| 12 | [Troubleshooting](12-troubleshooting.md) | support, ops | triage flow and symptom → cause → fix tables |
| 13 | [End-to-end flow](13-end-to-end-flow.md) | everyone | admin login to content playback across every component, with a timing budget |

## Generated artefacts: keep them in sync

| Artefact | Source | Regenerate |
|---|---|---|
| `03-database.md` | live PostgreSQL catalog | `PGPASSWORD=… python3 docs/_tools/gen_db_doc.py --host … --db signage --user signage` |
| `api/openapi.json` | running API | `curl -s http://localhost:5080/swagger/v1/swagger.json \| python3 -m json.tool > docs/api/openapi.json` |
| `05-api-reference.md` | controllers + openapi.json + samples.json (+ `_tools/api_intro.md`, `api_outro.md`) | `python3 docs/_tools/gen_api_doc.py` |
| Diagram check | all `*.md` | `npm i mermaid@11 && python3 docs/_tools/validate_mermaid.py node_modules/mermaid/dist/mermaid.min.js` |
| Link check | all `*.md` | `python3 docs/_tools/check_links.py` (files and heading anchors) |

Run the generators after schema or API changes, and both checks before merging documentation changes.

## Hand-off priorities

Before the first production deployment, do these (details in the linked sections):
1. Fix security findings **S1** (rate-limit device claiming), **S2** (forwarded headers) and **S3** (HTTPS): [§11.3](11-security.md#113-findings-and-recommended-fixes)
2. Adopt EF migrations: [§9.4](09-deployment.md#94-database-migrations)
3. Run Docker and CI once in staging: [§9.5](09-deployment.md#95-docker), [§9.9](09-deployment.md#99-cicd-example-pipeline)
4. Run the hardware acceptance checklist on one TV and one tablet: [§10.5](10-testing.md#105-manual-acceptance-checklist-real-hardware)
5. Back up the Android signing keystore and change its password: [§8.2](08-players.md#82-build-commands-apk)
