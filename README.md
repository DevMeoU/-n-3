# Hệ thống Quản lý Thư viện Microservices

Demo đồ án môn Phân tích & Thiết kế Hệ thống Thông tin. Hệ thống tách 3 service nghiệp vụ sau API Gateway:

```text
Frontend SPA → API Gateway → User Service / Book Service / Borrow Service
```

Mỗi service sở hữu SQLite riêng. Borrow Service chỉ gọi Book Service qua API `reserve/release`; không cập nhật tồn kho trực tiếp.

## Công nghệ

- Node.js 18+ và Express
- SQLite: `user-service.db`, `book-service.db`, `borrow-service.db`
- JWT, bcryptjs, RBAC backend
- HTML/CSS/JS thuần, Tailwind CDN
- Integration test Node.js thuần

## Chạy local

```powershell
npm install
npm start
```

Mở `http://localhost:3000`.

## Tài khoản demo

| Vai trò | Username | Mật khẩu |
|---|---|---|
| Độc giả | `reader` | `123456` |
| Thủ thư | `librarian` | `123456` |
| Quản trị viên | `admin` | `123456` |

Dữ liệu SQLite tự tạo và seed trong thư mục `data/` ở lần chạy đầu. Không commit file `.db` có dữ liệu test vào bài nộp.

## Kiểm thử tự động

```powershell
npm test
```

Test tự khởi động 4 tiến trình tại cổng `4100–4103`, tạo database test riêng và kiểm tra 13 tình huống:

1. Login sai mật khẩu.
2. API thiếu JWT.
3. Reader xem/tìm sách.
4. Reader không được thêm sách.
5. Librarian thêm sách.
6. Validate số lượng sách.
7. Reader không xem users.
8. Admin tạo user và xử lý username trùng.
9. Reader tạo PENDING không đổi tồn.
10. Librarian duyệt làm giảm tồn.
11. Trả sách tăng tồn và không trả hai lần.
12. Reader hủy PENDING của chính họ.
13. Không duyệt phiếu REJECTED.

## Phân quyền API

| Endpoint | Quyền |
|---|---|
| `POST /api/auth/login` | Public |
| `GET /api/books`, `GET /api/books/:id` | READER, LIBRARIAN, ADMIN |
| `POST/PUT /api/books` | LIBRARIAN, ADMIN |
| `GET/POST /api/users` | ADMIN |
| `POST /api/borrows`, `GET /api/borrows/my`, `POST /api/borrows/:id/cancel` | READER, owner-only khi hủy |
| `GET /api/borrows`, `POST /api/borrows/:id/approve|reject|return` | LIBRARIAN, ADMIN |

Gửi JWT qua header:

```http
Authorization: Bearer <token>
```

Mọi lỗi API dùng format:

```json
{ "error": "Thông báo tiếng Việt" }
```

## Vòng đời phiếu mượn

```text
PENDING --duyệt + reserve thành công--> BORROWING --xác nhận trả + release--> RETURNED
PENDING --thủ thư từ chối / độc giả hủy--> REJECTED
```

- Reader tạo PENDING, chưa trừ tồn kho.
- Librarian/Admin duyệt mới gọi Book Service `reserve` và tính hạn trả 14 ngày.
- Chỉ `BORROWING` được trả; trả thành công gọi `release`.
- Chỉ Book Service sửa `available`, luôn bảo đảm `0 <= available <= quantity`.

## Deploy Render

Repository có `render.yaml` cho **một Render Web Service**. Cách này phù hợp đồ án: một URL công khai, nhưng Gateway vẫn giao tiếp HTTP với 3 service nội bộ và mỗi service vẫn dùng database riêng.

1. Đẩy thư mục này lên GitHub/GitLab.
2. Trên Render, chọn **New → Blueprint**, chọn repository.
3. Render đọc `render.yaml`, chạy `npm install` và `npm start`.
4. Đặt `JWT_SECRET` và `INTERNAL_SERVICE_SECRET` giá trị mạnh nếu không dùng giá trị tự sinh.
5. Sau deploy, cập nhật URL thật tại đây: **Demo URL: _chưa tạo_**.

> Lưu ý: Render free tier có filesystem tạm thời. SQLite phù hợp demo, nhưng dữ liệu có thể reset sau redeploy/restart. Không dùng cấu hình này cho production.

## Cấu trúc

```text
├─ gateway.js                 # API Gateway, JWT/RBAC/proxy/static SPA
├─ services/
│  ├─ user-service.js         # login, tài khoản, bcrypt/JWT
│  ├─ book-service.js         # danh mục, tồn kho, reserve/release
│  ├─ borrow-service.js       # state machine phiếu mượn
│  └─ *-db.js                 # schema + seed SQLite
├─ lib/                       # config, database wrapper, auth helper
├─ frontend/                  # SPA Tailwind CDN
├─ tests/integration.test.js  # 13 test tự động
├─ diagrams/                  # Mermaid kiến trúc, ERD, state, sequence
└─ render.yaml                # Blueprint deploy Render
```
