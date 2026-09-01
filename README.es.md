<div align="center">

# MCP LLM Bridge

**Gateway LLM cifrado y servidor MCP para enrutar API keys, suscripciones CLI y selección de modelos a través de un único endpoint compatible con OpenAI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://docs.docker.com/)

</div>

Read this in: [English](README.md) · [Español](README.es.md)

## Enlaces de Demostración

- Gateway en vivo: [https://gateway.javierzader.com](https://gateway.javierzader.com)
- Objetivo de integración GHAGGA: [https://github.com/JNZader/ghagga](https://github.com/JNZader/ghagga)
- OpenCode: [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)

Capturas próximamente.

## Resumen Rápido del Portfolio

- Un solo servicio para enrutamiento de LLM, almacenamiento cifrado de credenciales, herramientas MCP y acceso HTTP compatible con OpenAI.
- 11 adaptadores de proveedores hoy: 5 proveedores de API directa más 6 proveedores respaldados por CLI.
- Soporta API keys y flujos basados en archivos de autenticación, incluyendo `auth.json` y `.credentials.json`.
- Incluye enrutamiento de bridge sensible a la tarea, enrutamiento de modelos, credenciales con alcance de proyecto con fallback global, búsqueda semántica de código, compresión de contexto y estado compartido CRDT.
- Se distribuye como herramienta de desarrollo local, gateway HTTP autoalojado, servidor MCP stdio y despliegue Docker.

## Por Qué Importa

- Centraliza secretos en lugar de dispersar tokens de proveedores por cada proyecto y herramienta.
- Permite reutilizar suscripciones CLI como OpenCode, Claude, Gemini, Codex, Qwen y Copilot detrás de una sola interfaz.
- Le da a las herramientas compatibles con OpenAI un endpoint único y estable, preservando la metadata de resolución de proveedor/modelo.
- Soporta configuraciones multi-proyecto donde las credenciales específicas de proyecto sobrescriben los valores por defecto de `_global` de forma limpia.
- Expone herramientas MCP más allá de la generación simple: operaciones de vault, búsqueda de código, estado compartido, inspección de uso y gestión de grupos de proveedores.

## Inicio Rápido

```bash
pnpm install
pnpm run serve
```

Abrí `http://localhost:3456`.

Guardá una credencial y generá texto:

```bash
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

Si configurás `LLM_GATEWAY_AUTH_TOKEN`, agregá `Authorization: Bearer <token>` a cada ruta protegida.

## Ir a la Documentación Técnica

- Referencia completa de la API: [README Técnico](#readme-técnico)
- Modelo de autenticación y credenciales: [Autenticación](#autenticación), [Gestión de Credenciales](#gestión-de-credenciales)
- Integración MCP: [Servidor MCP](#servidor-mcp)
- Docker y autoalojamiento: [Despliegue con Docker](#despliegue-con-docker)

---

## README Técnico

## Tabla de Contenidos

1. [Inicio Rápido](#inicio-rápido-1)
2. [Dashboard](#dashboard)
3. [Referencia de la API](#referencia-de-la-api)
4. [Proveedores](#proveedores)
5. [Autenticación](#autenticación)
6. [Gestión de Credenciales](#gestión-de-credenciales)
7. [Puente entre Modelos](#puente-entre-modelos)
8. [Compresión de Contexto](#compresión-de-contexto)
9. [Búsqueda Semántica de Código](#búsqueda-semántica-de-código)
10. [Estado Multi-Agente CRDT](#estado-multi-agente-crdt)
11. [Integraciones](#integraciones)
12. [Despliegue con Docker](#despliegue-con-docker)
13. [Servidor MCP](#servidor-mcp)
14. [Configuración](#configuración)
15. [Perfiles de Seguridad](#perfiles-de-seguridad)
16. [Flujos de Aprobación](#flujos-de-aprobación)
17. [Prompt de Tres Partes](#prompt-de-tres-partes)
18. [Compresión de Salida RTK](#compresión-de-salida-rtk)
19. [Offloading a LLM Local](#offloading-a-llm-local)
20. [Enrutamiento de Modelos](#enrutamiento-de-modelos)
21. [Auto-Descubrimiento HF](#auto-descubrimiento-hf)
22. [Arquitectura](#arquitectura)
23. [Seguridad](#seguridad)
24. [Desarrollo](#desarrollo)
25. [Licencia](#licencia)

## Inicio Rápido

```bash
# Install dependencies
pnpm install

# Start the HTTP server + dashboard
pnpm run serve

# MCP stdio mode only
pnpm run start
```

Flujo HTTP básico:

```bash
# Store a global Anthropic key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

# Generate text with automatic provider selection
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

Si la autenticación está habilitada:

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'
```

## Dashboard

El repo actualmente tiene **dos superficies de dashboard**:

- **Shell local integrado** en `http://localhost:3456/` — superficie de operaciones local legacy servida directamente por el bridge. Sigue siendo la fuente de verdad para la gestión local de credenciales/archivos de autenticación y la generación rápida de pruebas.
- **App de administración en React** bajo `dashboard/` (compilada a `docs/`) — superficie de administración/observabilidad para overview, proveedores, uso, grupos, circuit breakers, configuración y vistas relacionadas.

Coexisten intencionalmente por ahora y **no** tienen paridad completa de funcionalidades.

- Demo alojada: [https://gateway.javierzader.com](https://gateway.javierzader.com)
- Shell local integrado: `http://localhost:3456`

### Configuración Inicial

1. Iniciá el gateway con `pnpm run serve`.
2. Abrí el dashboard.
3. Ingresá la URL base de tu gateway.
4. Ingresá el bearer token si `LLM_GATEWAY_AUTH_TOKEN` está configurado.
5. Probá la conexión y guardá.

### Capacidades del Shell Local Integrado

- Agregar, listar, filtrar y eliminar API keys cifradas.
- Subir archivos de autenticación para proveedores respaldados por CLI.
- Inspeccionar la disponibilidad de proveedores y los modelos disponibles.
- Enviar prompts de prueba e inspeccionar la metadata de proveedor/modelo devuelta.
- Trabajar con credenciales con alcance de proyecto sin exponer secretos en crudo.

### Capacidades de la App de Administración React

- Overview / estado de proveedores / uso / grupos / circuit breakers / configuración
- Visibilidad operativa orientada a administración sobre los subsistemas del bridge
- Alojada por separado del shell integrado mediante la app `dashboard/`

Mapeos de archivos de autenticación recomendados en la UI y la API:

- `opencode` -> `auth.json`
- `claude` -> `.credentials.json`
- `codex` -> `auth.json`
- `gemini` -> `settings.json` y `oauth_creds.json`
- `qwen` -> `settings.json` y `oauth_creds.json`
- `copilot` -> usar credenciales de token en lugar de archivos de autenticación

## Referencia de la API

Todos los endpoints protegidos requieren:

```text
Authorization: Bearer <your-token>
```

Cuando `LLM_GATEWAY_AUTH_TOKEN` no está configurado, la autenticación queda deshabilitada para desarrollo local. `GET /health` siempre se mantiene público.

### Endpoints HTTP Principales

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Chequeo de salud público para monitores de uptime y plataformas como Coolify |
| `/metrics` | GET | Exportación de métricas Prometheus |
| `/v1/generate` | POST | Endpoint de generación nativo |
| `/v1/chat/completions` | POST | Chat completions compatible con OpenAI |
| `/v1/models` | GET | Listado de modelos compatible con OpenAI |
| `/v1/providers` | GET | Disponibilidad y metadata de proveedores |
| `/v1/latency` | GET | Mediciones de latencia actuales cuando el enrutamiento por latencia está habilitado |
| `/v1/cost/estimate` | GET | Estimación de costo para un modelo y cantidad de tokens |
| `/v1/cost/models` | GET | Tabla de precios de modelos |
| `/v1/usage` | GET | Registros de uso en crudo |
| `/v1/usage/summary` | GET | Resumen agregado de uso |
| `/v1/credentials` | POST / GET | Guardar y listar API keys cifradas |
| `/v1/credentials/:id` | DELETE | Eliminar una credencial guardada |
| `/v1/files` | POST / GET | Guardar y listar archivos de autenticación cifrados |
| `/v1/files/:id` | DELETE | Eliminar un archivo de autenticación guardado |
| `/v1/groups` | GET / POST | Listar o crear grupos de proveedores |
| `/v1/groups/:id` | PUT / DELETE | Actualizar o eliminar un grupo de proveedores |

### `POST /v1/generate`

Endpoint de generación nativo con selección de proveedor/modelo y resolución de credenciales con alcance de proyecto.

```bash
# Auto-select provider
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"prompt":"Explain quicksort in one paragraph"}'

# Explicit provider + model + project
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'X-Project: my-app' \
  -d '{
    "prompt":"Write a haiku about Rust",
    "provider":"groq",
    "model":"llama-3.3-70b-versatile",
    "maxTokens":256,
    "system":"You are a poet.",
    "project":"my-app"
  }'
```

Cuerpo del request:

| Campo | Tipo | Requerido | Descripción |
|-------|------|----------|-------------|
| `prompt` | string | Sí | Prompt del usuario |
| `system` | string | No | Prompt de sistema |
| `provider` | string | No | ID de proveedor preferido |
| `model` | string | No | ID de modelo específico |
| `maxTokens` | number | No | Máximo de tokens de salida |
| `project` | string | No | Alcance de credencial |
| `strict` | boolean | No | Comportamiento de enrutamiento estricto cuando está soportado |

Respuesta:

```json
{
  "text": "Quicksort is a divide-and-conquer...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "tokensUsed": 150,
  "requestedProvider": null,
  "requestedModel": null,
  "resolvedProvider": "anthropic",
  "resolvedModel": "claude-sonnet-4-20250514",
  "fallbackUsed": false
}
```

### `POST /v1/chat/completions`

Endpoint de chat compatible con OpenAI. Es el camino directo para herramientas que ya hablan el formato OpenAI.

- Se soportan requests con y sin streaming.
- Los mensajes de sistema se colapsan en el prompt de sistema.
- El contexto de conversación se reconstruye a partir de mensajes anteriores.
- La respuesta se mantiene compatible con OpenAI y agrega metadata `x_gateway`.

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "model":"claude-sonnet-4-20250514",
    "messages":[
      {"role":"system","content":"You are a helpful assistant."},
      {"role":"user","content":"What is the capital of France?"}
    ],
    "max_tokens":1024
  }'
```

Respuesta:

```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "claude-sonnet-4-20250514",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "The capital of France is Paris." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 150 },
  "x_gateway": {
    "requestedProvider": null,
    "requestedModel": "claude-sonnet-4-20250514",
    "resolvedProvider": "anthropic",
    "resolvedModel": "claude-sonnet-4-20250514",
    "fallbackUsed": false,
    "tokensUsed": 150
  }
}
```

### `GET /v1/models`

Lista los modelos disponibles en formato compatible con OpenAI.

```bash
curl http://localhost:3456/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-sonnet-4-20250514",
      "object": "model",
      "created": 0,
      "owned_by": "llm-gateway",
      "name": "Claude Sonnet 4",
      "provider": "anthropic",
      "max_tokens": 8192
    }
  ]
}
```

### `GET /v1/providers`

Lista los proveedores registrados y su disponibilidad.

```bash
curl http://localhost:3456/v1/providers \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "providers": [
    { "id": "anthropic", "name": "Anthropic", "type": "api", "available": true },
    { "id": "openai", "name": "OpenAI", "type": "api", "available": false },
    { "id": "opencode-cli", "name": "OpenCode CLI", "type": "cli", "available": true }
  ]
}
```

### API de Credenciales

Guarda API keys cifradas en reposo. La clave de upsert es `(provider, keyName, project)`.

```bash
# Global credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"anthropic",
    "keyName":"default",
    "apiKey":"sk-ant-api03-..."
  }'

# Project-scoped credential
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"openai",
    "keyName":"default",
    "apiKey":"sk-proj-...",
    "project":"my-app"
  }'
```

```json
{ "id": 1, "provider": "anthropic", "keyName": "default", "project": "_global" }
```

Listar credenciales:

```bash
curl http://localhost:3456/v1/credentials \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl 'http://localhost:3456/v1/credentials?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "credentials": [
    {
      "id": 1,
      "provider": "anthropic",
      "keyName": "default",
      "project": "_global",
      "maskedValue": "sk-ant-...***",
      "createdAt": "2025-01-15 10:30:00",
      "updatedAt": "2025-01-15 10:30:00"
    }
  ]
}
```

Eliminar una credencial:

```bash
curl -X DELETE http://localhost:3456/v1/credentials/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### API de Archivos de Autenticación

Guarda archivos de autenticación para proveedores respaldados por CLI, cifrados en reposo. La clave de upsert es `(provider, fileName, project)`.

Este es el camino que preserva los flujos legacy de `auth.json` y `.credentials.json`.

```bash
# OpenCode auth.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"opencode",
    "fileName":"auth.json",
    "content":"{\"token\":\"oc-...\"}",
    "project":"_global"
  }'

# Claude CLI .credentials.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"claude",
    "fileName":".credentials.json",
    "content":"{\"claudeAiOauth\":{...}}",
    "project":"my-app"
  }'
```

```json
{ "id": 1, "provider": "opencode", "fileName": "auth.json", "project": "_global" }
```

Listar archivos de autenticación:

```bash
curl http://localhost:3456/v1/files \
  -H 'Authorization: Bearer YOUR_TOKEN'

curl 'http://localhost:3456/v1/files?project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

```json
{
  "files": [
    {
      "id": 1,
      "provider": "opencode",
      "fileName": "auth.json",
      "project": "_global",
      "createdAt": "2025-01-15"
    }
  ]
}
```

Eliminar un archivo de autenticación:

```bash
curl -X DELETE http://localhost:3456/v1/files/1 \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### Uso, Costo, Métricas y Salud

Registros de uso:

```bash
curl 'http://localhost:3456/v1/usage?project=my-app&limit=50' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Resumen de uso:

```bash
curl 'http://localhost:3456/v1/usage/summary?groupBy=provider&project=my-app' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Estimación de costo:

```bash
curl 'http://localhost:3456/v1/cost/estimate?model=claude-sonnet-4-20250514&inputTokens=1000&outputTokens=500' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Métricas Prometheus:

```bash
curl http://localhost:3456/metrics \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Chequeo de salud:

```bash
curl http://localhost:3456/health
```

`GET /health` devuelve la constante de runtime `VERSION` (`src/core/constants.ts`) más uptime, modo de autenticación y conteo de proveedores:

```json
{
  "status": "ok",
  "version": "0.3.1",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 3600,
  "auth": { "enabled": true, "mode": "bearer" },
  "providers": { "total": 11, "available": 3 }
}
```

Nota: la constante `VERSION` y el campo `version` de `package.json` no se mantienen sincronizados — `/health` reporta la primera.

### Grupos de Proveedores

Los grupos de proveedores te permiten definir pools lógicos para balanceo y failover.

```bash
curl -X POST http://localhost:3456/v1/groups \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "name":"fast-models",
    "modelPattern":"gpt-*,claude-*",
    "members":[
      {"provider":"groq","weight":2,"priority":1},
      {"provider":"anthropic","weight":1,"priority":2}
    ],
    "strategy":"weighted",
    "stickyTTL":300
  }'
```

## Proveedores

### Proveedores de API

| Proveedor | ID | Autenticación | Modelos de Ejemplo |
|----------|----|------|----------------|
| Anthropic | `anthropic` | API key | `claude-sonnet-4-20250514`, `claude-haiku-4-20250414` |
| OpenAI | `openai` | API key | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| Google | `google` | API key | `gemini-2.5-flash`, `gemini-2.5-pro` |
| Groq | `groq` | API key | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |
| OpenRouter | `openrouter` | API key | `deepseek/deepseek-chat`, `anthropic/claude-sonnet-4` |

### Proveedores CLI

| Proveedor | ID | Material de Autenticación | Notas |
|----------|----|---------------|-------|
| OpenCode CLI | `opencode-cli` | `auth.json` del vault | Catálogo de modelos amplio vía enrutamiento por suscripción |
| Claude CLI | `claude-cli` | `.credentials.json` del vault | Usa credenciales de Claude Max |
| Gemini CLI | `gemini-cli` | Archivos de autenticación de la CLI | Ejecución local respaldada por CLI |
| Codex CLI | `codex-cli` | `auth.json` | Ejecución respaldada por la CLI de OpenAI |
| Qwen CLI | `qwen-cli` | Archivos de autenticación de la CLI | Acceso local/por suscripción a Qwen |
| Copilot CLI | `copilot-cli` | credenciales de token | Enrutamiento respaldado por GitHub Copilot |

### Cobertura de Modelos de OpenCode

OpenCode es el catálogo más grande acá y es una de las razones por las que este bridge resulta útil.

`GET /v1/models` se refresca desde `opencode models` (TTL 5 min). El fallback
del adaptador es el nivel gratuito `opencode/*` más los ids de suscripción
`opencode-go/*`; discovery agrega lo demás que liste el CLI (`google/*`,
`antigravity/*`, `openai/*`, `kimi-for-coding/*`). Anthropic y GitHub Copilot
**no** se anuncian salvo que el CLI los liste.

Ejemplos representativos:

- `opencode-go/deepseek-v4-flash`
- `opencode/big-pickle`
- `opencode-go/kimi-k2.7-code`
- `openai/gpt-5.4`

### Prioridad de Proveedores y Fallback

Comportamiento por defecto sin un proveedor/modelo explícito:

1. Se prueban primero los proveedores de API.
2. Los proveedores CLI siguen como fallback.
3. Si se solicita un modelo explícitamente, se prefiere el proveedor propietario.
4. Si el enrutamiento del bridge está habilitado, el bridge puede sobrescribir la elección inicial de proveedor y luego recorrer la cadena de fallback configurada.

## Autenticación

### Bearer Token

Configurá `LLM_GATEWAY_AUTH_TOKEN` para proteger las rutas HTTP.

```bash
# Generate a secure token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

export LLM_GATEWAY_AUTH_TOKEN="your-64-char-hex-token"
```

El token debe tener al menos 32 caracteres.

### Reglas de Autenticación

| Ruta | Requiere Bearer Auth |
|------|:-------------:|
| `GET /health` | No |
| `OPTIONS *` (preflight CORS) | No |
| `/auth/github/*` | No |
| `/v1/admin/*` (toda la superficie de admin) | No |
| Todas las demás rutas HTTP, incluyendo el dashboard y `/metrics`, cuando el token está configurado | Sí |

Comportamiento importante:

- El middleware de bearer-auth se salta **todo** el prefijo `/v1/admin/*`, no solo `/v1/admin/auth-config`. Las rutas de admin se protegen con sus propios chequeos JWT de dashboard/GitHub-OAuth (`verifyDashboardJwt`) en lugar del bearer token estático. Tené esto en cuenta al exponer el gateway públicamente.
- El dashboard (rutas no-admin) está protegido cuando el bearer auth está habilitado.
- MCP stdio no usa bearer auth HTTP porque corre como proceso local.
- La comparación de tokens es de tiempo constante vía `timingSafeEqual`.

### Alcance de Proyecto

El alcance de proyecto puede proveerse en cualquiera de estos lugares:

1. Campo del cuerpo JSON: `"project": "my-app"`
2. Header: `X-Project: my-app`

El campo del cuerpo tiene prioridad sobre el header.

## Gestión de Credenciales

### Credenciales Globales vs. de Proyecto

La resolución de credenciales sigue el mismo patrón para API keys y archivos de autenticación:

1. Probar la entrada específica del proyecto.
2. Recurrir a `_global`.

Eso te permite mantener un valor por defecto compartido mientras seguís aislando overrides por app o cliente.

### Claves de API

Las API keys se cifran con AES-256-GCM y se guardan en SQLite.

```bash
# Global key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-..."}'

# Project key
curl -X POST http://localhost:3456/v1/credentials \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{"provider":"anthropic","apiKey":"sk-ant-project-...","project":"my-app"}'
```

### Archivos de Autenticación

Los adaptadores CLI usan autenticación basada en archivos cuando es necesario. Estos archivos también se cifran y se guardan en el vault.

```bash
# OpenCode auth.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"opencode",
    "fileName":"auth.json",
    "content":"{\"token\":\"oc-...\"}"
  }'

# Claude CLI .credentials.json
curl -X POST http://localhost:3456/v1/files \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "provider":"claude",
    "fileName":".credentials.json",
    "content":"{\"claudeAiOauth\":{...}}"
  }'
```

### Patrón de Sincronización de Credenciales de Claude y OpenCode

La capa de vault también contiene una integración OAuth de Claude que:

1. Lee `~/.claude/.credentials.json`
2. Refresca el token cuando es necesario
3. Sincroniza el token a un `auth.json` estilo OpenCode

Eso importa porque este bridge puede unificar los flujos de autenticación de Claude CLI y OpenCode en lugar de tratarlos como silos de credenciales separados.

## Puente entre Modelos

El bridge es una capa de enrutamiento opcional manejada por `~/.llm-gateway/bridge.yaml`.

Flujo:

1. Clasificar el prompt en un tipo de tarea.
2. Resolver un proveedor preferido desde `routes`.
3. Probar ese proveedor primero.
4. Recorrer `fallback_order` secuencialmente si falla.

### Tipos de Tareas Soportados

| Tipo de Tarea | Heurística | Ruta Típica |
|-----------|-----------|---------------|
| `large-context` | Prompt/contexto muy grande | `gemini-cli` |
| `code-review` | Palabras clave de review/auditoría/refactor | `claude-cli` |
| `fast-completion` | Prompt corto | `groq` |
| `default` | Ninguna heurística coincidió | default configurado |

### Ejemplo de `bridge.yaml`

```yaml
routes:
  large-context: gemini-cli
  code-review: claude-cli
  fast-completion: groq

default: claude-cli

fallback_order:
  - claude-cli
  - gemini-cli
  - opencode-cli
  - anthropic
  - groq
```

Si el archivo no existe, el bridge queda deshabilitado y se usa el comportamiento normal del router.

### Metadata de Respuesta del Bridge

| Campo | Descripción |
|-------|-------------|
| `text` | Texto generado |
| `provider` | Proveedor que respondió |
| `model` | Modelo usado |
| `taskType` | Tipo de tarea clasificado |
| `fallbackUsed` | Si un proveedor no primario lo manejó |
| `latencyMs` | Latencia de punta a punta |

## Compresión de Contexto

El `CompressorService` agrega compresión de contexto en segundo plano con cacheo.

### Estrategias

| Estrategia | Cómo Funciona | Buena Para |
|----------|-------------|----------|
| `extractive` | Conserva las oraciones mejor puntuadas | texto general |
| `structural` | Preserva encabezados y estructura de listas | markdown/docs |
| `token-budget` | Recorta a un presupuesto de tamaño en límites de oración | límites duros de tokens |

### Uso

```typescript
import { CompressorService } from './context-compression/index.js';

const compressor = new CompressorService({
  maxCacheSize: 200,
  workerIntervalMs: 5000,
  defaultStrategy: 'extractive',
  defaultRatio: 0.5,
});

compressor.submit(longContext);
const compressed = compressor.getCompressed(longContext);
const immediate = compressor.compressNow(longContext, 'structural');
compressor.destroy();
```

### Características Operativas

- Cache LRU para contenido repetido
- Worker en segundo plano para precómputo no bloqueante
- Compresión síncrona cuando necesitás el resultado de inmediato
- Útil para pipelines de prompts donde el contexto en crudo, de otro modo, reventaría los presupuestos de tokens

## Búsqueda Semántica de Código

El subsistema de búsqueda de código expone tres modos de búsqueda a través de MCP:

- **keyword** (por defecto): matching exacto/por prefijo/difuso con índice invertido
- **vector**: similitud semántica vía embeddings densos
- **hybrid**: fusión RRF de keyword + BM25 + vector para los mejores resultados

Combina:

- chunking basado en regex
- búsqueda difusa por trigramas
- puntuación keyword BM25 (vía MiniSearch)
- similitud de vectores densos (vía embeddings de transformer)
- Reciprocal Rank Fusion (RRF) para ranking híbrido
- seguimiento opcional de imports multi-hop

### Lenguajes Soportados

`DEFAULT_EXTENSIONS` (indexados por defecto) cubre:

`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.lua`

Existen patrones de chunking dedicados para TypeScript/JavaScript, Python, Go y Rust. Otras extensiones indexadas (`.java`, `.rb`, `.lua`) recurren a los patrones de chunking de la familia TypeScript/C.

### Herramientas de Búsqueda MCP

`index_codebase`:

```json
{
  "rootDir": "/path/to/project",
  "extensions": [".ts", ".js"],
  "ignorePatterns": ["node_modules", "dist"]
}
```

`code_search`:

```json
{
  "query": "authentication middleware",
  "scope": "/path/to/project",
  "limit": 10,
  "followImports": true,
  "mode": "hybrid"
}
```

Los resultados devueltos incluyen ruta de archivo, nombre de símbolo, tipo, contenido, números de línea, puntaje y chunks relacionados cuando el seguimiento de imports está habilitado.

### Modos de Búsqueda

| Modo | Descripción | Mejor Para |
|------|-------------|----------|
| `keyword` | Matching exacto de tokens, búsqueda por prefijo, fallback difuso por trigramas | Nombres de símbolo conocidos, rápido, sin necesidad de modelo |
| `vector` | Similitud de coseno sobre embeddings de 384 dimensiones | Consultas conceptuales, sinónimos, relación semántica |
| `hybrid` | Fusión RRF de keyword + BM25 + vector | Uso general — combina precisión + recall |

El **modo keyword** es el default y no requiere configuración. Puntúa más alto los matches exactos de nombre, luego los matches por prefijo, luego keyword-en-contenido, luego similitud difusa por trigramas.

El **modo vector** usa un modelo de embeddings local (`Xenova/all-MiniLM-L6-v2`, un modelo pequeño de 384 dimensiones). En la primera ejecución el modelo se descarga automáticamente desde HuggingFace y se cachea localmente. La búsqueda vectorial encuentra código semánticamente relacionado incluso cuando las keywords no coinciden.

El **modo hybrid** corre las tres estrategias en paralelo y fusiona los rankings con Reciprocal Rank Fusion (RRF). Los resultados incluyen `rrfScore` (el puntaje fusionado) y `methodCount` (cuántas estrategias encontraron el resultado). Los ítems encontrados por múltiples métodos rankean más alto, dando la mejor cobertura general.

### Modelo de Embeddings

- Modelo: `Xenova/all-MiniLM-L6-v2` (pequeño, 384 dimensiones)
- Backend: `@xenova/transformers` (runtime ONNX, corre localmente)
- Primera ejecución: el modelo se descarga automáticamente y se cachea en `~/.cache/huggingface/`
- Fallback: si el modelo local falla al cargar, el embedder puede recurrir a la API de OpenAI (`text-embedding-3-small`) cuando `OPENAI_API_KEY` está configurada

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `EMBEDDER_MODE` | `local` | `local` usa el transformer de Xenova; `api` fuerza la API de OpenAI |
| `OPENAI_API_KEY` | — | Clave del embedder API de fallback (opcional) |
| `VOYAGE_API_KEY` | — | Clave alternativa del embedder API (opcional) |
| `TRANSFORMERS_OFFLINE` | — | Configurar en `1` para usar solo el modelo cacheado, sin descarga |

## Estado Multi-Agente CRDT

La herramienta MCP `shared_state` le da a los agentes una capa de estado compartido libre de conflictos.

### CRDTs Soportados

| Tipo | Semántica de Merge | Buena Para |
|------|-----------------|----------|
| `g-counter` | merge de contador máximo por nodo | seguimiento de tokens/requests |
| `lww-register` | last-writer-wins por timestamp | estado/asignación |
| `or-set` | conjunto observed-remove | hallazgos o artefactos compartidos |

### Ejemplos de Operaciones

```json
{ "op": "write", "key": "tokens", "type": "g-counter", "nodeId": "agent-1", "amount": 150 }
{ "op": "write", "key": "status", "type": "lww-register", "nodeId": "agent-1", "value": "analyzing" }
{ "op": "write", "key": "findings", "type": "or-set", "nodeId": "agent-1", "action": "add", "element": "Issue in auth.ts:42" }
{ "op": "read", "key": "findings" }
{ "op": "snapshot" }
{ "op": "merge", "snapshot": { "entries": {} } }
```

Esto es útil cuando múltiples agentes de codificación o review necesitan coordinarse sin locking centralizado.

## Integraciones

### OpenCode

Configurá OpenCode para tratar al gateway como un proveedor compatible con OpenAI.

```json
{
  "provider": {
    "llm-gateway": {
      "name": "LLM Gateway",
      "api": "openai",
      "apiKey": "env:LLM_GATEWAY_TOKEN",
      "baseURL": "https://llm-gateway.yourdomain.com/v1",
      "models": {
        "gateway-anthropic": {
          "name": "Anthropic via Gateway",
          "id": "claude-sonnet-4-20250514",
          "contextWindow": 200000,
          "maxOutput": 8192
        },
        "gateway-groq": {
          "name": "Groq via Gateway",
          "id": "llama-3.3-70b-versatile",
          "contextWindow": 128000,
          "maxOutput": 4096
        }
      }
    }
  }
}
```

```bash
export LLM_GATEWAY_TOKEN="your-gateway-auth-token"
opencode
```

### GHAGGA

[GHAGGA](https://github.com/JNZader/ghagga) puede usar el bridge como proveedor.

1. Seleccioná `LLM Gateway` en el dashboard de GHAGGA.
2. Ingresá la URL base del gateway.
3. Ingresá el bearer token del gateway.
4. Elegí un modelo.

Modos de review típicos enrutados a través del gateway:

- simple
- workflow
- consensus

### Cualquier Herramienta Compatible con OpenAI

Configuración general:

| Configuración | Valor |
|---------|-------|
| URL Base | `https://llm-gateway.yourdomain.com/v1` |
| API Key | tu `LLM_GATEWAY_AUTH_TOKEN` |

Funciona con LangChain, LlamaIndex, Cursor, Continue y cualquier cliente HTTP que pueda llamar a `/v1/chat/completions`.

Ejemplo en LangChain Python:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://llm-gateway.yourdomain.com/v1",
    api_key="your-gateway-token",
    model="claude-sonnet-4-20250514",
)

response = llm.invoke("Explain quicksort")
print(response.content)
```

Ejemplo en LangChain TypeScript:

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  configuration: {
    baseURL: 'https://llm-gateway.yourdomain.com/v1',
  },
  apiKey: 'your-gateway-token',
  model: 'claude-sonnet-4-20250514',
});

const response = await llm.invoke('Explain quicksort');
```

## Despliegue con Docker

### Docker Compose

```yaml
services:
  llm-gateway:
    build: .
    ports:
      - "3456:3456"
    volumes:
      - llm-data:/root/.llm-gateway
    environment:
      - LLM_GATEWAY_PORT=3456
      - LLM_GATEWAY_AUTH_TOKEN=your-secure-token-here
      - LLM_GATEWAY_MASTER_KEY=your-64-char-hex-key
volumes:
  llm-data:
```

```bash
docker compose up -d
```

### Build y Ejecución con Docker

```bash
docker build -t llm-gateway .

docker run -d \
  -p 3456:3456 \
  -v llm-data:/root/.llm-gateway \
  -e LLM_GATEWAY_AUTH_TOKEN="your-token" \
  -e LLM_GATEWAY_MASTER_KEY="your-64-char-hex-key" \
  llm-gateway
```

### Qué Incluye la Imagen

El Dockerfile actualmente instala:

- `pnpm` 9
- OpenCode CLI
- Claude Code CLI
- Gemini CLI
- Codex CLI
- Qwen CLI
- GitHub Copilot CLI

### Coolify

1. Creá un nuevo servicio apuntando a este repositorio.
2. Usá el build pack de Dockerfile.
3. Configurá variables de entorno como `LLM_GATEWAY_PORT`, `LLM_GATEWAY_AUTH_TOKEN` y, opcionalmente, `LLM_GATEWAY_MASTER_KEY`.
4. Montá un volumen persistente en `/root/.llm-gateway`.
5. Usá `/health` para los chequeos de salud.

## Servidor MCP

El proyecto corre como servidor MCP stdio por defecto.

### Herramientas MCP Principales

| Herramienta | Descripción |
|------|-------------|
| `llm_generate` | Generar texto con enrutamiento de proveedor y fallback |
| `llm_models` | Listar modelos disponibles |
| `vault_store`, `vault_list`, `vault_delete` | Gestión de API keys |
| `vault_store_file`, `vault_list_files`, `vault_delete_file` | Gestión de archivos de autenticación |
| `code_search`, `index_codebase` | Búsqueda semántica de código |
| `shared_state` | Estado compartido CRDT |
| `list_groups`, `create_group`, `delete_group` | Gestión de grupos de proveedores |
| `usage_summary`, `usage_query` | Inspección de costo y uso |
| `configure_circuit_breaker`, `circuit_breaker_stats` | Ajuste de control de fallas de proveedores |
| `discover_models` | Disparar el descubrimiento de modelos enriquecido con HuggingFace |
| `approval_list`, `approval_approve`, `approval_deny` | Gestión de flujo de aprobación (ver [Flujos de Aprobación](#flujos-de-aprobación)) |

### Herramientas de Conversación PageIndex

Siete herramientas MCP estáticas adicionales (definidas en `src/pageindex/tools.ts`) manejan la paginación de conversaciones largas y la navegación basada en razonamiento sobre el historial de conversación guardado:

| Herramienta | Descripción |
|------|-------------|
| `conversation_paginate` | Paginar una conversación guardada |
| `conversation_get_page` | Obtener una página específica |
| `conversation_context` | Recuperar contexto alrededor de un punto de la conversación |
| `conversation_navigate` | Navegar entre páginas/secciones |
| `conversation_info` | Resumen/metadata de una conversación |
| `conversation_find_relevant` | Encontrar las páginas más relevantes para una consulta |
| `conversation_check_compaction` | Verificar si la conversación debería compactarse |

Estas están categorizadas como herramientas `read`, por lo que están disponibles tanto bajo el perfil de seguridad `local-dev` como el `restricted`.

### Configuración de Claude Code

Agregá a `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

Para un checkout local del código fuente:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-llm-bridge/src/index.ts"]
    }
  }
}
```

### Configuración de Claude Desktop

Agregá a `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "mcp-llm-bridge"
    }
  }
}
```

MCP stdio corre localmente y no usa el middleware de bearer-token HTTP.

## Servidores MCP Dinámicos

El bridge soporta la carga de archivos plugin `.mcp-server.js` externos en tiempo de ejecución. Esto te permite extender el conjunto de herramientas sin modificar el código base central.

### Qué Es

Cualquier archivo `.mcp-server.js` colocado en el directorio de plugins se carga al inicio y sus herramientas se registran junto a las herramientas estáticas (30 al momento de escribir esto: 23 herramientas core más 7 herramientas de conversación PageIndex). Los plugins exportan un objeto `McpServerDefinition` (o usan el builder) con herramientas, recursos y prompts.

### Habilitar

Configurá `MCP_DYNAMIC_SERVERS=true`:

```bash
export MCP_DYNAMIC_SERVERS=true
export MCP_SERVERS_DIR=./mcp-servers
```

### Crear un Plugin

Creá un archivo `.mcp-server.js` en el directorio de plugins:

```javascript
import { McpServerBuilder } from 'mcp-llm-bridge/mcp-builder';

export default new McpServerBuilder()
  .tool('greet', 'Say hello to someone', { name: { type: 'string' } }, async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  })
  .build();
```

El builder valida las convenciones de nombres, la completitud del schema y la calidad de la descripción. Las herramientas se registran en el servidor MCP y aparecen en `ListTools`.

### Directorio

El directorio de plugins por defecto es `./mcp-servers`. Se puede sobrescribir con:

```bash
export MCP_SERVERS_DIR=./my-custom-plugins
```

### Seguridad

Las herramientas dinámicas se registran con la categoría `read` por defecto. Esto significa que están:

- **Permitidas** bajo los perfiles `local-dev` y `restricted`
- **Bloqueadas** bajo el perfil `open` (que solo permite herramientas `generate`)

El enforcer aplica el mismo filtrado basado en categorías a las herramientas dinámicas que a las herramientas estáticas.

### Coexistencia con Herramientas Estáticas

Las herramientas estáticas (vault, search, generate, etc.) y las herramientas dinámicas aparecen juntas en la respuesta de `ListTools`. No hay namespacing — los nombres de herramientas deben ser únicos entre ambos conjuntos. El flujo de aprobación y el rate limiting se aplican de forma uniforme a todas las herramientas.

## Configuración

### Variables de Entorno Principales

| Variable | Default | Descripción |
|----------|---------|-------------|
| `LLM_GATEWAY_PORT` | `3456` | Puerto del servidor HTTP |
| `LLM_GATEWAY_DB_PATH` | `~/.llm-gateway/vault.db` | Ruta del vault SQLite |
| `LLM_GATEWAY_MASTER_KEY` | autogenerada | Clave hex de 64 caracteres, si no se guarda en `~/.llm-gateway/master.key` |
| `LLM_GATEWAY_AUTH_TOKEN` | sin configurar | Bearer token para rutas HTTP |
| `LLM_GATEWAY_AUTH_REQUIRED` | sin configurar | Forzar la autenticación on/off explícitamente |
| `LLM_GATEWAY_SECURITY_PROFILE` | `local-dev` | Perfil de seguridad para la exposición de herramientas MCP |

### Funcionalidades Opcionales en Tiempo de Ejecución

| Variable | Efecto |
|----------|--------|
| `FALLBACK_STRATEGY=free-models` | habilita el enrutamiento de fallback a modelos gratuitos |
| `FREE_MODEL_CATALOG=true` | carga el catálogo de modelos gratuitos al inicio |
| `LATENCY_ROUTING=true` | habilita el enrutamiento basado en latencia |
| `MAX_COMPARISON_COST_USD` | limita el gasto del servicio de comparación |

### Prioridad de la Clave Maestra

1. `LLM_GATEWAY_MASTER_KEY`
2. `~/.llm-gateway/master.key` existente
3. clave nueva autogenerada, escrita con modo `0600`

Si perdés la clave maestra, las credenciales guardadas quedan irrecuperables. Hacé backup de ella en producción.

### Ruta de Configuración del Bridge

`~/.llm-gateway/bridge.yaml`

Si ese archivo no existe, el enrutamiento del bridge queda deshabilitado.

## Perfiles de Seguridad

Los perfiles de seguridad aplican control de acceso basado en nivel de confianza tanto sobre las herramientas MCP como sobre los endpoints HTTP. Hay tres perfiles incorporados:

| Perfil | Categorías Permitidas | Rate Limit | Sandbox |
|---------|-------------------|------------|---------|
| `local-dev` | todas (destructive, read, generate, admin) | ninguno | false |
| `restricted` | solo read + generate | 100 req / 15 min | false |
| `open` | solo generate | 10 req / 15 min | false |

### Configuración

Se configura vía variable de entorno:

```bash
LLM_GATEWAY_SECURITY_PROFILE=restricted
```

El default es `local-dev` (retrocompatible — sin restricciones).

Cada perfil también trae un flag `sandbox` (default `false`). Hoy este flag se entiende mejor como infraestructura preparada, no como una garantía de ejecución sandboxeada en runtime: está expuesto en el schema del perfil y a través de la API de admin, y el repo incluye un runner de sandbox Docker/proceso bajo `src/sandbox/`, pero el runtime activo todavía no expone herramientas de ejecución sandboxeada ni enruta la ejecución normal de herramientas a través de ese runner. Notá además que el helper recurre a ejecución de proceso plano con timeout cuando Docker no está disponible, así que esto no debería tratarse como contención completa.

### Aplicación HTTP

Bajo `restricted` u `open`, el gateway bloquea los endpoints HTTP destructivos (p. ej., `POST /v1/credentials`) y devuelve:

```json
{ "error": "Access denied: endpoint blocked by security profile", "code": "SECURITY_PROFILE_DENIED" }
```

Los endpoints de lectura (`GET /v1/providers`, `GET /v1/models`) siguen abiertos bajo `restricted`.

### Aplicación MCP

Bajo perfiles distintos de `local-dev`, `ListTools` devuelve solo las herramientas en las categorías permitidas. `CallTool` se autoriza antes de la ejecución. El rate limiting se aplica por perfil.

## Flujos de Aprobación

Las herramientas MCP destructivas pueden pausarse para aprobación humana explícita cuando el perfil de seguridad no es `local-dev`.

### Cómo Funciona

1. El cliente llama a una herramienta destructiva (p. ej., `vault_store`).
2. Si se requiere aprobación, el gateway devuelve un payload `approvalRequired` con un `requestId`.
3. El administrador revisa las solicitudes pendientes vía `GET /v1/approvals` o la herramienta MCP `approval_list`.
4. El administrador aprueba o rechaza vía `POST /v1/approvals/:id/approve` o la herramienta MCP `approval_approve`.
5. La herramienta original se ejecuta solo después de la aprobación.

### Lista de Auto-Aprobación

Las herramientas de solo lectura (`file_read`, `search`, `list`, `vault_list`) evitan la aprobación automáticamente.

### Endpoints HTTP

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/v1/approvals` | GET | Listar solicitudes de aprobación pendientes |
| `/v1/approvals/:id/approve` | POST | Aprobar una solicitud |
| `/v1/approvals/:id/deny` | POST | Rechazar una solicitud |

### Herramientas MCP

| Herramienta | Descripción |
|------|-------------|
| `approval_list` | Listar solicitudes pendientes |
| `approval_approve` | Aprobar por ID de solicitud |
| `approval_deny` | Rechazar por ID de solicitud |

## Prompt de Tres Partes

El patrón de prompt de tres partes separa los prompts en `system` (rol/restricciones), `context` (datos de fondo) e `instruction` (la tarea en sí). La investigación muestra una mejora medible en la calidad, especialmente con modelos más chicos.

### HTTP API

Tanto `/v1/generate` como `/v1/chat/completions` aceptan los tres campos:

```bash
curl -X POST http://localhost:3456/v1/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "system": "You are a code reviewer.",
    "context": "We use Zod 4 and Hono.",
    "instruction": "Review this schema for edge cases."
  }'
```

El campo plano legacy `prompt` sigue siendo aceptado y se auto-detecta cuando `system`/`context`/`instruction` están ausentes.

### Esquema MCP

La herramienta `llm_generate` expone `system`, `context` e `instruction` como campos opcionales junto al `prompt` legacy:

```json
{
  "system": "You are a helpful assistant.",
  "context": "The project uses TypeScript.",
  "instruction": "Explain strict mode benefits."
}
```

### Habilitar/Deshabilitar

```bash
OPTIMIZE_MESSAGES_ENABLED=true   # default: true
```

## Compresión de Salida RTK

La compresión estilo RTK elimina contenido redundante de los resultados de llamadas a herramientas antes de pasarlos a los LLM. Esto ahorra presupuesto de tokens en salidas estructuradas grandes.

### Estrategias

1. **Filter** — elimina campos ruidosos (`created_at`, `id`, `etag`, etc.)
2. **Group** — fusiona entradas similares repetidas en conteo + muestra
3. **Truncate** — impone longitud máxima en valores string
4. **Deduplicate** — elimina entradas de array exactamente duplicadas

### Configuración

```bash
ENABLE_OUTPUT_COMPRESSION=true   # default: true
```

### Endpoint de Analíticas

```bash
curl http://localhost:3456/v1/compression/stats \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Respuesta:

```json
{ "totalCalls": 42, "compressedCalls": 42, "avgRatio": 0.65, "totalSavingsChars": 15200 }
```

## Offloading a LLM Local

Las tareas offloadeables (resumen, formateo, clasificación) pueden enrutarse a runtimes locales (Ollama, LM Studio) en lugar de proveedores cloud, reduciendo el costo de tokens de API en esas tareas determinísticas. (El módulo `src/local-llm/` documenta un objetivo de diseño de 86–95% de ahorro de tokens en tareas de boilerplate; esto es un objetivo de diseño, no un benchmark medido.)

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `LOCAL_LLM_ENABLED` | `false` | Habilitar el enrutamiento a LLM local |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint de la API de Ollama |
| `LM_STUDIO_URL` | `http://localhost:1234` | Endpoint de la API de LM Studio |

### Detección

Al inicio, el gateway sondea ambos backends. Los modelos se listan en:

```bash
curl http://localhost:3456/v1/local/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

### Fallback

Si el LLM local falla o la tarea no es offloadeable, el gateway recurre automáticamente a los proveedores cloud y emite una métrica.

### Herramienta MCP

| Herramienta | Descripción |
|------|-------------|
| `local_llm_generate` | Generar vía LLM local con detección de offload |

## Enrutamiento de Modelos

El enrutamiento de modelos agrega selección de proveedor sensible a la tarea que clasifica cada prompt y lo enruta según reglas configuradas, orden de endpoint preferido, niveles de costo y feedback de calidad observado.

### Qué Hace

- **Clasifica** los prompts entrantes en tipos de tarea de runtime como `code-review`, `large-context`, `fast-completion`, `summarization` y `translation`
- **Compara** la tarea contra las reglas de enrutamiento definidas en `model-routing.json`
- **Prueba** los endpoints preferidos en el orden de la regla mientras aplica el límite de costo configurado
- **Recurre** a endpoints más costosos si la calidad cae por debajo del umbral
- **Aprende** del feedback — registra éxito/fallo por endpoint+tarea para enrutamiento adaptativo

### Habilitar

```bash
MODEL_ROUTING_ENABLED=true
```

Cuando está habilitado, la pila de precedencia queda así:

1. Sticky sessions
2. Enrutamiento basado en grupos
3. **ModelRouter** (selección sensible a la tarea)
4. Offloading a LLM local (solo si ModelRouter está deshabilitado o no encuentra match)
5. Resolución estándar (match de modelo → preferencia de proveedor → API antes que CLI)
6. Reordenamiento por latencia

### Configuración

Creá `model-routing.json` en la raíz del proyecto. El gateway lo carga al inicio.

```json
{
  "enabled": true,
  "endpoints": [...],
  "rules": [...],
  "defaultEndpoint": "opencode-cli-default",
  "qualityThreshold": 0.7,
  "qualityWindowSize": 50
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `enabled` | boolean | Si el enrutamiento de modelos está activo |
| `endpoints` | array | Endpoints de modelo disponibles con nivel de costo y capacidades |
| `rules` | array | Reglas de enrutamiento tarea-a-endpoint (gana el primer match) |
| `defaultEndpoint` | string | ID de endpoint de fallback cuando ninguna regla coincide |
| `qualityThreshold` | number | Tasa mínima de calidad aceptable (0–1) |
| `qualityWindowSize` | number | Cantidad de requests recientes a rastrear por endpoint+tarea |

**Campos de endpoint:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único de endpoint |
| `providerId` | string | ID de proveedor (p. ej., `anthropic`, `openai`, `opencode-cli`) |
| `model` | string | ID de modelo para llamadas a la API |
| `costTier` | string | `free`, `cheap`, `standard`, o `expensive` |
| `capabilities` | array | Tags de capacidad (p. ej., `chat`, `code`, `reasoning`) |
| `maxTokens` | number | Ventana de contexto máxima en tokens |

**Campos de regla:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único de regla |
| `taskType` | string | Uno de `large-context`, `code-review`, `fast-completion`, `default`, `boilerplate`, `commit-message`, `format-conversion`, `style-check`, `summarization`, `translation`, `not-offloadable`, o `*` |
| `preferredEndpoints` | array | Lista ordenada de IDs de endpoint a probar |
| `maxCostTier` | string | El nivel más costoso permitido para esta tarea |
| `allowFallback` | boolean | Si recurrir al endpoint por defecto cuando todos los preferidos fallan |

### Ejemplos de Mapeo Tarea-a-Endpoint

| Tipo de Tarea | Endpoints Preferidos | Límite de Costo |
|-----------|---------------------|----------|
| `code-review` | Claude Sonnet → GPT-4.1 | `expensive` |
| `large-context` | Claude Sonnet → GPT-4.1 | `expensive` |
| `fast-completion` | GPT-4.1-mini → OpenCode CLI | `standard` |
| `summarization` | GPT-4.1 → Claude Sonnet | `expensive` |
| `*` (default) | OpenCode CLI → GPT-4.1-mini | `standard` |

### Coexistencia con Offloading a LLM Local

El offloading a LLM local y el enrutamiento de modelos trabajan juntos con una precedencia clara:

- **ModelRouter corre primero.** Si selecciona un endpoint, ese proveedor se promueve al tope de la lista de candidatos.
- **El offloading a LLM local corre solo cuando ModelRouter está deshabilitado o no encuentra match.** Esto evita conflictos: las reglas de enrutamiento explícitas siempre le ganan al offloading heurístico.

Si querés incluir modelos locales en tu mezcla de enrutamiento, registralos como endpoints con `"costTier": "free"` e incluilos en `preferredEndpoints` de la regla.

### Archivo de Ejemplo

Mirá `model-routing.example.json` en la raíz del repositorio para un template completo con múltiples endpoints y reglas de enrutamiento.

## Auto-Descubrimiento HF

Al inicio (cuando está habilitado), el gateway escanea los backends locales y enriquece los modelos detectados con metadata de HuggingFace (tags, tipo de pipeline, tareas recomendadas).

### Configuración

```bash
AUTO_DISCOVER_MODELS=true   # default: false
HF_TOKEN=hf_xxxxxxxxxx       # optional, for private repos
```

### Endpoint de Administración

Disparar el descubrimiento a demanda:

```bash
curl -X POST http://localhost:3456/v1/admin/discover \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "hfToken": "optional-override" }'
```

Respuesta:

```json
{
  "ok": true,
  "backendsScanned": ["ollama", "lm-studio"],
  "models": [...],
  "enrichedCount": 3,
  "unenrichedCount": 1
}
```

### Cache

La metadata enriquecida se persiste en SQLite (tabla `hf_model_cache`) para que los inicios subsiguientes sean rápidos incluso sin acceso a la API de HF.

## Arquitectura

```text
Clients (GHAGGA, OpenCode, curl, LangChain, any OpenAI-compatible tool)
    |
    |  POST /v1/chat/completions  |  POST /v1/generate  |  MCP stdio
    v
+-------------------------------------------------------------------+
|                    MCP LLM Bridge (Hono + MCP)                    |
|                                                                   |
|  HTTP Server                       MCP Server                     |
|  - /v1/chat/completions            - llm_generate                 |
|  - /v1/generate                    - vault_*                      |
|  - /v1/models                      - code_search                  |
|  - /v1/providers                   - index_codebase               |
|  - /v1/credentials CRUD            - shared_state                 |
|  - /v1/files CRUD                  - usage_*                      |
|  - /v1/groups CRUD                 - circuit_breaker_*            |
|  - /metrics /health                - group tools                  |
|  - /v1/compression/stats           - approval_*                   |
|  - /v1/local/models                - local_llm_generate           |
|  - /v1/admin/discover              - discover_models               |
+-------------------------------------------------------------------+
|  Bridge routing         | Context compression | Code search        |
|  Provider groups        | Cost tracking       | CRDT state         |
|  Security profiles      | Approval flows      | Local LLM          |
|  HF discovery           | Three-part prompt   | Output compression |
+-------------------------+---------------------+--------------------+
| Router (model -> provider)       | Vault (AES-256-GCM + SQLite)   |
+-------------------------+---------------------+--------------------+
    |                                                  |
    v                                                  v
  API providers                                   CLI providers
  Anthropic, OpenAI, Google, Groq, OpenRouter     OpenCode, Claude,
                                                   Gemini, Codex, Qwen, Copilot
```

### Notas de Diseño

- Hono mantiene la capa HTTP chica y rápida.
- `better-sqlite3` mantiene el vault en un solo archivo y operativamente simple.
- El modo WAL de SQLite mejora el comportamiento de lectura concurrente.
- Los proveedores de API se prefieren antes que los proveedores CLI, salvo que la lógica del bridge indique lo contrario.
- Las escrituras del vault usan semántica de upsert para automatización repetible.
- Los adaptadores CLI materializan archivos de autenticación en homes temporales y los limpian en bloques `finally`.
- El enrutamiento del bridge es intencionalmente opcional y manejado por archivo.
- La búsqueda de código se mantiene en memoria por velocidad y frescura.
- Los CRDT reducen el dolor de coordinación en workflows de agentes en paralelo.

### Módulos Experimentales

- **`src/acp/`** — Implementación del Agent Client Protocol (`server.ts`, `translator.ts`, `types.ts`).
  Presente en el repo pero **no conectado al runtime activo**. No hay ruta de import desde `src/index.ts`, ningún transporte ACP HTTP/stdio activo, ni un bridge de ejecución de herramientas MCP en vivo todavía. Tratalo como un prototipo de protocolo probado que todavía necesita un sprint dedicado de integración ACP.

- **`src/sandbox/`** — Runner de sandbox Docker/proceso.
  El flag `sandbox` ahora existe en los perfiles de seguridad, pero el runtime todavía **no** expone herramientas de ejecución sandboxeada como `execute_code` o `shell_command`. En otras palabras: la infraestructura está preparada, pero la funcionalidad no está completa.

### Sistemas de Sesión

El gateway ahora usa `SessionManager` para ambas preocupaciones de afinidad de sesión:

1. **Sticky sessions del router** (`SessionManager.pinRouterStickySession`) — Fija un `clientId + model` específico a un proveedor/clave con expiración basada en TTL.

2. **Sesiones de grupo/API** (`src/session/session-manager.ts`) — Gestiona la afinidad de sesión para conversaciones multi-turno y métricas del dashboard.

Son separadas por diseño dentro de la misma instancia de manager: la sticky-ness del router maneja la selección de proveedor, mientras que las sesiones de grupo/API manejan la continuidad de la conversación.
No confundas los dos tipos de entrada.

`GET /v1/admin/sessions` las reporta por separado por esa razón:

- `routerStickySessions` viene de las entradas router-sticky de `SessionManager` y refleja los pins que el Router realmente usa en tiempo de request.
- `groupSessions` viene de `SessionManager` y refleja las métricas de afinidad de sesión a nivel de grupo.
- El endpoint incluye una `note` explicando la separación para que el dashboard no dé a entender un único pool de sesión compartido.

## Seguridad

- Cifrado AES-256-GCM para claves y archivos de autenticación guardados
- comparación de bearer-token de tiempo constante
- archivo de clave maestra guardado con modo `0600`
- directorio de configuración creado con modo `0700`
- las credenciales nunca se devuelven en crudo desde los endpoints de listado
- los archivos de autenticación temporales se limpian después de las invocaciones CLI
- requisito de token de autenticación de mínimo 32 caracteres
- endpoint `/health` público para monitoreo seguro

## Desarrollo

```bash
pnpm run dev
pnpm run serve
pnpm run start
pnpm test
pnpm run typecheck
pnpm run build
```

### Scripts

| Script | Comando | Descripción |
|--------|---------|-------------|
| `start` | `tsx src/index.ts` | modo MCP stdio |
| `dev` | `tsx watch src/index.ts` | desarrollo local |
| `serve` | `tsx src/index.ts serve` | servidor HTTP y dashboard |
| `test` | `node --import tsx --import ./test/setup/inject-require.mjs --test test/*.test.ts test/**/*.test.ts` | suite de tests |
| `build` | `tsup src/index.ts --format esm --dts` | build de producción |
| `typecheck` | `tsc --noEmit` | chequeo de TypeScript |

### Requisitos

- Node.js 22+
- pnpm 9+

## Licencia

MIT, como se declara en `package.json` (`"license": "MIT"`). Nota: todavía no se ha incluido en el repositorio un archivo `LICENSE` independiente.
