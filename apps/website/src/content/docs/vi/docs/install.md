---
title: Cài đặt PP Agent
description: Tải và cài PP Agent trên Mac, Windows hoặc Linux, và biết mình cần chuẩn bị gì trước khi dùng.
---

PP Agent là ứng dụng trên máy tính, dùng cho Mac, Windows và Linux. Bạn tải bộ cài từ
[bản phát hành mới nhất](https://github.com/pp-techs/pp-agent/releases/latest).

## Chọn bản phù hợp

| Máy của bạn             | Tệp cần tải                                     |
| ----------------------- | ----------------------------------------------- |
| Mac chip Apple (M1 trở lên) | `pp-agent-<version>-mac-arm64.dmg`           |
| Mac chip Intel          | `pp-agent-<version>-mac-x64.dmg`                |
| Windows                 | `pp-agent-<version>-win-x64.exe`                |
| Linux                   | `pp-agent-<version>-linux-x86_64.AppImage` hoặc `…-amd64.deb` |

Không chắc máy mình dùng chip nào? Trên Mac, mở **Apple menu › About This Mac**; trên Windows, xem **Settings › System › About**.

## Cài đặt

1. Mở tệp vừa tải.
2. Trên Mac, kéo **PP Agent** vào thư mục **Applications**. Trên Windows và Linux, làm theo hướng dẫn trên màn hình.
3. Mở PP Agent.
4. Làm theo [Lần đầu sử dụng](/vi/docs/first-run/).

Không cần tạo tài khoản PP Agent.

## Nếu máy hiện cảnh báo

Ứng dụng có thể bị Windows SmartScreen hoặc macOS chặn lần đầu vì bản cài chưa được ký trên mọi máy.

- **Windows:** chọn **More info → Run anyway**.
- **macOS:** nếu báo ứng dụng bị hỏng hoặc không mở được, hãy nhờ đội kỹ thuật. Họ có thể chạy lệnh trong [hướng dẫn cài đặt dành cho IT](https://github.com/pp-techs/pp-agent/blob/main/docs/architecture/build-and-packaging.md).

## Cập nhật

PP Agent tự kiểm tra bản mới khi mở. Bạn cũng có thể vào **Cài đặt › Chung › Cập nhật**.

## Gỡ cài đặt

Gỡ ứng dụng như mọi ứng dụng khác. Cuộc trò chuyện và tài liệu của bạn vẫn nằm trên máy; xem
[Dữ liệu trên máy](/vi/docs/data-storage/) nếu muốn xóa hoặc sao lưu.
