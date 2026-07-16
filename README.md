# HR Assistant

Bot de Slack para empleados de dotCMS. Responde preguntas de People & Culture usando contenido vivo de Notion y Claude (Anthropic). También permite escalar a HR o enviar solicitudes formales vía modal.

## Arquitectura

Producción corre en Vercel como funciones serverless TypeScript:

| Ruta | Archivo | Rol |
|------|---------|-----|
| `/api/events` | [`api/events.ts`](api/events.ts) | Event Subscriptions (`app_mention`, DMs) |
| `/api/interactions` | [`api/interactions.ts`](api/interactions.ts) | Botones y modals (`block_actions`, `view_submission`) |

Lógica compartida en [`lib/`](lib/):

- `notion.ts` — fetch de páginas HR, logging, creación de requests
- `generate-response.ts` — Vercel AI SDK + Anthropic
- `handle-app-mention.ts` / `handle-messages.ts` — flujos de Q&A
- `hr-actions.ts` — modal, escalación, persistencia en Notion
- `slack-utils.ts` — cliente Slack, verificación de firma, historial de thread

Flujo de Q&A:

1. Usuario menciona al bot o le escribe por DM.
2. Slack hace `POST` a `/api/events`.
3. Vercel responde `200` de inmediato; el trabajo continúa con `waitUntil`.
4. Se verifica la firma de Slack (`SLACK_SIGNING_SECRET`).
5. Se descubren y cargan en paralelo las páginas HR compartidas con la integración Notion (Search API; cache 1h).
6. Claude genera una respuesta corta vía AI SDK.
7. El bot responde en el thread con botones **Submit HR Request** y **Talk to HR**.

## Stack

- Node.js ≥ 18, TypeScript
- Slack: `@slack/web-api`
- Notion: `@notionhq/client`
- AI: Vercel AI SDK (`ai`) + `@ai-sdk/anthropic` (Claude Sonnet 4.6)
- Hosting: Vercel (1024 MB, max duration 60s)

## Variables de entorno

Copia [`.env.example`](.env.example) y configura en Vercel:

| Variable | Descripción |
|----------|-------------|
| `SLACK_TOKEN` | Bot token de Slack (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Secret para verificar requests de Slack |
| `NOTION_TOKEN` | Token de la integración de Notion |
| `CLAUDE_API_KEY` | API key de Anthropic (también acepta `ANTHROPIC_API_KEY`) |
| `SLACK_HR_CHANNEL` | Channel ID para escalaciones y nuevas solicitudes |
| `NOTION_HR_REQUESTS_ID` | Database ID de solicitudes HR |
| `NOTION_INTERACTIONS_LOG_ID` | Database ID para logging de Q&A (opcional) |

## Setup Slack

1. Crea o usa una Slack App con Bot Token.
2. Scopes recomendados: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `channels:history`.
3. **Event Subscriptions** → Request URL: `https://<tu-dominio>/api/events`
   - Suscribir: `app_mention`, `message.im`
4. **Interactivity** → Request URL: `https://<tu-dominio>/api/interactions`
5. Instala la app y copia tokens a Vercel.

## Setup Notion

1. Crea una integración y comparte las páginas HR con ella (solo esas páginas deben tener acceso).
2. El knowledge se descubre automáticamente vía Notion Search API en [`lib/notion.ts`](lib/notion.ts); no hay lista de IDs en código.
3. Opcional: databases para requests (`NOTION_HR_REQUESTS_ID`) e interactions log.

## Desarrollo local

```bash
npm install
npm run typecheck
vercel dev --listen 3000
```

Usa un túnel (p. ej. `npx untun@latest tunnel http://localhost:3000`) y apunta las URLs de Slack al túnel.

## Deploy (Vercel)

1. Conecta el repo a Vercel.
2. Configura las variables de entorno.
3. Deploy.
4. Actualiza las URLs de Slack App a `/api/events` y `/api/interactions`.

## Uso

- Menciona al bot: `@HR Assistant ¿cuántos días de vacation tengo?`
- O escríbele por DM.
- Tras la respuesta:
  - **Submit HR Request** — abre modal; al enviar crea fila en Notion y notifica a HR
  - **Talk to HR** — notifica al canal configurado

## Comandos

| Comando | Descripción |
|---------|-------------|
| `npm run typecheck` | Verifica tipos TypeScript |
| `npm run build` | Placeholder para Vercel (no-op) |
