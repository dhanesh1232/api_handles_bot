<div align="center">
  <img src="https://pub-236715f1b7584858b15e16f74eeaacb8.r2.dev/logo.png" alt="ECODrIx Logo" width="200" />
</div>

# Contributing to ECOD Backend

Thank you for your interest in contributing to the ECOD Logic Engine! This document provides guidelines for developers to maintain high code quality and consistency.

## 🛠 Development Workflow

1. **Environment Setup**:
   - Ensure you have **Node.js v22+** installed.
   - Use **pnpm** for package management (mandatory).
   - Copy `.env.example` to `.env` and fill in the required secrets.

2. **Branching Strategy**:
   - Create feature branches from `master`.
   - Name branches descriptively (e.g., `feat/whatsapp-polling` or `fix/lead-scoring`).

3. **Development Mode**:
   - Run `pnpm dev` for standard development.
   - Run `pnpm dev:ts` if you are working on TypeScript modules and want automatic reloading.

## 📝 Coding Standards

### 1. TypeScript & ESM

- Always prefer **TypeScript** for new modules.
- Use **ESM (ECMAScript Modules)** syntax (`import`/`export`).
- For Mongoose and interface imports, use `import type { ... }` to ensure ESM compatibility.
- Ensure all TypeScript modules pass `pnpm run type-check`.

### 2. Multi-tenancy

- Never hardcode database URIs.
- Use `getTenantConnection(clientCode)` and `getTenantModel(clientCode, modelName, schema)` for data isolation.
- Always validate the `clientCode` before accessing tenant-specific data via `validateClientKey` middleware.
- **CRITICAL**: Never export `services` database models (like `EventLog`, `Client`, `Job`) in the `tenant.schemas.ts` registry. They must remain globally scoped.

### 3. API Response Format

- All new endpoints MUST use the unified response formatting:
  ```json
  { "success": boolean, "data"?: any, "message"?: string, "code"?: string }
  ```
- Always return HTTP status codes matching the context (400 for validation, 401 for auth, 404 for missing resources, 500 for internal errors).
- Do not invent custom response schemas per route.

### 4. Error Handling

- Use `try/catch` blocks for all asynchronous operations, especially those involving external APIs (Meta, Google, DB).
- Log errors descriptive with `console.error` including context (e.g., specific tenant or job ID).

## 🧪 Testing & Verification

- **Smoke Tests**: Run `pnpm run test` before committing to ensure basic schema integrity and environment setup.
- **Type Checking**: Run `pnpm run type-check` to catch potential type mismatches.
- **Linting**: We use ESLint and Prettier. Run `pnpm run format` to automatically fix style issues.

## 🚀 Pull Request Process

1. Ensure all tests and type checks pass.
2. Update `README.md` if you introduce new features or change configurations.
3. Request a review from the maintainers.
4. Once approved, the PR will be merged into `master`.

---

Stay productive and keep the code boring (readable and maintainable)!
