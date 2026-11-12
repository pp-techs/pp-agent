# Provider logos

Brand logos shown on the Models cards, taken unmodified from [theSVG](https://thesvg.org)
(`https://thesvg.org/icons/<slug>/<variant>.svg`). Logos that are white in the default variant
(Anthropic, OpenAI, OpenRouter, Qwen, Vercel, GitHub Copilot, NVIDIA, Together AI) use the `light`
variant, so they read on the white tile; `xiaomi.svg` is `xiaomi-mimo`, `google.svg` is
`google-gemini`, `google-vertex.svg` is `vertexai-google`, `amazon-bedrock.svg` is
`aws-amazon-bedrock`, `azure.svg` is `microsoft-azure`.
The library is MIT-licensed; each logo remains the trademark of its owner and is used here only to
identify the provider a card connects to. They are bundled because the renderer's CSP
(`img-src 'self' data: blob:`) blocks remote images.
