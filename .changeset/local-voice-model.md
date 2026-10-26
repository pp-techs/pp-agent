---
"@workspace/desktop": minor
---

Voice input now prefers a local model: the microphone button turns speech into text with whisper.cpp on your own computer, with nothing sent anywhere and no key needed. Settings › General › Voice input offers "This computer (whisper.cpp)" by default with a model to download (tiny to medium, 74 MB–1.4 GB); whisper.cpp is found on the PATH (`brew install whisper-cpp`) or bundled with the app. A transcription service with a key is still available as a choice. Recordings are converted to 16 kHz wav in the app, and formats whisper cannot read itself (Telegram voice notes) go through ffmpeg when it is installed. Telegram voice messages use the same setting.
