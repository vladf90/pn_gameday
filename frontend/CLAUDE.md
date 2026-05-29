# Frontend

React + Ant Design app built with Refine.

## Stack

- **Framework:** React 18 + TypeScript
- **Bundler:** Vite 5
- **UI:** Ant Design 5 (antd)
- **Admin framework:** Refine 4 (auth, access control, CRUD scaffolding)
- **Routing:** React Router v6
- **HTTP:** Axios via custom `RequestClient` base class

## Architecture

```
frontend/src/
├── App.tsx                       # Refine setup, resource definitions, routing
├── index.tsx                     # Entry point
├── clients/                      # API request clients (one per resource)
│   ├── RequestClient.ts          # Base — auth token, request/response shape
│   └── AuthRequestClient.ts
├── Components/
│   ├── auth/Login.tsx
│   └── home/Home.tsx
├── providers/
│   ├── AuthProvider.ts           # JWT in localStorage
│   └── AccessControlProvider.ts  # RBAC-based access control
└── common/
    ├── permissions.ts            # Permission checking helpers
    └── types.ts
```

## Patterns — How to Add a New Resource

### 1. Request Client (`clients/NewEntityRequestClient.ts`)

```typescript
import { RequestClient } from "./RequestClient";

export class NewEntityRequestClient extends RequestClient {
    async getAll(): Promise<NewEntityModel[]> {
        return await this.get<void, NewEntityModel[]>("/new-entities");
    }

    async create(request: CreateNewEntityRequest): Promise<CreateNewEntityResponse> {
        return await this.post<CreateNewEntityRequest, CreateNewEntityResponse, void>(
            "/new-entities", request
        );
    }

    async update(request: UpdateNewEntityRequest): Promise<UpdateNewEntityResponse> {
        return await this.post<UpdateNewEntityRequest, UpdateNewEntityResponse, void>(
            `/new-entities/${request.id}/update`, request
        );
    }

    async delete(id: number): Promise<DeleteNewEntityResponse> {
        return await this.post<undefined, DeleteNewEntityResponse, void>(
            `/new-entities/${id}/delete`, undefined
        );
    }
}
```

### 2. Component (`Components/newEntity/NewEntity.tsx`)

Use Antd `Table`, `Form`, `Modal` etc. Hook into the request client directly.

### 3. Register in `App.tsx`

- Add a `<Route>` for the page.
- Add an entry to the `resources` array passed to `<Refine>` (label, path).
- If RBAC matters, update the map in `providers/AccessControlProvider.ts`.

## Auth & RBAC

- Login stores `token`, `permissions`, `firstName`, `lastName` in `localStorage`.
- `<Authenticated>` in `App.tsx` gates protected routes and redirects to `/login`.
- `canAccessResource(permissions, resource)` in `common/permissions.ts` checks resource-level access.

## Testing

- **Runner:** Vitest + jsdom + React Testing Library (see [docs/adr/0009-testing-with-vitest.md](../docs/adr/0009-testing-with-vitest.md)).
- **Layout:** tests are NOT colocated with source. They live under `test/<category>/`, mirroring `src/` underneath. e.g. a component at `src/Components/auth/Login.tsx` is tested at `test/unit/Components/auth/Login.test.tsx`.
- **`test/renderWithProviders.tsx`** wraps a component in `<MemoryRouter>` + `<Refine>` with stubbed `authProvider`/`dataProvider`/`accessControlProvider`. Use it for any component that touches Refine hooks or react-router. Override individual providers via options to test specific auth/access states.
- **`test/setup.ts`** is loaded automatically by Vitest — it registers `@testing-library/jest-dom` matchers and runs RTL `cleanup` after each test.
- Mock request clients at the module boundary (`vi.mock("../../../../src/clients/AuthRequestClient", ...)`) rather than the network.
- Scripts: `pnpm --filter frontend test`, `test:watch`.
