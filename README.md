# Dating Server

Backend API cho ứng dụng hẹn hò, xây dựng bằng Node.js, TypeScript, Express 5 và Prisma ORM 7.

## Tính năng

- Đăng ký, đăng nhập bằng email/điện thoại và tích hợp Google/Firebase.
- Quản lý người dùng, hồ sơ, tùy chọn tìm kiếm và ảnh Cloudinary.
- Swipe, ghép đôi, trò chuyện và gợi ý hồ sơ.
- Nhóm khám phá theo sở thích và mục đích quan hệ.
- Chat AI qua LiteLLM, giới hạn tần suất theo người dùng bằng Redis.
- Theo dõi API bằng Prometheus metrics và Grafana Alloy.

## Công nghệ

- Node.js 22+, TypeScript 7, pnpm 11
- Express 5
- PostgreSQL (cấu hình hiện tại dùng Supabase)
- Prisma ORM 7 với `@prisma/adapter-pg`
- Redis (cấu hình hiện tại dùng Upstash)
- Firebase Admin, Cloudinary, LiteLLM

## Bắt đầu chạy local

### Yêu cầu

- Node.js 22 trở lên
- pnpm 11 trở lên
- PostgreSQL truy cập được qua `DATABASE_URL` (và `DIRECT_URL` cho Prisma CLI/migration)
- Redis là tùy chọn cho cache; một số tính năng như giới hạn tần suất AI cần Redis

### Cài đặt

```bash
pnpm install
Copy-Item .env.example .env
```

Mở `.env` và điền các thông tin cần thiết. Tối thiểu cần cấu hình `DATABASE_URL`. Với thao tác Prisma CLI và migration, nên cấu hình `DIRECT_URL` trỏ tới session pooler hoặc PostgreSQL có kết nối trực tiếp. Xem mục [Biến môi trường](#biến-môi-trường).

Sinh Prisma Client và chuẩn bị schema cho cơ sở dữ liệu:

```bash
pnpm exec prisma generate
pnpm exec tsx src/scripts/migrate-database.ts
```

> **Lưu ý:** migration script kết nối tới cơ sở dữ liệu trong `.env`. Kiểm tra URL để tránh chạy nhầm vào database dùng chung hoặc môi trường production.

Chạy server chế độ watch:

```bash
pnpm dev
```

API mặc định chạy tại `http://localhost:3000`. Kiểm tra trạng thái tại `http://localhost:3000/api/health`.

## Chạy bằng Docker Compose

Compose chạy migration trước API. PostgreSQL và Redis là dịch vụ bên ngoài, không được khởi chạy trong Compose này.

```powershell
Copy-Item .env.example .env
```

Điền thông tin trong `.env`, sau đó chạy:

```bash
docker compose up --build -d
```

Lệnh trạng thái và log:

```bash
docker compose ps
docker compose logs -f api
docker compose logs migrate
```

Dừng các container:

```bash
docker compose down
```

Xem thêm hướng dẫn triển khai và Grafana Alloy trong [docs/docker.md](docs/docker.md).

## Biến môi trường

`.env.example` là mẫu cấu hình cho API và Docker Compose. Điền giá trị thật trong `.env` cục bộ; không commit file này.

| Biến | Mục đích |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL dùng bởi API và migration bootstrap. |
| `DIRECT_URL` | PostgreSQL URL dùng bởi Prisma CLI; nếu bỏ trống, Prisma dùng `DATABASE_URL`. |
| `DATABASE_POOL_MAX` | Số kết nối tối đa mỗi API process; mặc định `1`. |
| `REDIS_URL` | Redis URL; nếu bỏ trống, ứng dụng thử `redis://localhost:6379`. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name để tải ảnh lên. |
| `CLOUDINARY_API_KEY` | Cloudinary API key cho thao tác quản lý ảnh. |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret. |
| `CLOUDINARY_UPLOAD_PRESET` | Upload preset của Cloudinary. |
| `FIREBASE_PROJECT_ID` | Firebase project ID. |
| `FIREBASE_CLIENT_EMAIL` | Email của Firebase service account. |
| `FIREBASE_PRIVATE_KEY` | Private key của Firebase service account; có thể lưu newline dưới dạng `\\n`. |
| `GOOGLE_CLIENT_ID` | OAuth client ID dùng cho đăng nhập Google. |
| `LITELLM_BASE_URL` | URL LiteLLM OpenAI-compatible API. |
| `LITELLM_API_KEY` | API key để gọi LiteLLM; giữ bí mật phía server. |
| `PORT` | Cổng HTTP của API; mặc định `3000`. |
| `API_PORT` | Cổng host được publish bởi Docker Compose; mặc định `3000`. |

Firebase, Cloudinary và LiteLLM chỉ cần cấu hình nếu sử dụng các tính năng tương ứng. Những endpoint dùng `requireChatAuth` yêu cầu Firebase Admin credentials. Không đưa khóa riêng, token hoặc connection string thật vào Git hay ứng dụng client.

## API

API dùng tiền tố `/api`, ngoại trừ các endpoint xác thực `/auth/*` và endpoint gốc `/`.

| Nhóm | Đường dẫn | Mô tả |
| --- | --- | --- |
| Health | `GET /api/health` | Kiểm tra API đang hoạt động. |
| Auth | `/auth/*` | Đăng ký, đăng nhập, Google và Firebase. |
| Users | `/api/users` | Tạo, xem, cập nhật và xóa người dùng. |
| Profiles | `/api/profiles` | Hồ sơ và mục đích quan hệ. |
| Photos | `/api/users/me/photos` | Quản lý ảnh hồ sơ; yêu cầu Firebase Bearer token. |
| Preferences | `/api/preferences` | Tùy chọn tìm kiếm. |
| Swipes | `/api/swipes` | Swipe và lịch sử swipe. |
| Matches | `/api/matches` | Danh sách, chi tiết và hủy ghép đôi. |
| Chat | `/api/chat` | Hội thoại và tin nhắn; yêu cầu Firebase Bearer token. |
| Recommendations | `/api/recommendations` | Gợi ý hồ sơ và ghi nhận lượt hiển thị. |
| Discovery groups | `/api/discovery-groups` | Nhóm khám phá và gợi ý; yêu cầu Firebase Bearer token. |
| AI | `/api/ai/chat` | Chat AI; yêu cầu Firebase Bearer token và Redis. |

Gửi token cho các endpoint được bảo vệ qua header:

```http
Authorization: Bearer <firebase-id-token>
```

Tài liệu API chi tiết:

- [Recommendations API](docs/recommendations-api.md)
- [Discovery Groups API](docs/discovery-groups-api.md)
- [Tổng quan hệ thống gợi ý](docs/recommendation-system-overview.md)
- [Xác minh email](docs/email-verification.md)

## Scripts

| Lệnh | Mô tả |
| --- | --- |
| `pnpm dev` | Chạy API bằng tsx watch. |
| `pnpm build` | Biên dịch TypeScript vào `dist/`. |
| `pnpm start` | Chạy bản build từ `dist/app.js`. |
| `pnpm seed` | Chạy seed dữ liệu ứng dụng. |
| `pnpm seed:demo-users` | Tạo dữ liệu người dùng demo. |
| `pnpm test` | Chạy bộ kiểm thử được khai báo trong package.json. |

Metrics được phục vụ riêng tại `http://localhost:9464/metrics`. Endpoint này phù hợp để scrape nội bộ; không publish công khai nếu không cần thiết.

## Cấu trúc mã nguồn

```text
src/
├── app.ts                 # Khởi tạo Express và đăng ký router
├── config/                # Cấu hình CORS
├── middlewares/           # Xác thực, lỗi và 404
├── modules/               # Tính năng theo miền nghiệp vụ
├── observability/         # Prometheus metrics
├── services/              # Tích hợp dịch vụ ngoài
├── lib/                   # Prisma, Redis và cache
└── scripts/               # Script migration database

prisma/                    # Prisma schema và migrations
docs/                      # Tài liệu API, kiến trúc và triển khai
monitoring/                # Cấu hình Grafana Alloy
```
