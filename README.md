# english-speak

给在日本做店员的中国学习者用的英语听说练习 PWA（从 nihongo-speak 改过来）。目标：工作中能开口接待外国客人、日常交流、托业 900。为 iPhone 主屏幕使用设计。

三块：
- **听**：每天的 BBC 新闻（AI 改写成简单英语，6–9 句）和 Easy Talk Radio（Amy 和 Ben 两个主持人聊天的电台，含来信、正题、今天的一句话和洗脑歌）。
- **说**：新闻和电台的**每一句**都能单独练说（看着说 → 只看首字母 → 什么都不看，三遍），AI 听你说的话按意思判对错，给出用你自己说法改好的句子；还有讲三遍（复述）、马上说、打电话（店长、老顾客、朋友、同事）、场景对话。
- **老师**：Moore 老师每晚看你说过的话，安排第二天的练习，改常错的点，复习到期的句子。

## 用到的服务
| 用途 | 服务 | 环境变量 |
|---|---|---|
| 出题、改写新闻、写电台、判对错、老师 | Claude API | `ANTHROPIC_API_KEY`（可选 `ANTHROPIC_WORKSPACE_ID`） |
| 语音识别、发音评估、备用 TTS | Azure Speech（英语，区域随意，例如 `japaneast`） | `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION` |
| HD 语音（可选） | 第二个 Azure Speech 资源（支持 HD 的区域，如 `southeastasia`、`eastus`） | `AZURE_TTS_KEY`、`AZURE_TTS_REGION` |
| 主要 TTS、听写、打电话实时语音、电台配乐、封面 | Gemini / Vertex AI | `VERTEX_SERVICE_ACCOUNT`（服务账号 JSON），或 `GEMINI_API_KEY` |
| 进度同步、新闻和电台存储 | Vercel Blob | 连接 Blob 存储后自动有 `BLOB_STORE_ID`（或 `BLOB_READ_WRITE_TOKEN`） |
| 定时任务（新闻、老师、提醒） | Vercel Cron | `CRON_SECRET` |
| 推送提醒 | Web Push | 可选 `VAPID_SEED`（不填时用 API key 派生） |

## 部署到 Vercel（新开一个项目，不要动日语版）
1. Vercel → Add New → Project，Import 这个仓库。
2. **Storage → 新建一个 Blob 存储连接到这个项目**。一定要新建，不要连日语版的那个：两个 app 的文件名一样（`state.json`、`news/articles.json`），共用会互相覆盖。
3. Settings → Environment Variables 填上表里的变量（可以照抄日语版的 key，Blob 除外）。
4. 部署。第一天的新闻会在定时任务跑的时候生成（日本时间 8:30 和 21:00），也可以带上 `Authorization: Bearer <CRON_SECRET>` 手动访问一次 `/api/cron/news`。
5. 用 iPhone Safari 打开网址，点「分享 → 添加到主屏幕」。图标是蓝色的 E，和日语版的红色区分开。

## 本地开发
```bash
cp .env.example .env.local   # 填好变量
npm install
npm run dev
```

## 结构
- `lib/learner.ts` 学习者画像和水平（A2–B1），所有提示词都引用它；想调难度改这里
- `lib/claude.ts` 所有 Claude 提示词和结构化输出
- `lib/bbc.ts`、`lib/news.ts` 抓 BBC RSS，改写成简单英语
- `lib/radio.ts` Easy Talk Radio 的脚本
- `content/scenarios.ts`、`scenes-work.ts`、`scenes-life.ts` 店里和生活场景；`content/calls.ts` 打电话
- `components/NewsSay.tsx` 一句一句讲三遍（新闻 `/news/<id>/say`、电台 `/ep/<id>/say`），`app/api/say/route.ts` 判对错
- `public/voice/` 固定内容的预录语音，目前是空的；部署后可运行 `npx tsx scripts/bake-voices.ts <网址>` 预录，不录也能用（按需合成）
