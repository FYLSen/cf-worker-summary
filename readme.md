# Article Summarizer Cloudflare Worker

This Cloudflare Worker provides an API endpoint for summarizing web articles using various AI providers. It supports OpenAI, Anthropic, and Cloudflare‘s AI services. The worker can generate summaries in multiple languages and includes features like caching and rate limiting.

## Features

- Summarizes web articles from allowed domains
- Supports multiple AI providers (OpenAI, Anthropic, Cloudflare AI)
- Generates summaries in multiple languages
- Caches summaries to reduce API calls and improve response times
- Implements rate limiting to prevent abuse
- Configurable via environment variables
- Supports multi-part summarization for long articles

## Setup

1. Clone this repository or copy the worker script to your Cloudflare Workers project.
2. Set up the required environment variables (see below).
3. Configure the necessary Cloudflare Worker bindings (see below).
4. Deploy the worker to your Cloudflare account.

## Environment Variables

The following environment variables need to be set:

- `AI_PROVIDER`: The AI service provider to use (openai, anthropic, or cloudflare)
- `AI_MODEL`: The specific AI model to use (e.g., gpt-3.5-turbo for OpenAI)
- `AI_API_KEY`: Your API key for the chosen AI provider
- `AI_ENDPOINT`: (Optional) Custom endpoint URL for the AI API
- `ALLOWED_DOMAINS`: Comma-separated list of allowed domains for article URLs
- `CACHE_TTL`: Cache time-to-live in seconds (e.g., 604800 for 7 days)
- `MAX_CONTENT_LENGTH`: Maximum allowed length of article content to process
- `SUMMARY_MIN_LENGTH`: Minimum length of generated summaries
- `RATE_LIMIT`: (Optional) Maximum number of requests allowed per hour per IP
- `PART_SIZE`: (Optional) Size of content parts for long articles (default: 5000)
- `OVERLAP_SIZE`: (Optional) Overlap size between content parts (default: 200)
- `PROMPT_TEMPLATE`: (Optional) Custom prompt template for AI requests
- `PART_SUMMARY_PROMPT`: (Optional) Custom prompt for summarizing parts of long articles
- `COMBINE_SUMMARIES_PROMPT`: (Optional) Custom prompt for combining multiple summaries
- `JINA_READER_URL`: (Optional) URL for the Jina reader service (default: https://r.jina.ai)

### PROMPT_TEMPLATE

The `PROMPT_TEMPLATE` environment variable allows you to customize the initial prompt sent to the AI service. If not set, a default template is used. The template should include instructions for the AI to act as a language expert proficient in multiple languages, skilled in reading and summarizing content.

Key points to include in the template:

- Instructions for summarizing articles potentially containing HTML tags
- Rules for content requirements, expression style, and format
- Word count requirement (use `${SUMMARY_MIN_LENGTH}` placeholder)
- Special considerations for handling multiple viewpoints, time-sensitive content, and distinguishing between facts and opinions

### PART_SUMMARY_PROMPT

The `PART_SUMMARY_PROMPT` environment variable allows you to customize the prompt used for summarizing individual parts of long articles. If not set, a default template is used.

### COMBINE_SUMMARIES_PROMPT

The `COMBINE_SUMMARIES_PROMPT` environment variable allows you to customize the prompt used for combining multiple summaries of long articles. If not set, a default template is used.

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

3. In your Worker‘s settings, add a D1 Database binding.
4. Name the binding `DB`.

### AI Worker Binding (MUST, for Cloudflare AI)

You need to set up an AI Worker binding.

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
- `lang`: (Optional) The language for the summary. If not provided, it will be determined based on the Accept-Language header or default to English.

Example:

```
https://your-worker-url.workers.dev/summary?url=https://example.com/article&lang=en
```

The API will return a JSON response with the following structure:

```json
{
  "summary": "The generated summary of the article",
  "model": "The AI model used for summarization"
}
```

## Multi-language Support

The worker supports generating summaries in multiple languages. It automatically selects the language based on the user’s request or the Accept-Language header. The worker uses the AI service to translate summaries into the requested language if it‘s different from English.

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

The worker supports multiple AI providers:

- OpenAI
- Anthropic
- Cloudflare AI

## Long Article Handling

For articles exceeding the `MAX_CONTENT_LENGTH`, the worker splits the content into multiple parts for processing. It generates summaries for each part and then combines these summaries into a final summary.

## Content Fetching

The worker attempts to fetch article content using a reader service (default: https://r.jina.ai). If this fails, it falls back to directly fetching the HTML and extracting the content.

## Security Considerations

- Ensure that the `ALLOWED_DOMAINS` environment variable is properly set to prevent summarization of unauthorized websites.
- Keep your AI API keys secure and do not expose them in the code or public repositories.
- The worker implements CORS headers. Adjust these if you need to restrict access to specific origins.

## Limitations

- The worker can only summarize articles from the allowed domains specified in the `ALLOWED_DOMAINS` environment variable.
- The maximum content length that can be processed is limited by the `MAX_CONTENT_LENGTH` environment variable.
- The quality and accuracy of summaries depend on the chosen AI provider and model.
- The prompt templates cannot be modified dynamically during runtime. They must be set as environment variables before deploying the worker.

## Contributing

Contributions to improve the worker are welcome. Please submit issues and pull requests on the project‘s repository.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPLv3). You may use, modify, and distribute this software under the terms of the AGPLv3.

The full text of the license can be found in the `LICENSE` file or at the following link:
[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

### Key License Terms

1. You have the freedom to run, study, and modify the program.
2. You can redistribute copies of the original or modified versions of the program, provided you comply with the same license.
3. If you modify this software to offer it as a service over a network, you must make the complete source code of your modifications available to the recipients of the service.

For more information on your rights and obligations, please refer to the full AGPLv3 license text.
