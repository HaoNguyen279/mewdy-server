# Run the backend with Docker Compose

Docker Compose starts PostgreSQL, Redis, a one-shot Prisma migration service, and the API. PostgreSQL data persists in the `postgres_data` volume.

## Start

From the repository root, copy `.env.example` to `.env`, then change `POSTGRES_PASSWORD` and fill in credentials for the external services you use (Cloudinary, Google, Firebase). Start the stack:

```sh
docker compose up --build -d
```

The API is available at `http://localhost:3000`; health check: `http://localhost:3000/api/health`.

Compose sets the container-internal database and Redis addresses automatically (`postgres` and `redis`). The `DATABASE_URL` and `DIRECT_URL` values in `.env.example` use `localhost` for commands run directly on your host; Compose overrides the database URL inside its services.

## Useful commands

```sh
docker compose logs -f api
docker compose logs migrate
docker compose ps
docker compose down
```

`docker compose down` keeps database data. To remove the database and Redis data too, run `docker compose down -v` (this deletes the persisted data).

The migration service runs `src/scripts/migrate-database.ts` before the API starts. It applies migrations to an existing schema and bootstraps a new empty local database without accepting data loss. To apply new migrations, rebuild/recreate the stack with `docker compose up --build -d`.

Set `API_PORT`, `POSTGRES_PORT`, or `REDIS_PORT` in `.env` to change host ports. The API listens on port 3000 inside its container.
