# Project context: kiến trúc, Docker và monitoring

> **Lưu ý:** Các phần dưới đây ghi lại snapshot trước khi chuyển PostgreSQL sang Supabase, Redis sang Upstash, rồi chuyển monitoring sang Grafana Cloud. Chúng hữu ích để hiểu quyết định ban đầu nhưng không còn là cấu hình live hiện tại. Cấu hình mới và cách chạy được ghi tại [docs/docker.md](docker.md), `docker-compose.yml`, `monitoring/alloy/config.alloy` và `.env.example`.

## Kiến trúc triển khai hiện tại

- Mỗi EC2 chạy Docker Compose gồm API, migration một lần và Grafana Alloy.
- PostgreSQL nằm trên Supabase; API runtime nhận `DATABASE_URL`, Prisma CLI/migrations nhận `DIRECT_URL`.
- Redis nằm trên Upstash; ứng dụng hiện tại kết nối bằng `ioredis` qua TCP/TLS (`rediss://`).
- API vẫn export `prom-client` metrics tại `/metrics` trên port `9464`.
- Alloy scrape target lấy từ `METRICS_SCRAPE_TARGET` rồi remote-write tới cùng Grafana Cloud Metrics stack. Dùng `api:9464` trong Compose hoặc `host.docker.internal:9464` khi backend chạy trên host. Mỗi EC2 đặt `METRICS_INSTANCE_NAME` khác nhau để thêm label `ec2_instance` và phân biệt series.
- Không chạy Grafana hoặc Prometheus server local; Grafana Cloud cung cấp UI và metrics storage dùng chung cho hai EC2.
- Chi tiết biến môi trường và lệnh khởi động nằm trong [docs/docker.md](docker.md). Không lưu credentials cloud trong Git.

## 1. Tóm tắt kiến trúc

- Backend là API Node.js/TypeScript, chạy Express 5, build bằng TypeScript (`tsc`) và dùng ESM/NodeNext.
- PostgreSQL là cơ sở dữ liệu chính; Prisma ORM 7 dùng `@prisma/adapter-pg`. Schema và migration nằm trong `prisma/`.
- Redis được dùng như cache tùy chọn. Lỗi Redis không nên làm API dừng; mã kết nối đặt timeout và giới hạn retry.
- Tích hợp ngoài ứng dụng gồm Firebase/Google auth và Cloudinary cho media. Các thông tin bí mật được truyền qua biến môi trường.
- HTTP API được chia module theo nghiệp vụ trong `src/modules/`: auth, users, profiles, photos, preferences, swipes, matches, chat, recommendations, discovery-groups.
- Instrumentation Prometheus đã có trong ứng dụng: `prom-client`, middleware đếm thời gian request HTTP và default Node.js metrics. Endpoint scrape là `/metrics` trên listener riêng cổng `9464`.
- Compose gốc hiện chạy PostgreSQL, Redis, migration one-shot và API. Compose trong `monitoring/` chạy Prometheus và Grafana riêng, nhưng chưa cùng mạng Compose với API.

## 2. Cây thư mục liên quan

Cây dưới đây lấy từ các file hiện có; loại trừ `.git`, dependency, output build và Prisma Client generated (được sinh lúc build/install).

```text
dating-server/
├── .dockerignore
├── .env.example
├── .github/
│   └── workflows/
│       └── docker-build.yml
├── Dockerfile
├── docker-compose.yml                 # Compose gốc: postgres, redis, migrate, api
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── prisma.config.ts
├── tsconfig.json
├── src-tree.md
├── docs/
│   ├── architecture-and-monitoring-compose-context.md  # tài liệu này
│   ├── docker.md
│   ├── discovery-groups-api.md
│   ├── email-verification.md
│   ├── recommendation-system-overview.md
│   └── recommendations-api.md
├── monitoring/
│   ├── docker-compose.yml             # Compose monitor hiện tại (độc lập)
│   └── prometheus.yml                 # scrape config hiện tại
├── postgre_scripts/
│   ├── create_database.sql
│   ├── datingdb_schema.sql
│   └── fix_auth_identity_contact_constraint.sql
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── migration_lock.toml
│       └── 20261101090000_email_verification/
│           └── migration.sql
└── src/
    ├── app.ts
    ├── config/
    │   └── cors.ts
    ├── infrastructure/
    │   └── database/prisma.ts
    ├── lib/
    │   ├── cache.ts
    │   ├── prisma.ts
    │   └── redis.ts
    ├── middlewares/
    │   ├── authenticate.ts
    │   ├── error-handler.ts
    │   └── not-found.ts
    ├── observability/
    │   └── metrics.ts
    ├── scripts/
    │   └── migrate-database.ts
    ├── modules/
    │   ├── auth/                 # đăng nhập/xác thực, Firebase/email
    │   ├── chat/                 # hội thoại và nhắn tin
    │   ├── discovery-groups/     # nhóm khám phá
    │   ├── matches/              # ghép đôi
    │   ├── photos/               # ảnh người dùng
    │   ├── preferences/          # tùy chọn tìm kiếm
    │   ├── profiles/             # hồ sơ
    │   ├── recommendations/     # gợi ý và xếp hạng
    │   ├── swipes/               # lượt thích/bỏ qua
    │   └── users/                # người dùng
    ├── seed-demo-users.ts
    └── seed.ts
```

Các module nghiệp vụ thường tách route/controller/service/repository/validation/container theo nhu cầu của module. `src-tree.md` là cây `src` đã ghi trước đó nhưng đã cũ một phần: hiện có thêm `observability/metrics.ts`, `discovery-groups/`, `photos/`, `scripts/`, và test trong một số module.

## 3. Luồng khởi động hiện tại

```text
docker compose up --build
  ├── postgres (healthcheck pg_isready)
  ├── redis (healthcheck redis-cli ping)
  ├── migrate (đợi postgres healthy, chạy script migration một lần)
  └── api (đợi migrate thành công và redis healthy)
        ├── API HTTP :3000, health tại /api/health
        └── metrics HTTP :9464, scrape tại /metrics

Prometheus ── scrape mỗi 15s ──> mục tiêu hiện tại host.docker.internal:9464
Grafana ── datasource dự kiến ──> Prometheus
```

Thực tế Compose gốc chỉ khai báo publish port `3000` của API; không publish `9464`. Khi API chạy trong container, listener metrics chỉ có thể được Prometheus truy cập qua mạng container nếu hai service cùng network. Config Prometheus hiện tại dùng `host.docker.internal:9464`, do đó thường cần API chạy trực tiếp trên host và bind port tới host; nó không trỏ vào service `api` của Compose gốc.

## 4. Nội dung Docker và monitoring hiện tại

### 4.1 `Dockerfile`

```dockerfile
# Build the API and Prisma Client.
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN pnpm exec prisma generate && pnpm build

# Keep the runtime image small; Prisma CLI remains in the build stage for migrations.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated/prisma ./dist/generated/prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000
CMD ["node", "dist/app.js"]
```

Ý nghĩa target:

- `build`: đầy đủ dependency phát triển, generate Prisma Client và compile TypeScript. Compose dùng target này cho service `migrate`, chạy `tsx` từ source.
- `runtime`: cài production dependencies, copy kết quả build và Prisma Client được generate. Compose dùng target này cho API.
- `EXPOSE 3000` chỉ khai báo cổng API trong image; không publish cổng metrics `9464`.

### 4.2 `docker-compose.yml` ở thư mục gốc

```yaml
name: dating-server

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-datingdb}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgrepassword}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  migrate:
    build:
      context: .
      target: build
    restart: "no"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgrepassword}@postgres:5432/${POSTGRES_DB:-datingdb}?schema=public
      DIRECT_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgrepassword}@postgres:5432/${POSTGRES_DB:-datingdb}?schema=public
    command: ["pnpm", "exec", "tsx", "src/scripts/migrate-database.ts"]
    depends_on:
      postgres:
        condition: service_healthy

  api:
    build:
      context: .
      target: runtime
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgrepassword}@postgres:5432/${POSTGRES_DB:-datingdb}?schema=public
      REDIS_URL: redis://redis:6379
    ports:
      - "${API_PORT:-3000}:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  postgres_data:
  redis_data:
```

Ghi chú:

- `postgres` và `redis` được publish ra host để phát triển; dữ liệu lưu ở named volumes.
- `migrate` kết nối bằng hostname nội bộ `postgres`, đợi DB healthy rồi mới chạy. API chờ migration thành công.
- Các địa chỉ `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` được Compose override trong container; `.env.example` có giá trị dành cho host/local và hiện để trống nhiều biến.
- Default password `postgrepassword` tiện cho môi trường local; cần cấu hình qua `.env` nếu dùng môi trường khác.
- Chưa có service `prometheus`/`grafana`, scrape target hoặc `9464` trong Compose gốc.

### 4.3 `monitoring/docker-compose.yml`

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
    extra_hosts:
      - "host.docker.internal:host-gateway"

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3001:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    depends_on:
      - prometheus

volumes:
  grafana-data:
```

Compose file này phải được chạy từ thư mục `monitoring/` để bind mount `./prometheus.yml` trỏ đúng file. Nếu truyền `-f monitoring/docker-compose.yml` từ thư mục gốc, đường dẫn tương đối thường được resolve theo project directory gốc, nên cần kiểm tra/điều chỉnh path khi hợp nhất hoặc gọi Compose bằng nhiều file. Nó khai báo container name cố định, Prometheus/Grafana dùng tag `latest`, không có healthcheck hay datasource/provisioning cho Grafana trong các file hiện có. `depends_on` ngắn chỉ đảm bảo thứ tự khởi động, không chờ Prometheus healthy.

### 4.4 `monitoring/prometheus.yml`

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: dating-server
    static_configs:
      - targets: ["host.docker.internal:9464"]
```

Hiện tại scrape target là host gateway, không phải service DNS `api`. Khi Prometheus chuyển vào Compose gốc, cùng một default network cho phép scrape theo service name, ví dụ `api:9464`; service `api` không nhất thiết phải publish `9464` ra host để Prometheus truy cập nội bộ. Nếu muốn mở metrics cho host, khai báo port mapping riêng, cân nhắc chỉ bind vào localhost.

### 4.5 `.dockerignore`

```text
node_modules
dist
.git
.env
.env.*
!.env.example
src/generated/prisma
coverage
.pnpm-store
*.log
```

## 5. CI build/push image

### `.github/workflows/docker-build.yml` (nội dung đầy đủ)

```yaml
name: Docker Build & Push (GHCR)

on:
  push:
    branches: [main]
    tags: ["v*.*.*"]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # ==========================================
      # 1. Metadata for API runtime image
      # ==========================================
      - name: Extract runtime tags & labels
        id: meta-runtime
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,format=short

      # ==========================================
      # 2. Metadata for migration image
      # ==========================================
      - name: Extract migration tags & labels
        id: meta-migrate
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          flavor: |
            latest=false
          tags: |
            type=raw,value=migrate-latest,enable={{is_default_branch}}
            type=ref,event=branch,prefix=migrate-
            type=ref,event=pr,prefix=migrate-pr-
            type=semver,pattern={{version}},prefix=migrate-
            type=semver,pattern={{major}}.{{minor}},prefix=migrate-
            type=sha,format=short,prefix=migrate-sha-

      # ==========================================
      # 3. Build migration image
      # Dockerfile target: build
      # ==========================================
      - name: Build and push migration image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          target: build
          platforms: linux/amd64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta-migrate.outputs.tags }}
          labels: ${{ steps.meta-migrate.outputs.labels }}
          cache-from: type=gha,scope=migrate
          cache-to: type=gha,mode=max,scope=migrate

      # ==========================================
      # 4. Build API runtime image
      # Dockerfile target: runtime
      # ==========================================
      - name: Build and push API runtime image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          target: runtime
          platforms: linux/amd64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta-runtime.outputs.tags }}
          labels: ${{ steps.meta-runtime.outputs.labels }}
          cache-from: type=gha,scope=runtime
          cache-to: type=gha,mode=max,scope=runtime
```

Workflow chạy khi push lên `main`, push tag semver dạng `v*.*.*`, PR vào `main`, hoặc dispatch thủ công. Trên PR, cả hai target được build nhưng không push; các event còn lại login GHCR rồi push. Hai artifact cùng repo image name nhưng có tag sets và cache scope riêng: migration target `build` với prefix `migrate-`, API target `runtime`. Không có bước test trong workflow hiện tại.

## 6. Metrics do ứng dụng cung cấp

### 6.1 `src/observability/metrics.ts`

```typescript
import * as client from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const register = new client.Registry();


client.collectDefaultMetrics({ register });


const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Thoi gian xu ly HTTP request",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});


export const swipesTotal = new client.Counter({
  name: "dating_swipes_total",
  help: "So luot swipe",
  labelNames: ["direction"],
  registers: [register],
});

export const matchesTotal = new client.Counter({
  name: "dating_matches_total",
  help: "So match duoc tao",
  registers: [register],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
   
    const route = req.route?.path ? req.baseUrl + req.route.path : "unmatched";
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}
```

Metrics hiện có gồm default process/runtime metrics, histogram thời gian xử lý HTTP theo method/route/status và counter cho swipe/match. Middleware được đăng ký trong app. Counter swipe/match được export nhưng cần kiểm tra code nghiệp vụ trước khi kết luận chúng đã được increment ở các đường đi thực tế.

### 6.2 Phần liên quan trong `src/app.ts`

```typescript
import { register, metricsMiddleware } from "./observability/metrics.js";
// ...khởi tạo Express, middleware, health check và mount các router...
app.use(metricsMiddleware);
// ...mount các router nghiệp vụ, not-found và error handler...

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

const metricsApp = express();
metricsApp.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
metricsApp.listen(9464, () => console.log("Metrics at http://localhost:9464/metrics"));
```

Đoạn trên trích các phần cần cho monitoring; source `app.ts` đầy đủ có imports, health route và tất cả router như cây module. Metrics dùng một Express app riêng và listener cố định `9464`, không phải route `/metrics` trên listener API `3000`. Cả hai listener hiện không truyền host bind cụ thể; trong container Node thường listen trên mọi interface. Chưa có biến môi trường để đổi metrics port.

## 7. Biến môi trường và cổng

`.env.example` hiện có nội dung:

```dotenv
# PostgreSQL database connection string
DATABASE_URL= 
DIRECT_URL = 

# Cloudinary configuration
CLOUDINARY_CLOUD_NAME= 
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_UPLOAD_PRESET=

# Redis connection string
REDIS_URL=

# Firebase configuration
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
# Docker PostgreSQL configuration
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_PORT=

# Port
REDIS_PORT=
PORT= 
```

Compose còn đọc `API_PORT` để publish API, dù biến này chưa có trong `.env.example`. Cổng mặc định hiện tại: API host `3000` → container `3000`; PostgreSQL host `5432` → container `5432`; Redis host `6379` → container `6379`; Prometheus host `9090`; Grafana host `3001` → container `3000`; metrics container `9464` nhưng chưa publish từ API. Lưu ý compose interpolation mặc định của PostgreSQL dùng `postgrepassword` nếu không set biến, dù file example hiện để trống.

## 8. Hướng tích hợp monitoring vào Compose gốc

Mục tiêu cấu hình hợp nhất hợp lý với cấu trúc hiện tại:

1. Thêm service `prometheus` và `grafana` vào `docker-compose.yml` gốc, dùng network mặc định chung với `api`.
2. Sửa scrape target trong `monitoring/prometheus.yml` từ `host.docker.internal:9464` sang hostname Compose `api:9464` (hoặc service/port tương đương nếu app đổi cấu hình). Không cần publish cổng `9464` ra host để Prometheus trong cùng network scrape được.
3. Giữ file Prometheus tại `monitoring/prometheus.yml`; khi Compose gốc mount file, bind mount phải resolve tương đối repository root, ví dụ `./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro`.
4. Chuyển named volume `grafana-data` vào Compose gốc để dữ liệu dashboards/config Grafana tồn tại qua restart. Prometheus hiện không có volume dữ liệu, nên dữ liệu TSDB của Prometheus trong container sẽ mất khi container bị thay mới.
5. Chọn port host không xung đột: Prometheus `9090:9090`; Grafana `3001:3000` hiện theo compose monitor. Tài liệu và hướng dẫn chạy cần cập nhật để chỉ dùng Compose gốc.
6. Cân nhắc pin image versions thay vì `latest`, healthcheck Prometheus/Grafana và `depends_on` theo health khi phù hợp. Không có provisioning Grafana trong repository nên datasource/dashboard có thể cần cấu hình thủ công hoặc bổ sung file provisioning riêng.
7. Nếu cần truy cập endpoint metrics từ máy host để debug, thêm publish mapping riêng, tốt nhất bind host localhost; nếu chỉ Prometheus truy cập thì không cần expose host port.

Trước khi sửa, agent triển khai cần xác nhận Compose project path và cách mount file, kiểm tra Grafana datasource mặc định (không có trong repo), và quyết định policy lưu dữ liệu Prometheus. Phạm vi thống nhất tối thiểu là gộp services vào Compose gốc và dùng scrape target `api:9464`; không cần đổi code API nếu giữ port listener hiện tại.

## 9. Hướng dẫn Docker hiện có

`docs/docker.md` hiện hướng dẫn:

- Copy `.env.example` thành `.env`, điền password PostgreSQL và credentials dịch vụ ngoài.
- Khởi động từ repository root bằng `docker compose up --build -d`.
- API: `http://localhost:3000`; health: `http://localhost:3000/api/health`.
- Xem logs bằng `docker compose logs -f api`, `docker compose logs migrate`; kiểm tra bằng `docker compose ps`.
- `docker compose down` giữ dữ liệu; `docker compose down -v` xóa dữ liệu PostgreSQL/Redis trong named volume.
- Migration script chạy trước API; host ports có thể đổi qua `.env`.

Sau khi hợp nhất monitoring, cần cập nhật hướng dẫn này để chỉ cách truy cập Prometheus/Grafana và tránh hướng dẫn chạy Compose thứ hai trong `monitoring/`.

## 10. Checklist cho agent tiếp tục tích hợp

- [ ] Đọc và hợp nhất service từ `monitoring/docker-compose.yml` vào Compose gốc, không làm mất `postgres_data`/`redis_data` và thêm `grafana-data`.
- [ ] Đổi Prometheus target sang địa chỉ service API trong Compose (`api:9464`).
- [ ] Xác thực mount path `monitoring/prometheus.yml` khi chạy từ repository root.
- [ ] Quyết định có expose `9464` ra host hay chỉ dùng nội bộ; nếu expose thì chọn mapping/host bind rõ ràng.
- [ ] Giữ API healthcheck `/api/health` tách biệt với scrape endpoint `/metrics`.
- [ ] Cập nhật `docs/docker.md` và/hoặc tài liệu này sau khi kiến trúc thực tế đổi.
- [ ] Xem xét version pinning, healthchecks, Grafana datasource provisioning và lưu trữ Prometheus như các quyết định riêng, không giả định rằng chúng đã tồn tại.

