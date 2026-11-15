---
description: API endpoints reference for the backends NestJS API.
---

# API Reference

Base: `http://localhost:8888`

## Auth (`/auth`)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| POST | `/auth/register` | Public | email, username, firstName, lastName, password |
| POST | `/auth/login` | Public | email, password |
| POST | `/auth/refresh` | Public | refreshToken |
| POST | `/auth/forgot-password` | Public | email |
| POST | `/auth/reset-password` | Public | email, otp, password, confirmPassword |

- Access token TTL: 3h (default, configurable via `JWT_ACCESS_EXPIRES_SECONDS`)
- Refresh token TTL: 7d (default, configurable via `JWT_REFRESH_EXPIRES_SECONDS`)

## User (`/users`)

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/users` | JWT |
| GET | `/users/:id` | JWT |
| PATCH | `/users/:id` | JWT |
| DELETE | `/users/:id` | JWT |

## Category (`/categories`)

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/categories` | JWT |
| POST | `/categories` | JWT |
| GET | `/categories/:id` | JWT |
| PATCH | `/categories/:id` | JWT |
| DELETE | `/categories/:id` | JWT |

## Wallet (`/wallets`)

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/wallets` | JWT |
| POST | `/wallets` | JWT |
| GET | `/wallets/:id` | JWT |
| PATCH | `/wallets/:id` | JWT |
| DELETE | `/wallets/:id` | JWT |

## Transaction (`/transactions`)

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/transactions` | JWT |
| POST | `/transactions` | JWT |
| GET | `/transactions/:id` | JWT |
| PATCH | `/transactions/:id` | JWT |
| DELETE | `/transactions/:id` | JWT |

## Response Format

All responses wrapped by `ResponseInterceptor`:
```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "method": "POST",
  "path": "/api/auth/login"
}
```

## Decorators
- `@Public()` — skip JWT guard on handler
- `@CurrentUser()` — inject current user from JWT payload
- `@ApiResponse({ statusCode, message })` — set response message
