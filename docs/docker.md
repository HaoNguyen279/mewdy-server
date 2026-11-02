# Chạy backend và gửi metrics tới Grafana Cloud

Compose gốc chạy API, migration một lần và Grafana Alloy. PostgreSQL được cung cấp bởi Supabase, Redis bởi Upstash, còn Grafana và Prometheus-compatible metrics storage được Grafana Cloud host. Không có Grafana hoặc Prometheus server local.

## Cấu hình môi trường

Tạo `.env` từ mẫu:

```sh
cp .env.example .env
cp .env.grafana.example .env.grafana
```

Điền các biến sau trong `.env`:

- `DATABASE_URL`: Supabase PostgreSQL URL cho API. URL transaction pooler port `6543` của bạn có thể giữ `pgbouncer=true`; `connection_limit=1` trong URL không cấu hình pool của Prisma ORM 7 driver adapter.
- `DIRECT_URL`: URL Prisma CLI/migration. Dùng Supabase session pooler port `5432` như URL bạn cung cấp. Dù biến tên là `DIRECT_URL`, session pooler vẫn hợp lệ; tên biến chỉ phục vụ cách project đang cấu hình Prisma.
- `DATABASE_POOL_MAX`: số kết nối tối đa của pool `pg` trong mỗi API process. Mặc định mẫu là `1`, tương ứng với giới hạn đã có trong URL bạn đưa. Nếu tăng số API replica, tính tổng pool của tất cả replica.
- `REDIS_URL`: Upstash Redis URL từ **Connect → TCP**, có dạng `rediss://default:<token>@<host>:<port>`. Giữ nguyên scheme `rediss://` để kết nối TLS.
- Credentials Cloudinary/Firebase nếu môi trường cần dùng các tính năng đó.

Điền Grafana Cloud credentials trong `.env.grafana`, không đặt chúng trong `.env`. Compose chỉ truyền file này cho Alloy, không đưa access token tới API hoặc migration container:

- `GRAFANA_CLOUD_PROMETHEUS_URL`: remote-write URL trong Grafana Cloud stack → Prometheus → Details.
- `GRAFANA_CLOUD_PROMETHEUS_USERNAME`: username/instance ID trong cùng trang Details.
- `GRAFANA_CLOUD_API_TOKEN`: access policy token có quyền `metrics:write`; đây không phải mật khẩu đăng nhập Grafana.
- `METRICS_INSTANCE_NAME`: nhãn riêng của EC2 này, ví dụ `dating-server-ec2-1`. Đặt giá trị khác trên EC2 còn lại.

Không đưa password Supabase hoặc token Upstash thật vào Git. Nếu password PostgreSQL có ký tự dành riêng cho URL, cần URL-encode trước khi ghép vào connection string.

## Khởi động

Chạy từ repository root:

```sh
docker compose up --build -d
```

Các địa chỉ mặc định:

- API: `http://localhost:3000`
- API health: `http://localhost:3000/api/health`

Alloy scrape target trong `METRICS_SCRAPE_TARGET` mỗi 15 giây và gửi metrics tới Grafana Cloud qua remote write. Khi API chạy trong Compose, target là `api:9464`; khi API chạy trên host, đổi thành `host.docker.internal:9464`. Port metrics `9464` và Alloy UI không được publish ra host. Endpoint `/metrics` vẫn được cung cấp bởi `prom-client` trên listener riêng của API.

Trên EC2 thứ hai, dùng cùng URL/username/token Grafana Cloud nhưng đặt `METRICS_INSTANCE_NAME` khác. Alloy gắn nhãn `ec2_instance` để phân biệt series từ mỗi server. Mỗi máy chạy một Alloy sidecar trong Compose.

### Gửi metrics từ backend chạy local

1. Trong `.env`, cấu hình Supabase và Upstash để backend local có thể dùng cloud services.
2. Trong `.env.grafana`, đặt `METRICS_SCRAPE_TARGET=host.docker.internal:9464` và `METRICS_INSTANCE_NAME=dating-server-local`.
3. Chạy backend trên host bằng `pnpm dev`.
4. Từ repository root, chạy Alloy riêng: `docker compose up -d alloy`.

`extra_hosts` trong Compose ánh xạ `host.docker.internal` tới host gateway, để Alloy container truy cập listener metrics của backend local. Alloy không phụ thuộc vào container API nên có thể chạy độc lập trong chế độ này. Khi chuyển sang EC2, đặt target lại thành `api:9464`.

## Migration database

Service `migrate` nhận `DATABASE_URL` và `DIRECT_URL` từ `.env`, rồi chạy `src/scripts/migrate-database.ts` trước khi API khởi động. Với Supabase database đang trống, script bootstrap schema bằng `prisma db push` và ghi nhận migration email verification hiện tại. Khi schema đã tồn tại, script chọn nhánh áp dụng migration dựa trên các bảng/cột hiện có.

Đây là database cloud dùng chung nên kiểm tra `.env` và log migration trước khi khởi động deployment mới. Xem kết quả bằng:

```sh
docker compose logs migrate
docker compose logs -f api
docker compose ps
```

Nếu cần chạy lại migration service sau khi cập nhật image/config:

```sh
docker compose up --build --force-recreate migrate
docker compose up -d api
```

## Dừng stack và dữ liệu

```sh
docker compose down
```

`docker compose down` giữ volume hàng đợi remote-write của Alloy (`alloy_data`). Dữ liệu PostgreSQL nằm trên Supabase, Redis trên Upstash và metrics trong Grafana Cloud, nên không bị xóa bởi Compose. `docker compose down -v` xóa volume Alloy cục bộ.
