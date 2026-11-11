---
title: Trợ lý và kỹ năng
description: Tạo trợ lý cho từng công việc, đổi trợ lý khi cần và dùng các quy trình có sẵn.
---

**Trợ lý** là một “người” bạn trò chuyện trong PP Agent. Mỗi trợ lý được chuẩn bị cho một loại công việc.

## Mỗi trợ lý có gì

- Tên và mô tả dễ hiểu.
- Hướng dẫn riêng, ví dụ “luôn trả lời ngắn gọn bằng tiếng Việt”.
- Phần mềm và công cụ được phép dùng.
- Thư mục tài liệu riêng.
- Một số câu hỏi gợi ý để bắt đầu nhanh.

Nhờ vậy, trợ lý tài chính chỉ thấy tài liệu tài chính, còn trợ lý hỗ trợ khách hàng chỉ thấy những gì cần cho công việc đó.

## Tạo trợ lý

1. Mở **Cài đặt › Agent**.
2. Chọn **Tạo trợ lý**.
3. Đặt tên và viết hướng dẫn bằng câu bình thường.
4. Chọn công cụ, thư mục và câu hỏi gợi ý.
5. Lưu, rồi chọn trợ lý trên thanh trên cùng.

Bạn có thể đổi trợ lý giữa cuộc trò chuyện. Lịch sử được giữ lại; hướng dẫn và công cụ thay đổi theo trợ lý mới.

## Kỹ năng là gì?

Kỹ năng là một quy trình có sẵn cho một việc cụ thể, ví dụ cách tạo báo cáo theo mẫu của công ty. Bạn dùng bằng `/skill:<tên>` hoặc để trợ lý tự chọn khi phù hợp.

Đội kỹ thuật có thể cài thêm kỹ năng cho từng nhóm.

## Các lệnh hay dùng

| Lệnh        | Tác dụng                                      |
| ----------- | --------------------------------------------- |
| `/new`      | Mở cuộc trò chuyện mới                        |
| `/compact`  | Tóm tắt cuộc trò chuyện để tiếp tục gọn hơn   |
| `/goal`     | Tiếp tục làm đến khi xong một việc            |
| `/research` | Nghiên cứu và trả báo cáo có nguồn            |
| `/yolo`     | Bỏ bước hỏi cho những việc đã được phép       |

Gõ `/` trong ô tin nhắn để xem danh sách.

:::caution[Trợ lý không thay đổi quyền]
Một trợ lý chỉ thấy công cụ được giao, nhưng công cụ đã bật vẫn làm theo quy tắc phê duyệt. Xem
[Quyền và phê duyệt](/vi/docs/tools-and-approvals/).
:::
