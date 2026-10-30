# dogcast-server

Dogcast 的后端：临时房间、观看凭证、WebSocket 信令，以及 STUN/TURN 短期凭证。媒体走浏览器之间的 WebRTC，本服务不转发音视频。

配套前端是独立仓库 [dogcast-web](https://github.com/AppleProPlusMax/dogcast-web)。

## 能做什么

- 首页「开始分享」调用 `POST /api/lobbies`，创建一个 12 小时有效的房间和房间号，并签发分享者 JWT。观众用 `GET /api/watch/:code` 换取访客 JWT，不需要注册。
- 仍保留账号密码登录。Access Token 是 JWT（默认 15 分钟），Refresh Token 放在 `dogcast_refresh` 这个 httpOnly cookie 里（默认 14 天），刷新时会轮换。公开注册默认关闭。
- 启动时自动建 SQLite 表，并种子一个默认房间（`slug=home`，「家庭房」）。
- 同一房间同一时刻最多 1 人分享、4 人观看。第二个人申请分享会被拒绝，第 5 个观看者也会被拒绝。
- 在房间成员之间转发 SDP 和 ICE，不解析、不改写。码率由网页端写在 SDP 里。
- `GET /api/ice/servers` 用 `TURN_AUTH_SECRET` 签发 coturn 临时用户名和密码。
- `POST /api/speed-test` 丢弃已登录用户上传的一段数据并返回字节数，供网页估算上行。网页单次不超过 768KB；Nginx 若把 `client_max_body_size` 设得更小，测速会收到 HTML 而不是 JSON。

## 环境

- Node.js 20 或更高
- 本地开发用 `tsx` 直接跑 TypeScript，不需要单独编译产物

## 本地启动

```bash
npm install
copy .env.example .env
npm run create-admin -- --username hao --password "change-me-now" --display-name Hao
npm run dev
```

服务默认听 `http://127.0.0.1:3000`。确认进程起来：

```bash
curl http://127.0.0.1:3000/api/health
```

应返回 `{"ok":true,"version":"0.1.0"}`。

用户名 3–32 位，只能是字母、数字和下划线。密码 8–128 位。`--role` 可省略，默认是 `admin`；要建普通成员就加上 `--role member`。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 监听源码并重启 |
| `npm start` | 按当前环境启动一次 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest：HTTP、WebSocket、房间状态机、建号 CLI |
| `npm run create-admin -- --username <name> --password <password> [--display-name <name>] [--role admin\|member]` | 写入一个用户 |

## HTTP

统一前缀 `/api`。失败响应形如：

```json
{ "error": { "code": "SHARE_SLOT_TAKEN", "message": "..." } }
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 无需登录 |
| POST | `/api/lobbies` | 打开一个新房间，返回房间号和分享者 access token |
| GET | `/api/watch/:code` | 凭房间号换取访客 access token |
| POST | `/api/speed-test` | 已登录用户上传一段 `application/octet-stream`，响应 `{ "bytes": N }` |
| POST | `/api/auth/register` | 邀请码注册；`AUTH_PUBLIC_REGISTER=false` 时没有有效邀请码会失败 |
| POST | `/api/auth/login` | 返回 access token，并设置 refresh cookie |
| POST | `/api/auth/refresh` | 凭 cookie 换新的 access token |
| POST | `/api/auth/logout` | 作废当前 refresh，并清 cookie |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/admin/users` | 管理员建号 |
| GET | `/api/admin/users` | 管理员看用户列表 |
| POST | `/api/admin/invites` | 管理员创建邀请码，明文只返回这一次 |
| GET | `/api/rooms/default` | 默认房间和自己的成员身份 |
| GET | `/api/rooms/:roomId` | 房间信息 |
| GET | `/api/rooms/:roomId/members` | 成员列表，在线状态以 WebSocket 快照为准 |
| GET | `/api/ice/servers` | 已登录用户获取 STUN/TURN 配置 |

登录接口按 IP 限流（默认 10 次/分钟），其余请求有全局粗限流。

## WebSocket

地址是 `ws://<host>/ws`（生产为 `wss`）。连接后 10 秒内必须发送：

```json
{ "v": 1, "type": "auth", "requestId": "...", "payload": { "accessToken": "<jwt>" } }
```

随后 `room.join`（`{ "slug": "home" }`）会收到 `room.snapshot`。分享、观看和信令消息包括 `share.request`、`viewer.claim`、`signal.offer`、`signal.answer`、`signal.ice-candidate`。客户端约每 20 秒发 `ping`；服务端 45 秒没有任何消息会断开。分享状态只放在内存里，进程重启后归零，客户端需要重连并重新协商。

## 配置

变量说明见 `.env.example`。生产环境至少要换掉 `JWT_ACCESS_SECRET` 和 `TURN_AUTH_SECRET`，并把 `COOKIE_SECURE` 设为 `true`。TURN 长期口令只放在 coturn 和这份环境变量里，不要写进前端仓库。

SQLite 文件路径由 `DATABASE_PATH` 决定，开发默认是 `./data/dogcast.db`。

## 目录

```text
src/
  index.ts            启动与退出
  app.ts              Fastify 组装
  config.ts           环境变量校验
  db/                 better-sqlite3 + drizzle
  modules/            auth、lobby、watch、users、rooms、invites、ice、speed、health
  ws/                 网关、房间状态机、信令转发
  plugins/            JWT、CORS、限流
scripts/create-admin.ts
```
