# nihongo-speak

自用的日语听说练习 PWA：精听 → 跟读（发音评分）→ AI 场景对话 → 点评。为 iPhone 主屏幕使用设计。

## 用到的服务
| 用途 | 服务 | 环境变量 |
|---|---|---|
| 对话、提示、点评 | Claude API（Sonnet 5.5） | `ANTHROPIC_API_KEY` |
| 语音识别、发音评估、日语 TTS | Azure Speech（免费层 F0，区域 Japan East） | `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION` |
| 登录密码 | — | `APP_PASSWORD` |

## 部署到 Vercel
1. 在 Vercel 用 GitHub 登录，Import 这个仓库（框架会自动识别为 Next.js）。
2. 在 Settings → Environment Variables 填上面 4 个变量。
3. 部署完成后，用 iPhone Safari 打开网址，输入密码，点「分享 → 添加到主屏幕」。

## 本地开发
```bash
cp .env.example .env.local   # 填好变量
npm install
npm run dev
```

## 结构
- `content/scenarios.ts` 场景素材（台词、读音、中文、对话设定）
- `lib/azure.ts` Azure TTS / 语音识别 / 发音评估
- `lib/claude.ts` 角色扮演、提示、点评的提示词和结构化输出
- `lib/client/recorder.ts` 浏览器端录成 16kHz WAV（iPhone 的 MediaRecorder 只能出 mp4）
- `lib/client/player.ts` 共享的 audio 元素（绕过 iOS 自动播放限制）
- `components/` 精听、跟读、对话三个页签
