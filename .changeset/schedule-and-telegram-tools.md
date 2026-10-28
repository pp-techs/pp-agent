---
"@workspace/desktop": minor
---

The agent now uses "Scheduled tasks" (`schedule_manage`) to create one-shot reminders and recurring jobs, list or update tasks, pause/resume them, run them now, and remove them. It accepts conversation targets and result-delivery destinations, including the paired Telegram owner or an explicitly configured chat. Schedule approvals disclose the action, time, target, delivery, and run controls. Scheduled runs cannot create further tasks; their result delivery is handled by the host, not a separate Telegram notification tool. "See other conversations" lets the agent inspect saved sessions, with member chats restricted to their own conversation.

Schedules now has its own navigation item beside Settings in the sidebar footer, opening a dedicated management page in the main panel. Workspace sessions use the full sidebar content area again, with no inline schedules or fixed height split. The Workspace management icon matches the muted group label color.

Fix one-shot editing and re-arming, preserve delivery options and outcomes, and keep Telegram chat access settings and session history across restarts. Telegram chat configuration supports adding the first private/group ID and clearing saved fields. Session commands now dispatch correctly; busy steering falls back to the queue when it cannot accept the input. Delivery honors the selected configured chat and preserves concurrent delivery-ledger updates.
