# 📝 Logging Interceptor - Hướng dẫn sử dụng

## Mô tả

Global Logging Interceptor đã được cài đặt để tự động log thông tin của mọi API request/response trong ứng dụng NestJS.

## Tính năng

### 📥 Request Logging
Interceptor sẽ log các thông tin sau khi nhận request:
- ✅ HTTP Method (GET, POST, PUT, DELETE, etc.)
- ✅ URL Path
- ✅ IP Address
- ✅ User Agent
- ✅ User Information (nếu đã authenticated)
- ✅ Query Parameters
- ✅ Path Parameters
- ✅ Request Body (với sensitive data được ẩn đi)

### 📤 Response Logging
Khi response được trả về:
- ✅ HTTP Status Code
- ✅ Response Time (ms)
- ✅ Response Data (chỉ trong development mode, giới hạn 200 ký tự)

### ❌ Error Logging
Khi có lỗi xảy ra:
- ✅ Error Status Code
- ✅ Error Message
- ✅ Response Time

### 🔒 Security
Tự động ẩn các sensitive fields trong request body:
- `password`
- `confirmPassword`
- `token`
- `accessToken`
- `refreshToken`
- `secret`
- `apiKey`

Các field này sẽ được thay thế bằng `***HIDDEN***` trong logs.

## Ví dụ Output

### Request Log
```
[HTTP] 📥 Incoming Request | POST /api/v1/auth/login | IP: ::1 | User-Agent: Mozilla/5.0...
[HTTP] Body: {"email":"user@example.com","password":"***HIDDEN***"}
```

### Response Log
```
[HTTP] 📤 Response | POST /api/v1/auth/login | Status: 200 | Time: 145ms
```

### Error Log
```
[HTTP] ❌ Error | POST /api/v1/auth/login | Status: 401 | Time: 12ms | Error: Invalid credentials
```

## Cấu hình

### Tắt Response Data Logging
Mặc định, response data chỉ được log trong development mode. Để tắt hoàn toàn, comment dòng 54-58 trong file:
```typescript
// if (process.env.NODE_ENV === 'development') {
//     this.logger.debug(
//         `Response Data: ${JSON.stringify(data).substring(0, 200)}...`
//     );
// }
```

### Thêm Sensitive Fields
Để thêm các field cần ẩn, chỉnh sửa mảng `sensitiveFields` trong method `sanitizeBody()`:
```typescript
const sensitiveFields = [
    'password',
    'confirmPassword',
    'token',
    // Thêm fields khác tại đây
    'creditCard',
    'ssn',
];
```

### Thay đổi Log Level
Để xem chi tiết query params, path params, và body, đảm bảo log level là `debug` hoặc cao hơn trong NestJS config.

## Files
- **Interceptor**: `src/common/interceptors/logging.interceptor.ts`
- **Registration**: `src/main.ts` (line 20)

## Testing

Sau khi server khởi động lại, mọi API call đều sẽ được log tự động. Bạn có thể test bằng cách:

1. Gọi bất kỳ API endpoint nào
2. Kiểm tra console/terminal để xem logs
3. Logs sẽ hiển thị với prefix `[HTTP]`

## Notes

- Interceptor hoạt động ở global level, áp dụng cho tất cả routes
- Không cần thêm decorator hay config gì thêm ở controller/route level
- Logs được format với emoji để dễ đọc: 📥 (incoming), 📤 (response), ❌ (error)
