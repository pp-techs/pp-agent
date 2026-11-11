---
title: Dữ liệu trên máy
description: PP Agent lưu cuộc trò chuyện, tài liệu và cài đặt ở đâu; cách sao lưu, chuyển máy và xóa dữ liệu.
---

## Thư mục làm việc

Mặc định, PP Agent làm việc trong thư mục **PP Agent** trong **Documents** của bạn. Tệp bạn đính kèm, báo cáo và tài liệu được tạo nằm ở đó.

Mỗi trợ lý có thể có thư mục riêng.

## Cài đặt và lịch sử

Cài đặt, cuộc trò chuyện và thông tin bảo mật nằm trong thư mục dữ liệu của ứng dụng:

| Máy    | Vị trí                                          |
| ------ | ----------------------------------------------- |
| Mac    | `~/Library/Application Support/PP Agent`        |
| Windows| `%APPDATA%\PP Agent`                            |
| Linux  | `~/.config/PP Agent`                            |

Bạn không cần mở thư mục này trong công việc hằng ngày.

## Sao lưu

- Sao lưu thư mục làm việc để giữ tài liệu.
- Sao lưu thư mục dữ liệu nếu muốn giữ lịch sử trò chuyện và cài đặt.
- Thông tin đăng nhập đã mã hóa có thể không khôi phục được nếu chuyển sang máy khác. Khi đó, hãy đăng nhập lại dịch vụ AI.

## Chuyển sang máy mới

1. Cài PP Agent trên máy mới.
2. Thoát ứng dụng trên cả hai máy.
3. Chép thư mục làm việc và thư mục dữ liệu sang.
4. Mở ứng dụng; nếu được hỏi, đăng nhập lại dịch vụ AI.

## Xóa dữ liệu

Thoát ứng dụng không xóa dữ liệu. Để xóa, hãy xóa thư mục làm việc và thư mục dữ liệu. Nếu muốn xóa cả khóa bảo mật, nhờ đội kỹ thuật xóa mục lưu trong kho bảo mật của máy.

:::note[Dành cho IT]
Có thể đổi vị trí dữ liệu bằng biến môi trường `PP_AGENT_HOME`. Trên server hoặc Docker, đặt `PP_AGENT_MASTER_KEY` để không phụ thuộc kho bảo mật của máy tính. Chi tiết trong [tài liệu kỹ thuật](https://github.com/pp-techs/pp-agent/blob/main/docs/architecture/data-storage.md).
:::

Liên quan: [An toàn và riêng tư](/vi/docs/security-and-privacy/),
[Cài đặt](/vi/docs/install/).
