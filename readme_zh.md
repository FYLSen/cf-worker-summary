# AI 网页文章摘要 Cloudflare Worker

这个 Cloudflare Worker 提供了一个 API 端点，用于使用各种 AI 提供商来summarize网络文章。它支持 OpenAI、Anthropic 和 Cloudflare 的 AI 服务。该 worker 可以生成多语言摘要，并包括缓存和速率限制等功能。

## 功能

- 摘要化来自允许域名的网络文章
- 支持多个 AI 提供商（OpenAI、Anthropic、Cloudflare AI）
- 生成多语言摘要
- 缓存摘要以减少 API 调用并提高响应时间
- 实现速率限制以防止滥用
- 通过环境变量进行配置
- 支持长文章的多部分摘要生成

## 设置

1. 克隆此仓库或将 worker 脚本复制到您的 Cloudflare Workers 项目中。
2. 设置所需的环境变量（见下文）。
3. 配置必要的 Cloudflare Worker 绑定（见下文）。
4. 将 worker 部署到您的 Cloudflare 账户。

## 环境变量

需要设置以下环境变量：

- `AI_PROVIDER`：要使用的 AI 服务提供商（openai、anthropic 或 cloudflare）
- `AI_MODEL`：要使用的特定 AI 模型（例如，OpenAI 的 gpt-3.5-turbo）
- `AI_API_KEY`：您选择的 AI 提供商的 API 密钥
- `AI_ENDPOINT`：（可选）AI API 的自定义端点 URL
- `ALLOWED_DOMAINS`：允许的文章 URL 域名列表，用逗号分隔
- `CACHE_TTL`：缓存生存时间（以秒为单位，例如 604800 表示 7 天）
- `MAX_CONTENT_LENGTH`：允许处理的文章内容的最大长度
- `SUMMARY_MIN_LENGTH`：生成摘要的最小长度
- `RATE_LIMIT`：（可选）每小时每 IP 允许的最大请求数
- `PART_SIZE`：（可选）长文章内容部分的大小（默认：5000）
- `OVERLAP_SIZE`：（可选）内容部分之间的重叠大小（默认：200）
- `PROMPT_TEMPLATE`：（可选）AI 请求的自定义提示模板
- `PART_SUMMARY_PROMPT`：（可选）用于总结长文章各部分的自定义提示
- `COMBINE_SUMMARIES_PROMPT`：（可选）用于合并多个摘要的自定义提示
- `JINA_READER_URL`：（可选）Jina 阅读器服务的 URL（默认：https://r.jina.ai）

### PROMPT_TEMPLATE

`PROMPT_TEMPLATE` 环境变量允许您自定义发送给 AI 服务的初始提示。如果未设置，将使用默认模板。模板应包括指示 AI 充当精通多种语言的语言专家，擅长阅读和总结内容的说明。

模板中需要包含的关键点：

- 总结可能包含 HTML 标签的文章的说明
- 内容要求、表达风格和格式的规则
- 字数要求（使用 `${SUMMARY_MIN_LENGTH}` 占位符）
- 处理多个观点、时效性内容以及区分事实和观点的特殊考虑

### PART_SUMMARY_PROMPT

`PART_SUMMARY_PROMPT` 环境变量允许您自定义用于总结长文章各个部分的提示。如果未设置，将使用默认模板。

### COMBINE_SUMMARIES_PROMPT

`COMBINE_SUMMARIES_PROMPT` 环境变量允许您自定义用于合并长文章多个摘要的提示。如果未设置，将使用默认模板。

注意：这些提示模板无法在运行时动态修改。它们必须在部署 worker 之前设置为环境变量。

## Cloudflare Worker 绑定

这个 Worker 需要特定的 Cloudflare Worker 绑定才能正常运行：

### KV 绑定

用于存储速率限制信息。

1. 在 Cloudflare Workers 控制台中创建一个新的 KV 命名空间。
2. 在您的 Worker 设置中，添加一个 KV 命名空间绑定。
3. 将绑定命名为 `KV`。

### D1 数据库绑定

用于缓存生成的摘要。

1. 在 Cloudflare D1 控制台中创建一个新的 D1 数据库。
2. 使用以下 SQL 语句创建所需的表：

   ```sql
   CREATE TABLE IF NOT EXISTS summaries (
     article_url TEXT NOT NULL,
     summary TEXT NOT NULL,
     model TEXT NOT NULL,
     language TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (article_url, language)
   );

   CREATE TABLE IF NOT EXISTS languages (
     language_code TEXT PRIMARY KEY,
     language_name TEXT NOT NULL,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```

3. 在您的 Worker 设置中，添加一个 D1 数据库绑定。
4. 将绑定命名为 `DB`。

### AI Worker 绑定（必须，仅适用于 Cloudflare AI）

您需要设置一个 AI Worker 绑定。

1. 确保您的 Cloudflare 账户已启用 AI 功能。
2. 在您的 Worker 设置中，添加一个 AI 绑定。
3. 将绑定命名为 `AI`。

## 部署

设置好所有必要的环境变量和绑定后，您可以部署您的 Worker：

1. 使用 Wrangler CLI：
   ```
   wrangler deploy
   ```
2. 或通过 Cloudflare 控制台上传您的 Worker 代码。

在部署之前，请确保您已正确配置了所有必要的绑定和环境变量。

## 使用方法

要使用 API，请向 worker 的 URL 发送 GET 请求，并包含以下查询参数：

- `url`：要摘要的文章 URL
- `lang`：（可选）摘要的语言。如果未提供，将根据 Accept-Language 头部确定，或默认为英语。

示例：

```
https://your-worker-url.workers.dev/summary?url=https://example.com/article&lang=zh
```

API 将返回一个 JSON 响应，结构如下：

```json
{
  "summary": "生成的文章摘要",
  "model": "用于摘要的 AI 模型"
}
```

## 多语言支持

worker 支持生成多种语言的摘要。它会根据用户的请求或 Accept-Language 头部自动选择语言。如果请求的语言与英语不同，worker 将使用 AI 服务将摘要翻译成请求的语言。

## 错误处理

API 将针对各种错误情况返回适当的错误消息和状态码，例如：

- 无效或缺失的文章 URL
- 来自非允许域名的文章
- 超过速率限制
- 内容过长
- AI API 错误

## 缓存

摘要会被缓存以提高性能并减少 API 调用。缓存持续时间由 `CACHE_TTL` 环境变量控制。每种语言的摘要会单独缓存。

## 速率限制

为防止滥用，API 根据客户端的 IP 地址实施速率限制。每小时最大请求数由 `RATE_LIMIT` 环境变量控制。

## AI 提供商

worker 支持多个 AI 提供商：

- OpenAI
- Anthropic
- Cloudflare AI

## 长文章处理

对于超过 `MAX_CONTENT_LENGTH` 的文章，worker 会将内容分成多个部分进行处理。它为每个部分生成摘要，然后将这些摘要组合成最终摘要。

## 内容获取

worker 尝试使用阅读器服务（默认：https://r.jina.ai）获取文章内容。如果失败，它会退回到直接获取 HTML 并提取内容。

## 安全考虑

- 确保正确设置 `ALLOWED_DOMAINS` 环境变量，以防止summarize未授权的网站。
- 保护您的 AI API 密钥安全，不要在代码或公共仓库中暴露它们。
- worker 实现了 CORS 头部。如果需要限制对特定来源的访问，请调整这些设置。

## 限制

- worker 只能summarize `ALLOWED_DOMAINS` 环境变量中指定的允许域名的文章。
- 可以处理的最大内容长度受 `MAX_CONTENT_LENGTH` 环境变量限制。
- 摘要的质量和准确性取决于所选择的 AI 提供商和模型。
- 所有提示模板无法在运行时动态修改。它们必须在部署 worker 之前设置为环境变量。

## 贡献

欢迎对改进 worker 的贡献。请在项目的仓库中提交问题和拉取请求。

## 许可协议

本项目根据 GNU Affero 通用公共许可证 v3.0（AGPLv3）授权。您可以根据 AGPLv3 的条款使用、修改和分发此软件。

完整的许可证文本可以在 `LICENSE` 文件中找到，或在以下链接查看：
[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

### 主要许可条款

1. 您有运行、研究和修改程序的自由。
2. 您可以重新分发原始或修改版本的程序副本，前提是您遵守相同的许可证。
3. 如果您修改此软件以通过网络提供服务，您必须向服务接收者提供您修改的完整源代码。

有关您的权利和义务的更多信息，请参阅完整的 AGPLv3 许可证文本。
