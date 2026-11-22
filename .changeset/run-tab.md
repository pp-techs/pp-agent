---
"@workspace/desktop": minor
"@workspace/web": minor
"@workspace/shared": patch
"@workspace/agent-core": patch
---

New Run tab in the main area: follow what the agent does while it works. The workflow view shows each model step and the tool calls it asked for, in order, with the helpers of `delegate_task` in parallel lanes, the work going on animated and the view following it; a timeline shows who worked when. Click any step for its status, timing, tokens, arguments and result. The last 20 runs of each conversation stay viewable while the app is open.
