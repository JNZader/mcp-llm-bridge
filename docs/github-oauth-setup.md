# GitHub OAuth — Setup Guide

## 1. Crear la OAuth App en GitHub

1. Ir a **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   - O directo: https://github.com/settings/applications/new

2. Completar el formulario:
   - **Application name**: `MCP LLM Bridge` (o lo que quieras)
   - **Homepage URL**: `https://tu-dominio.com`
   - **Authorization callback URL**: `https://tu-dominio.com/auth/github/callback`
     - Local: `http://localhost:3456/auth/github/callback`

3. Hacer click en **Register application**

4. En la página de la app:
   - Copiar el **Client ID**
   - Hacer click en **Generate a new client secret** y copiar el valor

---

## 2. Variables de entorno

Agregar al `.env` (o al environment de Dokku):

```bash
# OAuth App credentials de GitHub
GITHUB_CLIENT_ID=Ov23...        # Client ID de tu OAuth App
GITHUB_CLIENT_SECRET=abc123...  # Client Secret generado

# Secret para firmar los JWTs de sesión (mínimo 32 chars)
# Generar con:
GITHUB_OAUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Usuarios de GitHub habilitados para acceder al dashboard
# Si no se define → cualquier cuenta de GitHub puede entrar
GITHUB_ALLOWED_USERS=JNZader
```

---

## 3. En Dokku

```bash
# Setear cada variable en la app de Dokku
dokku config:set mcp-llm-bridge \
  GITHUB_CLIENT_ID="Ov23..." \
  GITHUB_CLIENT_SECRET="abc123..." \
  GITHUB_OAUTH_SECRET="$(openssl rand -hex 32)" \
  GITHUB_ALLOWED_USERS="JNZader"
```

> **Importante**: El `GITHUB_OAUTH_SECRET` tiene que ser el mismo siempre.
> Si lo rotás, todos los tokens existentes dejan de ser válidos (los usuarios tienen que volver a loguearse).

---

## 4. Flujo completo

```
Usuario → click "Continue with GitHub"
    ↓
Frontend → window.location.href = "/auth/github"
    ↓
Backend → redirect a github.com/login/oauth/authorize (con state en cookie CSRF)
    ↓
GitHub → usuario autoriza → redirect a /auth/github/callback?code=xxx&state=yyy
    ↓
Backend → valida state, intercambia code por access_token, llama a api.github.com/user
    ↓
Backend → verifica que el login esté en GITHUB_ALLOWED_USERS (si está definido)
    ↓
Backend → genera JWT HS256 firmado (24h de vida) → redirect a /#/oauth/callback?token=...
    ↓
Frontend → guarda JWT en sessionStorage → redirige al dashboard
    ↓
Todas las requests → Authorization: Bearer <jwt> → adminAuth() lo verifica
```

---

## 5. Cambiar el Callback URL para distintos entornos

Si tenés múltiples entornos (local + producción), GitHub permite registrar múltiples OAuth Apps,
una por entorno. Recomendado:

| App             | Callback URL                                         |
|-----------------|------------------------------------------------------|
| Local Dev       | `http://localhost:3456/auth/github/callback`         |
| Producción      | `https://tu-dominio.com/auth/github/callback`        |

Cada app tiene su propio `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET`.

---

## 6. Fallback — Admin Token

Si GitHub OAuth **no está configurado** (no hay `GITHUB_CLIENT_ID`), el login muestra
el formulario de ADMIN_TOKEN directamente. Útil para:
- Entornos donde no querés OAuth (CI, acceso de emergencia)
- Desarrollo local sin OAuth App

Si GitHub OAuth **sí está configurado** pero querés usar el token igual, hay un link
"Use admin token" colapsable en la pantalla de login.

---

## 7. Rotación de secretos

Si necesitás invalidar todas las sesiones activas:

```bash
# Generar nuevo secret → todos los JWT dejan de ser válidos
dokku config:set mcp-llm-bridge GITHUB_OAUTH_SECRET="$(openssl rand -hex 32)"
```

Los usuarios simplemente vuelven a hacer login con GitHub — el proceso es transparente.
