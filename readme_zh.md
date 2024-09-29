# 文章摘要 Cloudflare Worker

这个 Cloudflare Worker 提供了一个 API 端点，用于使用各种 AI 提供商对网络文章进行摘要。它支持 OpenAI、Anthropic、Google 的 Gemini 和 Cloudflare 的 AI 服务。该 Worker 可以生成多种语言的摘要，并包含缓存和速率限制等功能。

## 特性

- 对允许域名的网络文章进行摘要
- 支持多个 AI 提供商（OpenAI、Anthropic、Gemini、Cloudflare AI）
- 生成多语言摘要（易于扩展）
- 缓存摘要以减少 API 调用并提高响应时间
- 实现速率限制以防止滥用
- 通过环境变量进行配置

## 设置

1. 克隆此仓库或将 Worker 脚本复制到你的 Cloudflare Workers 项目中。
2. 设置所需的环境变量（见下文）。
3. 配置必要的 Cloudflare Worker 绑定（见下文）。
4. 将 Worker 部署到你的 Cloudflare 账户。

## 环境变量

需要设置以下环境变量：

- `AI_PROVIDER`：要使用的 AI 服务提供商（openai、anthropic、gemini 或 cloudflare）
- `AI_MODEL`：要使用的特定 AI 模型（例如，OpenAI 的 gpt-3.5-turbo）
- `AI_API_KEY`：所选 AI 提供商的 API 密钥
- `AI_ENDPOINT`：（可选）AI API 的自定义端点 URL
- `ALLOWED_DOMAINS`：允许的文章 URL 域名列表，以逗号分隔
- `CACHE_TTL`：缓存生存时间（以秒为单位，例如 604800 表示 7 天）
- `MAX_CONTENT_LENGTH`：允许处理的文章内容最大长度
- `RATE_LIMIT`：每小时每个 IP 允许的最大请求数
- `SUMMARY_MIN_LENGTH`：生成摘要的最小长度

## Cloudflare Worker 绑定

这个Worker需要特定的Cloudflare Worker绑定才能正常运行：

### KV 绑定

用于存储速率限制信息。

1. 在Cloudflare Workers控制台中创建一个新的KV命名空间。
2. 在你的Worker的设置中，添加一个KV命名空间绑定。
3. 将绑定命名为 `KV`。

### D1 数据库绑定

用于缓存生成的摘要。

1. 在Cloudflare D1控制台中创建一个新的D1数据库。
2. 使用以下SQL语句创建所需的表：
   ```sql
   CREATE TABLE IF NOT EXISTS summaries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     article_url TEXT NOT NULL,
     summary TEXT NOT NULL,
     model TEXT NOT NULL,
     language TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE(article_url, language)
   );
   ```
3. 在你的Worker的设置中，添加一个D1数据库绑定。
4. 将绑定命名为 `DB`。

### AI Worker 绑定（可选，仅用于Cloudflare AI）

如果你计划使用Cloudflare AI，你需要设置AI Worker绑定。

1. 确保你的Cloudflare账户已启用AI功能。
2. 在你的Worker的设置中，添加一个AI绑定。
3. 将绑定命名为 `AI`。

## 部署

在设置完所有必要的环境变量和绑定后，你可以部署你的Worker：

1. 使用Wrangler CLI：
   ```
   wrangler deploy
   ```
2. 或者通过Cloudflare控制台上传你的Worker代码。

确保在部署之前，你已经正确配置了所有必要的绑定和环境变量。

## 使用方法

要使用 API，请向 Worker 的 URL 发送 GET 请求，包含以下查询参数：

- `url`：要摘要的文章 URL
- `lang`：（可选）摘要的语言。

示例：
```
https://your-worker-url.workers.dev/summary?url=https://example.com/article&lang=zh
```

API 将返回一个 JSON 响应，结构如下：

```json
{
  ”summary“: ”生成的文章摘要“,
  ”model“: ”用于摘要的 AI 模型“
}
```

## 多语言支持

该 Worker 目前支持生成英语（en）和中文（zh）摘要。你可以通过修改 `AIService` 类中的 `translateSummary` 方法来轻松扩展支持更多语言。

## 错误处理

API 将针对各种错误情况返回适当的错误消息和状态代码，例如：

- 无效或缺失的文章 URL
- 非允许域名的文章
- 超出速率限制
- 内容过长
- AI API 错误

## 缓存

摘要会被缓存以提高性能并减少 API 调用。缓存持续时间由 `CACHE_TTL` 环境变量控制。每种语言的摘要都会单独缓存。

## 速率限制

为防止滥用，API 根据客户端的 IP 地址实施速率限制。每小时最大请求数由 `RATE_LIMIT` 环境变量控制。

## AI 提供商

Worker 支持多个 AI 提供商。每个提供商的行为如下：

- OpenAI：使用聊天完成 API
- Anthropic：使用消息 API
- Gemini：使用生成内容 API
- Cloudflare AI：使用 Cloudflare AI 运行时

## 安全考虑

- 确保正确设置 `ALLOWED_DOMAINS` 环境变量，以防止对未经授权的网站进行摘要。
- 保护你的 AI API 密钥安全，不要在代码或公共仓库中暴露它们。
- Worker 实现了 CORS 头。如果需要限制对特定来源的访问，请调整这些设置。

## 局限性

- Worker 只能对 `ALLOWED_DOMAINS` 环境变量中指定的允许域名的文章进行摘要。
- 可以处理的最大内容长度由 `MAX_CONTENT_LENGTH` 环境变量限制。
- 摘要的质量和准确性取决于所选的 AI 提供商和模型。

## 贡献

欢迎对改进 Worker 的贡献。请在项目的仓库中提交问题和拉取请求。

## 许可协议

此项目基于 GNU Affero 通用公共许可证第3版 (AGPLv3) 授权。您可以根据 AGPLv3 的条款使用、修改和分发本软件。

完整的许可协议文本可以在 `LICENSE` 文件中找到，或者访问以下链接：
[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

### 主要许可条款
1. 您有自由运行、学习和修改该程序的权利。
2. 您可以重新分发该程序的原始版本或修改版本，但需遵守相同的许可协议。
3. 如果您修改或使用本软件通过网络提供服务，您必须向服务的使用者提供所有修改过的源代码。

有关您的权利和义务的更多信息，请参阅 AGPLv3 许可证的完整文本。