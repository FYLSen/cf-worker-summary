# Article Summarizer Cloudflare Worker

This Cloudflare Worker provides an API endpoint for summarizing web articles using various AI providers. It supports OpenAI, Anthropic, Google’s Gemini, and Cloudflare‘s AI services. The worker can generate summaries in multiple languages and includes features like caching and rate limiting.

## Features

- Summarizes web articles from allowed domains
- Supports multiple AI providers (OpenAI, Anthropic, Gemini, Cloudflare AI)
- Generates summaries in multiple languages (easily extendable)
- Caches summaries to reduce API calls and improve response times
- Implements rate limiting to prevent abuse
- Configurable via environment variables

## Setup

1. Clone this repository or copy the worker script to your Cloudflare Workers project.
2. Set up the required environment variables (see below).
3. Configure the necessary Cloudflare Worker bindings (see below).
4. Deploy the worker to your Cloudflare account.

## Environment Variables

The following environment variables need to be set:

- `AI_PROVIDER`: The AI service provider to use (openai, anthropic, gemini, or cloudflare)
- `AI_MODEL`: The specific AI model to use (e.g., gpt-3.5-turbo for OpenAI)
- `AI_API_KEY`: Your API key for the chosen AI provider
- `AI_ENDPOINT`: (Optional) Custom endpoint URL for the AI API
- `ALLOWED_DOMAINS`: Comma-separated list of allowed domains for article URLs
- `CACHE_TTL`: Cache time-to-live in seconds (e.g., 604800 for 7 days)
- `MAX_CONTENT_LENGTH`: Maximum allowed length of article content to process
- `RATE_LIMIT`: Maximum number of requests allowed per hour per IP
- `SUMMARY_MIN_LENGTH`: Minimum length of generated summaries

## Cloudflare Worker Bindings

This Worker requires specific Cloudflare Worker bindings to function correctly:

### KV Binding

Used for storing rate limit information.

1. Create a new KV namespace in the Cloudflare Workers console.
2. In your Worker’s settings, add a KV Namespace binding.
3. Name the binding `KV`.

### D1 Database Binding

Used for caching generated summaries.

1. Create a new D1 database in the Cloudflare D1 console.
2. Create the required table using the following SQL statement:
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
3. In your Worker‘s settings, add a D1 Database binding.
4. Name the binding `DB`.

### AI Worker Binding (Optional, for Cloudflare AI only)

If you plan to use Cloudflare AI, you need to set up an AI Worker binding.

1. Ensure that AI capabilities are enabled for your Cloudflare account.
2. In your Worker’s settings, add an AI binding.
3. Name the binding `AI`.

## Deployment

After setting up all necessary environment variables and bindings, you can deploy your Worker:

1. Using the Wrangler CLI:
   ```
   wrangler deploy
   ```
2. Or by uploading your Worker code through the Cloudflare console.

Ensure you have correctly configured all necessary bindings and environment variables before deployment.

## Usage

To use the API, send a GET request to the worker‘s URL with the following query parameters:

- `url`: The URL of the article to summarize
- `lang`: (Optional) The language for the summary. 

Example:
```
https://your-worker-url.workers.dev/summary?url=https://example.com/article&lang=en
```

The API will return a JSON response with the following structure:

```json
{
  ”summary“: ”The generated summary of the article“,
  ”model“: ”The AI model used for summarization“
}
```

## Multi-language Support

The worker currently supports generating summaries in English (en) and Chinese (zh). You can easily extend this to support more languages by modifying the `translateSummary` method in the `AIService` class.

## Error Handling

The API will return appropriate error messages and status codes for various error conditions, such as:

- Invalid or missing article URL
- Article from a non-allowed domain
- Rate limit exceeded
- Content too long
- AI API errors

## Caching

Summaries are cached to improve performance and reduce API calls. The cache duration is controlled by the `CACHE_TTL` environment variable. Summaries are cached separately for each language.

## Rate Limiting

To prevent abuse, the API implements rate limiting based on the client’s IP address. The maximum number of requests per hour is controlled by the `RATE_LIMIT` environment variable.

## AI Providers

The worker supports multiple AI providers. The behavior for each provider is as follows:

- OpenAI: Uses the chat completions API
- Anthropic: Uses the messages API
- Gemini: Uses the generateContent API
- Cloudflare AI: Uses the Cloudflare AI runtime

## Security Considerations

- Ensure that the `ALLOWED_DOMAINS` environment variable is properly set to prevent summarization of unauthorized websites.
- Keep your AI API keys secure and do not expose them in the code or public repositories.
- The worker implements CORS headers. Adjust these if you need to restrict access to specific origins.

## Limitations

- The worker can only summarize articles from the allowed domains specified in the `ALLOWED_DOMAINS` environment variable.
- The maximum content length that can be processed is limited by the `MAX_CONTENT_LENGTH` environment variable.
- The quality and accuracy of summaries depend on the chosen AI provider and model.

## Contributing

Contributions to improve the worker are welcome. Please submit issues and pull requests on the project‘s repository.

## License

This project is licensed under the GNU Affero General Public License v3.0. You may use, modify, and distribute this software under the terms of the AGPLv3. 

The full text of the license can be found in the `LICENSE` file or at the following link:
[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

### Key License Terms
1. You have the freedom to run, study, and modify the program.
2. You can redistribute copies of the original or modified versions of the program, provided you comply with the same license.
3. If you use or modify this software to offer it as a service over a network, the complete source code of your modifications must be made available to the recipients.

For more information on your rights and obligations, please refer to the full AGPLv3 license text.