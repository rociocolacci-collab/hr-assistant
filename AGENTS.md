# AGENTS.md

Guía para agentes de código que trabajan en este repo.

## Propósito

HR Assistant es un bot de Slack para dotCMS: responde preguntas de People & Culture con contenido de Notion + Claude. Producción corre en Vercel (TypeScript).

## Mapa de archivos

| Archivo | Cuándo tocarlo |
|---------|----------------|
| [`api/events.ts`](api/events.ts) | Event Subscriptions: `app_mention`, DMs |
| [`api/interactions.ts`](api/interactions.ts) | Botones y modals Slack |
| [`lib/notion.ts`](lib/notion.ts) | `HR_PAGE_IDS`, fetch Notion, logging, `createHRRequest` |
| [`lib/generate-response.ts`](lib/generate-response.ts) | AI SDK + system prompt + formateo mrkdwn |
| [`lib/handle-app-mention.ts`](lib/handle-app-mention.ts) | Flujo @mention |
| [`lib/handle-messages.ts`](lib/handle-messages.ts) | Flujo DM |
| [`lib/hr-actions.ts`](lib/hr-actions.ts) | Modal, escalación, `view_submission` |
| [`lib/slack-utils.ts`](lib/slack-utils.ts) | Cliente Slack, firma HMAC, `getThread` |
| [`lib/model.ts`](lib/model.ts) | Provider Anthropic |
| [`vercel.json`](vercel.json) | Límites de memoria / duración |

## Convenciones

- TypeScript estricto; CommonJS en output (`module: CommonJS`).
- Slack exige respuesta HTTP rápida: usa `waitUntil` de `@vercel/functions`.
- Verifica firma Slack con `rawBody` antes de parsear JSON (events) o `URLSearchParams` (interactions).
- Respuestas cortas (3–5 líneas). Formato Slack mrkdwn: `*bold*` (un asterisco).
- Links: `<url|texto>` (ver `formatSlackMrkdwn` en `lib/slack-blocks.ts`).

## Knowledge de Notion

La base de conocimiento es `HR_PAGE_IDS` en [`lib/notion.ts`](lib/notion.ts). Para añadir/quitar políticas: edita esa lista y asegura acceso de la integración Notion.

## Variables de entorno

`SLACK_TOKEN`, `SLACK_SIGNING_SECRET`, `NOTION_TOKEN`, `CLAUDE_API_KEY` (o `ANTHROPIC_API_KEY`), `SLACK_HR_CHANNEL`, opcionalmente `NOTION_HR_REQUESTS_ID` / `NOTION_INTERACTIONS_LOG_ID`.

No hardcodees secrets.

## Endpoints Slack (post-refactor)

- Events: `/api/events` (antes `/api/slack`)
- Interactivity: `/api/interactions`

## Qué no hacer

- No volver a un monolito en un solo archivo.
- No alargar el system prompt ni subir `maxTokens` sin necesidad.
- No inventar búsqueda por database; el diseño es page IDs fijos.
- No commitear `.env` ni tokens.

## Verificación

```bash
npm run typecheck
```
