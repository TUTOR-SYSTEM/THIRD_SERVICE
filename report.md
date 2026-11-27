# Báo cáo review tĩnh — third-service

- **Ngày:** 2026-11-27
- **Phạm vi:** `/home/user/THIRD_SERVICE` (`src/`, `docker-compose.yml`, `.claude/rules/`). Chỉ đọc thêm các đoạn liên quan ở `gateway`, `USER`, `tutor-service`.
- **Commit / branch:** `5724a12` / `ccr-6e14d698-ruxjzr` (working tree sạch).
- **Phương pháp:** review tĩnh, không chạy app/test, không gửi message thử lên RabbitMQ. Không đọc `.env*` và không đọc `.claude/settings.local.json`.

## 1. Tóm tắt

Tổng: **20 finding** — High 2, Medium 6, Low 9, Info 3.

Rủi ro quan trọng nhất:
1. `third_queue` không xác thực publisher và `redis.*` không có allowlist key (F-01). Publisher trên queue đọc được OTP đặt lại mật khẩu (salted SHA-256 của mã 6 chữ số) hoặc ghi đè bản ghi OTP với mã tự chọn, dẫn tới chiếm tài khoản qua endpoint reset công khai.
2. Danh tính trong payload RPC không được ký (F-02, F-03): `upload.delete` tin `role: 'ADMIN'`, `upload.download` tin `authorized: true`, notification RPC tin `senderId`/`role`/`userId`.
3. Email RPC không giới hạn (F-07): gửi "mã đặt lại mật khẩu" với mã do caller chọn từ địa chỉ `MAIL_FROM`.
4. Log (F-05, F-06): `log.query` đọc toàn bộ request log không xác thực; socket `/logs` không kiểm tra lại phiên sau logout tới khi JWT hết hạn (mặc định 3h).
5. Deny-list Redis lỗi thời (F-04): thiếu `verify-email:` và `revoked-*`.

**Điều kiện chung** cho F-01, F-02, F-03, F-05 (phần RPC), F-06, F-07: có quyền publish lên `third_queue`. Compose bind RabbitMQ `127.0.0.1`, nhưng deploy thực tế chưa xác minh. Nếu broker truy cập được từ mạng không tin cậy, nâng **F-01 và F-02 lên Critical**.

## 2. Bảng tổng hợp

| ID | Mức độ | Loại | File:line | Tiêu đề |
|----|--------|------|-----------|---------|
| F-01 | High | Security | `src/features/redis/redis.rpc.controller.ts:40-119`; `redis.service.ts:242-345` | `redis.*` RPC không xác thực, không allowlist key; đọc/ghi OTP reset |
| F-02 | High | Security | `src/features/uploads/upload.rpc.controller.ts:177-233`; `upload.service.ts:233-259` | `upload.delete`/`upload.download` tin `role`/`authorized` không ký |
| F-03 | Medium | Security | `src/features/notification/notification.rpc.controller.ts:177-212`; `notification.service.ts:47-77`; `packages/entities/notification/notification.schema.ts:43` | Notification RPC tin `senderId`/`role`/`userId`: giả mạo, IDOR |
| F-04 | Medium | Security | `src/features/redis/redis.controller.ts:27-35`; `redis.rpc.controller.ts:7-14` | Deny-list/TTL list lỗi thời: thiếu `verify-email:`, `revoked-*`, `current-password-attempts:` |
| F-05 | Medium | Security | `src/features/log/log.gateway.ts:51-123` | Socket `/logs` không kiểm tra lại phiên sau handshake |
| F-06 | Medium | Security | `src/features/log/log.rpc.controller.ts:148-180`; `trace-context.interceptor.ts:194` | `log.query`/`trace`/`stats` không xác thực; `log.create` giả mạo, flood |
| F-07 | Medium | Security | `src/features/email/email.rpc.controller.ts:49-78`; `email.service.ts:58-73, 130-146` | Email RPC không xác thực/không giới hạn |
| F-08 | Medium | Security (cần xác minh) | `src/features/uploads/upload.service.ts:164, 193, 222-226` | URL công khai trả về; bucket public sẽ bỏ qua kiểm tra owner |
| F-09 | Low | Bug | `src/features/redis/redis.controller.ts:95-98` | `GET /redis/get` không validate: key lặp gây 500 |
| F-10 | Low | Security | `src/app.controller.ts:29-63` | `health.redis` trả `dbsize`/INFO cho mọi publisher |
| F-11 | Low | Bug/Security | `redis.service.ts:268-285, 336-345`; `redis.rpc.controller.ts:69-80, 113-119` | Không trần TTL, `windowSeconds`, số keys của `redis.del` |
| F-12 | Low | Security (DoS) | `src/features/uploads/upload.service.ts:168-180` | Sharp không giới hạn concurrency |
| F-13 | Low | Bug (cross-repo) | Gateway `src/features/rabbitmq/rmq.constants.ts:34`; third không có handler `testscenario.*` | Gateway gửi `testscenario.*` tới `third_queue` không có handler |
| F-14 | Low | Bug | `src/packages/interceptor/rmq-ack.interceptor.ts:105-113, 131-135` | Nack `requeue=false` mọi lỗi; at-least-once không idempotent |
| F-15 | Low | Security (cần xác minh) | `src/features/email/email.service.ts:44-55` | STARTTLS chỉ bắt buộc khi có SMTP auth |
| F-16 | Low | Hygiene | `.claude/settings.local.json` (git tracked, `78dac93`) | File local config đang được track, trái quy tắc |
| F-17 | Info | Config | `src/packages/guards/jwt-auth.guard.ts:123-127` | `SESSION_CHECK_FAIL_OPEN=true` bỏ qua kiểm tra phiên khi Redis down |
| F-18 | Info | Config | `src/main.ts:87-122` | Swagger mở khi `ENABLE_SWAGGER=true` kể cả production |
| F-19 | Info | Config | `src/packages/configs/jwt-sign.config.ts:66` | Refresh secret mặc định bằng access secret (repo này không ký token) |
| F-20 | Low | Bug/DoS | `src/features/notification/notification.service.ts:120-128`; `notification.schema.ts:63` | Fan-out `classId` không giới hạn; `page` lớn làm OFFSET lớn |

## 3. Chi tiết

### F-01 — High — Security — `redis.*` RPC không xác thực, không allowlist key
**File:** `src/features/redis/redis.rpc.controller.ts` (get 40, exists 46, ttl 52, getdel 59, incr 70, set 86-97, delByPrefix 104, del 114); `redis.service.ts` (set 268-285, del 313-318, incrWithWindow 336-345).

**Mô tả:** Handler `redis.*` nhận lệnh từ mọi publisher trên `third_queue` mà không kiểm tra caller. HTTP có deny-list họ key nhạy cảm (`redis.controller.ts:27-35`, `assertNotSensitive` 227-234), RPC thì không. USER ghi vào Redis: `reset-password-otp:<uid>` = `{codeId, salt, hash}` với `hash = sha256(salt:otp)` (`USER/src/features/auth/auth.service.ts:107-113, 620-624`, TTL 5 phút); `reset-password-otp-window:<uid>`; `session:`, `refresh:`, `verify-email:`, `login-fail:`.

**Tác động — chuỗi chiếm tài khoản:**
1. `redis.get` `reset-password-otp:<victimId>` trả `salt` + `hash`. Mã 6 chữ số brute force offline bằng SHA-256 trong vài giây.
2. `redis.set` ghi đè `reset-password-otp:<victimId>` với salt/hash tự chọn và TTL tuỳ ý (kiểm tra TTL ở 88-94 chỉ yêu cầu có TTL). Sau đó gọi endpoint reset password công khai với mã đã chọn để đổi mật khẩu.
3. `redis.del` xoá `reset-password-otp-window:<uid>` (bộ đếm brute force theo tài khoản).
4. `redis.incr`/`set`/`del` trên `login-fail:<sha256>` để khoá hoặc mở khoá đăng nhập.
5. `redis.getdel` tiêu thụ token single-use của người khác (DoS).
6. `redis.delByPrefix` (regex UUID, `redis.service.ts:287-311`) xoá session/refresh của một user (buộc đăng nhập lại).

**Đề xuất:** xác thực caller bằng HMAC (tái dùng cơ chế `RPC_ACTOR_SECRET` và `rpc-actor-signature.helper` của USER/gateway) hoặc tách queue/pattern nội bộ; áp allowlist key cho RPC giống HTTP; chỉ USER được ghi `reset-password*`, `session:`, `refresh:`, `verify-email:`, `login-fail:`. Phía USER: thay sha256 nhanh bằng HMAC có khoá phía server hoặc hàm băm chậm để brute force offline vô nghĩa.

### F-02 — High — Security — `upload.delete` và `upload.download` tin `role`/`authorized` không ký
**File:** `src/features/uploads/upload.rpc.controller.ts` (upload 177-189, role/userId 181-182; download 212-219, `authorized` ở 217; del 226-233, role check ở 228); `upload.service.ts` (assertDownloadable 233-259, bypass ở 251; presignDownload 262-275; deleteOwned 311-329).

**Mô tả:** `upload.delete` chỉ kiểm `payload.role === 'ADMIN'` rồi xoá, không kiểm owner. `upload.download` đặt `authorized = payload.authorized === true`; khi true, `assertDownloadable` bỏ qua owner (251) và trả presigned URL 300 giây. Gateway (`gateway/src/features/upload/upload.controller.ts:152-156`) đặt `authorized: true` sau khi `exercise.fileAccess` cho phép, nên luồng HTTP đúng, nhưng third không phân biệt được request từ gateway với publisher khác. Gateway chỉ ký actor khi payload có `actorId`/`clientIp`/OAuth (`gateway/src/features/rabbitmq/rmq.producer.ts:53-75`), nên payload `upload.*` không bao giờ được ký và third không verify.

**Tác động:** publisher trên `third_queue` xoá bất kỳ object nào (`{key, role:'ADMIN'}`), gồm tài liệu gia sư và bài nộp học sinh; lấy presigned URL cho bất kỳ key nào (`{key, authorized:true}`), bỏ qua `exercise.fileAccess`; upload với `userId`/`role` giả.

**Tái hiện:** publish pattern `upload.delete`, payload `{"key":"uploads/<uuid>.pdf","role":"ADMIN"}` → `{ok:true,key}`.

**Đề xuất:** ký `userId`/`role`/`authorized` ở gateway (mở rộng `withActorSignature`) và verify ở third. Không cho `authorized` đi qua RPC: gateway tự presign sau khi kiểm quyền. Tách pattern xoá admin và yêu cầu chữ ký.

### F-03 — Medium — Security — Notification RPC tin `senderId`/`role`/`userId` từ payload
**File:** `src/features/notification/notification.rpc.controller.ts:177-212`; `notification.service.ts:47-77` (senderId không ghi đè), 83-98; `packages/entities/notification/notification.schema.ts:43`.

**Mô tả:** HTTP ghi đè `senderId = user.id` (`notification.controller.ts:76-79`), gateway cũng gửi `senderId: user.id`. RPC `notification.create` thì lấy `senderId` và `role` từ payload. `getAll`/`getById`/`markAsRead`/`delete` nhận `userId` từ payload không ký.

**Tác động:** publisher gửi `role:'ADMIN'`, `type:'SYSTEM'`/`'TUITION'`, `senderId` tuỳ ý tới bất kỳ `userId`/`studentId`/`classId` (fan-out), nội dung tới 5000 ký tự, `redirectUrl` nội bộ → phishing trong app. Đọc/đánh dấu/xoá thông báo người khác (IDOR qua RPC).

**Đề xuất:** dùng cùng cơ chế ký actor; `senderId` lấy từ actor đã ký; không tin `role` từ payload.

### F-04 — Medium — Security — Deny-list và TTL list Redis lỗi thời
**File:** `src/features/redis/redis.controller.ts:27-35` và 227-234; `redis.rpc.controller.ts:7-14`.

**Mô tả:** Thiếu so với USER:
- `verify-email:<jti>` (`USER/src/features/auth/auth.service.ts:72`): token xác thực email single-use.
- `revoked-all:<uid>`, `revoked-session:<uid>:<sid>` (`USER/src/packages/helpers/session.helper.ts:27-28`): marker thu hồi. USER dựa vào marker để chặn refresh đang bay. ADMIN qua `DELETE /redis/del` hoặc publisher RPC có thể xoá marker.
- `current-password-attempts:<uid>`, `forgot-password-rate:*`, `login-fail:*`: đếm brute force, reset được.

**Đề xuất:** dùng một nguồn chung cho danh sách họ key nhạy cảm và TTL; thêm các họ trên; chặn set/del/getdel ở cả HTTP lẫn RPC.

**Cần xác minh:** value của `verify-email:` (userId hay token).

### F-05 — Medium — Security — Socket `/logs` không kiểm tra lại phiên
**File:** `src/features/log/log.gateway.ts:51-110` (session 81, role/isActive 85-93, timer exp 99-106), `121-123`.

**Mô tả:** Xác thực (JWT ADMIN, `session:` trong Redis, `isActive`, `role`) chỉ chạy lúc kết nối. Logout, đổi mật khẩu, khoá tài khoản không ngắt socket; chỉ ngắt khi JWT hết hạn (access TTL 3h, `packages/helpers/jwt.helper.ts:17`). Mọi `log:new` (preview request/response tới 1000 ký tự) vẫn được gửi tới `admins`. Không có `@SubscribeMessage`, nên chỉ lộ dữ liệu một chiều.

**Đề xuất:** revalidate session và `isActive`/`role` định kỳ (30-60 giây) hoặc ngắt socket khi có sự kiện revoke.

### F-06 — Medium — Security — `log.*` RPC không xác thực: đọc, giả mạo, flood
**File:** `src/features/log/log.rpc.controller.ts:148-180`; `src/packages/interceptor/trace-context.interceptor.ts:194`.

**Mô tả:** `log.query`/`trace`/`stats` (MessagePattern) không xác thực, trả toàn bộ `request_logs` (path, userId, ip, preview body/response, errorMessage). `log.create` (EventPattern) nhận `userId`/`ip`/`serviceName` tuỳ ý, không rate limit. `correlationId` lấy từ header AMQP không kiểm tra, có thể gắn log giả vào trace khác.

**Tác động:** lộ hoạt động người dùng; trinh sát cho F-01; giả mạo audit trail; flood Postgres và socket admin.

**Đề xuất:** ký `log.query`/`trace`/`stats`; `log.create` chỉ nhận từ service đã ký hoặc queue riêng; giới hạn tốc độ; validate `correlationId` định dạng UUID.

### F-07 — Medium — Security — Email RPC không xác thực, không giới hạn
**File:** `src/features/email/email.rpc.controller.ts:49-52` (`email.test`), 54-64 (`sendPasswordResetOtp`), 66-78 (`sendAccountCreated`); `email.service.ts:58-73`, 130-146.

**Mô tả:** không xác thực, không rate limit. `to` là email hợp lệ bất kỳ; `otp` là 6 chữ số do caller chọn; `password`/`username` là chuỗi tự do (escape HTML nhưng vẫn là nội dung do caller quyết định). Gửi từ `MAIL_FROM` hệ thống. `email.test` gửi lặp không giới hạn tới `TEST_EMAIL_RECIPIENT` (HTTP đã bọc `AdminRoleGuard`, RPC thì không).

**Tác động:** spam, mạo danh hệ thống, làm hỏng uy tín địa chỉ gửi, có thể bị nhà cung cấp SMTP khoá; hỗ trợ social engineering.

**Đề xuất:** xác thực caller; chỉ USER gửi mail OTP/tài khoản; rate limit theo người nhận; bỏ `email.test` khỏi RPC.

### F-08 — Medium — Security (cần xác minh) — URL công khai khi upload
**File:** `src/features/uploads/upload.service.ts:164, 193, 222-226`.

**Mô tả:** `upload()` trả `CLOUDFLARE_R2_PUBLIC_URL/<key>` cho mọi file, kể cả `submissions/`. Nếu bucket/domain public, ai có URL đọc được, bỏ qua `assertDownloadable`. URL là bearer vĩnh viễn, nằm trong response HTTP, gateway `LoggerInterceptor` log response data.

**Đề xuất:** không trả public URL cho file nội bộ/bài nộp; chỉ trả `key`; bucket private.

**Cần xác minh:** bucket policy và giá trị `CLOUDFLARE_R2_PUBLIC_URL` (không đọc `.env`).

### F-09 — Low — Bug — `GET /redis/get` với key lặp gây 500
**File:** `src/features/redis/redis.controller.ts:95-98`.

**Mô tả:** `@Query('key') key: string` không qua `ZodValidationPipe` (khác `exists`/`ttl`/`getdel`). `?key=a&key=b` → mảng → `key.toLowerCase()` TypeError → 500. Không phải bypass.

**Đề xuất:** `@Query(new ZodValidationPipe<KeyDto>(keySchema))`.

### F-10 — Low — Security — `health.redis` lộ thông tin Redis
**File:** `src/app.controller.ts:29-63` (dbsize 49, INFO 50-51).

**Đề xuất:** bỏ thông tin nhạy cảm khỏi response RPC hoặc giới hạn cho healthcheck nội bộ.

### F-11 — Low — Bug/Security — Không trần TTL, `windowSeconds`, số keys
**File:** `redis.service.ts:268-285` (ttlSeconds không trần; `Math.ceil` → `EX` quá lớn gây lỗi Redis), `336-345`; `redis.rpc.controller.ts:69-80` (incr: không giới hạn prefix), `113-119` (del: mảng keys không giới hạn).

**Đề xuất:** trần TTL (30 ngày), trần window (1 ngày), giới hạn số keys mỗi lệnh (100), giới hạn prefix cho `incr`.

### F-12 — Low — Security (DoS) — Sharp không giới hạn concurrency
**File:** `src/features/uploads/upload.service.ts:168-180`.

**Mô tả:** ảnh tới 40MP decode đồng thời, không semaphore toàn cục. Quota 30 file/phút/user giới hạn tần suất nhưng không giới hạn đồng thời giữa nhiều user. Quota trước khi validate là chủ đích.

**Đề xuất:** `sharp.concurrency(n)` và/hoặc semaphore; giảm `MAX_IMAGE_PIXELS` nếu được.

### F-13 — Low — Bug (cross-repo) — `testscenario.*` không có handler ở third
**File (gateway):** `gateway/src/features/rabbitmq/rmq.constants.ts:34`; `gateway/src/features/test-scenario/test-scenario.controller.ts`. **File (third):** `grep -rln testscenario src` = 0 file.

**Tác động:** mọi route `/test-scenarios` của gateway lỗi "no matching message handler" hoặc timeout.

**Đề xuất:** gỡ route khỏi gateway hoặc khôi phục feature; đồng bộ tài liệu.

### F-14 — Low — Bug — Ack/nack: mất message khi lỗi tạm thời, lặp side effect khi crash
**File:** `src/packages/interceptor/rmq-ack.interceptor.ts:105-113, 131-135`.

**Mô tả:** mọi lỗi → `nack(requeue=false)`, không DLX → lỗi tạm thời làm mất message vĩnh viễn. Crash giữa handler và ack → redelivery: `email.sendPasswordResetOtp` gửi lại mail, `upload.upload` tạo object trùng, `notification.create` tạo trùng. Không idempotency key.

**Đề xuất:** DLX/DLQ với retry có giới hạn; idempotency key cho email/upload/notification.

### F-15 — Low — Security (cần xác minh) — STARTTLS chỉ bắt buộc khi có auth
**File:** `src/features/email/email.service.ts:44-55` (`requireTLS: secure !== 'true' && !!(user && pass)`).

**Mô tả:** không có user/pass thì STARTTLS chỉ opportunistic; mail OTP có thể gửi clear nếu MITM strip STARTTLS.

**Đề xuất:** tuỳ chọn `SMTP_REQUIRE_TLS`, bật mặc định khi không dùng SMTPS.

**Cần xác minh:** relay SMTP nội bộ có hỗ trợ TLS không.

### F-16 — Low — Hygiene — `.claude/settings.local.json` đang được git track
**File:** `.claude/settings.local.json` (`git ls-files`; commit `78dac93 report+rabbitmq`).

**Mô tả:** quy tắc yêu cầu không commit file này vì có thể chứa secret. Nội dung chưa đọc (theo quy tắc secret).

**Đề xuất:** kiểm tra nội dung; nếu có secret thì rotate, `git rm --cached`, thêm `.gitignore`.

### F-17 — Info — `SESSION_CHECK_FAIL_OPEN`
**File:** `src/packages/guards/jwt-auth.guard.ts:123-127`. Bật thì Redis down sẽ bỏ qua kiểm tra session (còn DB check). Mặc định fail-closed. Ghi nhận trong runbook.

### F-18 — Info — Swagger
**File:** `src/main.ts:87-122`. `/api-docs` mở khi `ENABLE_SWAGGER=true` kể cả production. Chỉ lộ schema. Ghi nhận.

### F-19 — Info — Refresh secret fallback
**File:** `src/packages/configs/jwt-sign.config.ts:66`. Thiếu `JWT_REFRESH_SECRET` thì dùng access secret. Repo này không ký token nên không ảnh hưởng tại đây; kiểm tra USER/gateway.

### F-20 — Low — Bug/DoS — Fan-out và pagination không giới hạn
**File:** `src/features/notification/notification.service.ts:120-128` (classId fan-out, insert N hàng không giới hạn); `notification.schema.ts:63` (page tới 100000 × limit 100 → OFFSET 10^7).

**Đề xuất:** giới hạn recipient mỗi request hoặc xử lý bất đồng bộ; keyset pagination.

## 4. Điểm đã kiểm tra và thấy ổn
- **Notification `redirectUrl`** (`notification.schema.ts:20-32`): chỉ `/...` nội bộ (không `//`) hoặc `https://` có host allowlist; chặn control char, khoảng trắng, backslash, userinfo; `detail-url.ts` kiểm tra lại.
- **Notification HTTP**: `senderId` ghi đè; `getById`/`markAsRead`/`delete` chỉ recipient; `visibleTo` đúng; TUTOR chỉ gửi TUTOR/STUDENT và phải sở hữu lớp/dạy học sinh (`notification.service.ts:104-117`); STUDENT chỉ gửi tới gia sư đang dạy (`83-98`).
- **SQL**: Drizzle parameterized; `escapeLike` cho `ILIKE`; không có `KEYS` hay raw SQL nối chuỗi; Lua script cố định.
- **Upload**: whitelist extension, chặn MIME nguy hiểm; magic bytes cho tài liệu; ảnh re-encode JPEG bằng sharp; key UUID, `assertValidKey` chặn `..`, `\` và yêu cầu prefix; `attachment` cho tài liệu; `nosniff` và `pipeline` cho HTTP download; multer giới hạn file/fields/parts/size; `limitInputPixels`; PARENT không upload được.
- **Redis HTTP**: ADMIN-only sau `JwtAuthGuard`; `delByPrefix` regex UUID; SCAN; GETDEL cho single-use; TTL bắt buộc cho họ session/refresh.
- **JwtAuthGuard**: secret từ env không fallback; kiểm `typ`, `sid`, session Redis, `isActive`, `role` đối chiếu DB; fail-closed mặc định.
- **LogGateway**: ADMIN kiểm trong JWT và DB; ngắt khi JWT hết hạn; không nhận lệnh từ client.
- **Redaction**: che `password`, `token`, `otp`, `code`, `authorization`, `value`, JWT pattern; bỏ body cho `redis.`, `email.`, `upload.`, `health.`, `log.`; header allowlist.
- **Lỗi**: `RpcExceptionFilter`/`ErrorInterceptor` không trả raw error text.
- **CORS**: mặc định tắt ngoài dev/test; credentials chỉ với allowlist.
- **Email**: escapeHtml cho giá trị động; `verifyUrl` encodeURIComponent; `z.email()`, `z.uuid()`, OTP `^\d{6}$`; `requireTLS` khi có credential; timeout.
- **RMQ bootstrap**: `RABBITMQ_URL` bắt buộc, không default `guest`; `prefetchCount` và manual ack.
- **Docker**: Postgres, Redis, RabbitMQ bind `127.0.0.1`.

## 5. Hạn chế của lần review
- Review tĩnh: không chạy app/test, không gửi message thử lên RabbitMQ. Các chuỗi tấn công là suy luận từ mã.
- Không đọc `.env*` và không đọc `.claude/settings.local.json` (quy tắc secret). Cấu hình thực tế (R2 public URL, bucket policy, `SMTP_*`, `CORS_ORIGINS`, `ENABLE_SWAGGER`, `SESSION_CHECK_FAIL_OPEN`, credential/mạng RabbitMQ) chưa xác minh; các mục "cần xác minh" phụ thuộc vào đó.
- Chỉ đọc đoạn liên quan ở sibling repo; cơ chế ký actor kiểm tra ở mức `rmq.producer.ts` và luồng reset password.
- Schema Drizzle chỉ xét ở mức import/query, chưa đối chiếu đầy đủ với gateway.
- Chưa chạy audit dependency và chưa xem test coverage.
- Không xét nitpick style và TUTOR-UI (ngoài phạm vi).

## Mức độ theo số lượng
- High: 2 (F-01, F-02)
- Medium: 6 (F-03 đến F-08)
- Low: 9 (F-09 đến F-16, F-20)
- Info: 3 (F-17 đến F-19)
