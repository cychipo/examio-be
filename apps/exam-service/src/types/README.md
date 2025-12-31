# Exam Module Types

Đây là folder chứa các enum types được sử dụng trong exam module. Các enum được định nghĩa dưới dạng số nguyên (INT) để tiết kiệm dung lượng lưu trữ so với string.

## Enums

### ASSESS_TYPE

Loại đánh giá của phòng thi:

- `PUBLIC = 0` - Phòng thi công khai, ai cũng có thể tham gia
- `PRIVATE = 1` - Phòng thi riêng tư, cần được phê duyệt

### EXAM_SESSION_STATUS

Trạng thái của phiên thi:

- `UPCOMING = 0` - Phiên thi sắp diễn ra, chưa bắt đầu
- `ONGOING = 1` - Phiên thi đang diễn ra
- `ENDED = 2` - Phiên thi đã kết thúc

### EXAM_ATTEMPT_STATUS

Trạng thái của lần làm bài:

- `IN_PROGRESS = 0` - Đang làm bài
- `COMPLETED = 1` - Đã hoàn thành
- `CANCELLED = 2` - Đã hủy

### PARTICIPANT_STATUS

Trạng thái của người tham gia:

- `PENDING = 0` - Chờ phê duyệt
- `APPROVED = 1` - Đã được phê duyệt
- `REJECTED = 2` - Bị từ chối
- `LEFT = 3` - Đã rời khỏi phiên thi

## Usage

```typescript
import {
    ASSESS_TYPE,
    EXAM_SESSION_STATUS,
    EXAM_ATTEMPT_STATUS,
    PARTICIPANT_STATUS,
} from './types';

// Sử dụng trong code
if (examRoom.assessType === ASSESS_TYPE.PUBLIC) {
    // Logic cho phòng thi công khai
}

if (examSession.status === EXAM_SESSION_STATUS.ONGOING) {
    // Logic cho phiên thi đang diễn ra
}
```

## Benefits

- **Tiết kiệm dung lượng**: INT chiếm ít byte hơn so với STRING
- **Type-safe**: TypeScript sẽ kiểm tra type khi compile
- **Dễ bảo trì**: Thay đổi giá trị enum ở một nơi sẽ áp dụng cho toàn bộ project
- **Readable**: Code dễ đọc hơn với tên enum có ý nghĩa thay vì số
