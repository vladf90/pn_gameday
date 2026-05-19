# pn_gameday

## Monorepo Structure

```
pn_gameday/
├── backend/          # Express.js API server
├── frontend/         # React web app (Vite + Refine + Antd)
├── package.json      # Root — pnpm workspaces, shared scripts
├── pnpm-workspace.yaml
└── .env              # Shared environment variables (not committed)
```

**Node version:** 20.3.0 (see `.nvmrc`)
**Package manager:** pnpm

## Common Commands

```bash
pnpm install             # Install all dependencies
pnpm dev                 # Start both frontend + backend concurrently
pnpm dev:frontend        # Frontend only (Vite dev server on :5173)
pnpm dev:backend         # Backend only (Express on :20000)
pnpm build:frontend      # Production build
pnpm build:backend       # TypeScript compile
pnpm lint                # Lint both workspaces
pnpm migration:run       # Run TypeORM migrations
pnpm migration:revert    # Revert last migration
pnpm migration:generate -- src/database/migrations/MigrationName
pnpm seed:run            # Seed database
```

## Database

- **PostgreSQL** via TypeORM
- Migrations in `backend/src/database/migrations/`
- Never use `synchronize: true` — always create migrations for schema changes

## Conventions

- **Code language:** All code (variables, functions, comments, commit messages) in English
- **Database naming:** Table names are **singular** `snake_case`; columns are `snake_case` in DB / `camelCase` as entity properties
- **API style:** Uses `POST` for create/update/delete (e.g., `POST /resource/:id/update`, `POST /resource/:id/delete`)

## Architecture (per-package)

See `backend/CLAUDE.md` and `frontend/CLAUDE.md` for stack details and the "how to add a new resource" guide.
