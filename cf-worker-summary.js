const CONFIG = {
  DEFAULT_READER_URL: 'https://r.jina.ai',
  DEFAULT_CLOUDFLARE_AI: '@cf/meta/llama-2-7b-chat-fp16',
  HOUR_IN_MS: 3600000,
  CACHE_HEADERS: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  },
}

export default {
  async fetch(request, env, ctx) {
    const handler = new RequestHandler(request, env, ctx)
    return handler.handle()
  },
}

class RequestHandler {
  constructor(request, env, ctx) {
    this.request = request
    this.env = env
    this.ctx = ctx
  }

  async handle() {
    try {
      if (this.request.method === 'OPTIONS') {
        return new Response(null, { headers: CONFIG.CACHE_HEADERS })
      }

      const { pathname, searchParams } = new URL(this.request.url)
      if (pathname !== '/summary' || this.request.method !== 'GET') {
        return this.errorResponse('Not found', 404)
      }

      const articleUrl = searchParams.get('url')
      if (!articleUrl) {
        return this.errorResponse('Article URL is required', 400)
      }

      const langCode = this.determineLanguage(searchParams)
      await this.validateRequest(articleUrl)

      return await this.processRequest(articleUrl, langCode)
    } catch (error) {
      console.error('Request handling error:', error)
      return this.errorResponse(error.message, 500)
    }
  }

  determineLanguage(searchParams) {
    return (
      searchParams.get('lang') ||
      LanguageHelper.getPreferredLanguage(this.request.headers.get('Accept-Language')) ||
      'en'
    )
  }

  async validateRequest(articleUrl) {
    await EnvValidator.validate(this.env)
    if (this.env.RATE_LIMIT) {
        await RateLimiter.check(
        this.env.KV,
        this.request.headers.get('CF-Connecting-IP'),
        this.env.RATE_LIMIT,
        )
    }
    await DomainValidator.validate(articleUrl, this.env.ALLOWED_DOMAINS)
  }

  async processRequest(articleUrl, langCode) {
    const cache = new CacheManager(this.env.DB)
    await cache.initialize()

    const cachedResult = await cache.get(articleUrl, langCode)
    const lockManager = new LockManager(this.env.KV)

    // Case 1: Valid cache exists
    if (cachedResult && !this.shouldUpdateCache(cachedResult.created_at)) {
      return this.successResponse(cachedResult)
    }

    // Case 2: Cache needs update or doesn't exist
    const cacheKey = `${articleUrl}:${langCode}`
    const isLocked = await lockManager.isLocked(cacheKey)

    // If cache exists but needs update, return stale data first
    if (cachedResult) {
      // If another process is already updating, just return cached result
      if (isLocked) {
        return this.successResponse(cachedResult)
      }

      // Try to acquire lock and update in background
      if (await lockManager.acquireLock(cacheKey)) {
        this.ctx.waitUntil(this.updateCacheWithLock(articleUrl, langCode, lockManager, cacheKey))
        return this.successResponse(cachedResult)
      } else {
        // If failed to acquire lock, another process just got it
        return this.successResponse(cachedResult)
      }
    }

    // Case 3: No cache exists
    if (isLocked) {
      // Use exponential backoff to wait for the lock to be released
      const lockReleased = await this.waitForLockReleaseWithBackoff(cacheKey, lockManager)
      if (!lockReleased) {
        return this.errorResponse('Summary generation in progress, please try again later', 503)
      }
    }

    // Try to acquire lock and generate new summary
    if (await lockManager.acquireLock(cacheKey)) {
      try {
        const result = await this.generateNewSummary(articleUrl, langCode)
        await cache.set(articleUrl, result.summary, result.model, langCode)
        await lockManager.releaseLock(cacheKey)
        return this.successResponse(result)
      } catch (error) {
        await lockManager.releaseLock(cacheKey)
        throw error
      }
    } else {
      return this.errorResponse('Summary generation in progress, please try again later', 503)
    }
  }

  // Exponential backoff to wait for the lock to be released
  async waitForLockReleaseWithBackoff(
    cacheKey,
    lockManager,
    maxRetries = 5,
    initialDelay = 100,
    maxDelay = 5000,
  ) {
    let attempt = 0
    let delay = initialDelay

    while (attempt < maxRetries) {
      const isLocked = await lockManager.isLocked(cacheKey)

      if (!isLocked) {
        // The lock has been released, we can proceed
        return true
      }

      // Wait for the current delay duration, then check the lock status again
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Exponentially increase the delay time until the max delay limit is reached
      delay = Math.min(delay * 2, maxDelay)
      attempt += 1
    }

    // If the max retries are reached and the lock is still held, return false
    return false
  }

  async updateCacheWithLock(articleUrl, langCode, lockManager, cacheKey) {
    try {
      const result = await this.generateNewSummary(articleUrl, langCode)
      await new CacheManager(this.env.DB).set(articleUrl, result.summary, result.model, langCode)
    } catch (error) {
      console.error('Cache update error:', error)
    } finally {
      await lockManager.releaseLock(cacheKey)
    }
  }

  shouldUpdateCache(createdAt) {
    return Date.now() - createdAt >= this.env.CACHE_TTL * 1000
  }

  async updateCache(articleUrl, langCode) {
    try {
      const result = await this.generateNewSummary(articleUrl, langCode)
      await new CacheManager(this.env.DB).set(articleUrl, result.summary, result.model, langCode)
    } catch (error) {
      console.error('Cache update error:', error)
    }
  }

  async generateNewSummary(articleUrl, langCode) {
    const content = await ContentFetcher.fetch(articleUrl, this.env.JINA_READER_URL)
    const languageDetector = new LanguageDetector(this.env)
    await languageDetector.initDatabase()
    const languageResult = await languageDetector.getLanguageFromDB(langCode)
    const language =
      languageResult.language_name ||
      (await languageDetector.detectLanguageWithAI(langCode)) ||
      langCode

    if (!languageResult && language !== langCode) {
      this.ctx.waitUntil(languageDetector.saveLanguageToDB(langCode, language))
    }
    const aiService = new AIService(this.env, language)
    return await aiService.generateSummary(content)
  }

  successResponse(data) {
    return new Response(
      JSON.stringify({
        summary: data.summary,
        model: data.model,
      }),
      { headers: CONFIG.CACHE_HEADERS },
    )
  }

  errorResponse(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: CONFIG.CACHE_HEADERS,
    })
  }
}

class LockManager {
  constructor(kv) {
    this.kv = kv
    this.LOCK_TTL = 300 // 5 minutes in seconds
  }

  async acquireLock(key) {
    const lockKey = `lock:${key}`
    const success = await this.kv.put(lockKey, Date.now().toString(), {
      expiration: Math.floor(Date.now() / 1000) + this.LOCK_TTL,
      metadata: { owner: crypto.randomUUID() },
      hasOwnProperty: false,
    })
    return success !== null
  }

  async releaseLock(key) {
    const lockKey = `lock:${key}`
    await this.kv.delete(lockKey)
  }

  async isLocked(key) {
    const lockKey = `lock:${key}`
    const lock = await this.kv.get(lockKey)
    return lock !== null
  }
}
class LanguageHelper {
  static getPreferredLanguage(acceptLanguageHeader) {
    if (!acceptLanguageHeader) return null

    return (
      acceptLanguageHeader
        .split(',')
        .map((lang) => {
          const [code, qValue] = lang.trim().split(';q=')
          return {
            code: this.normalizeLanguageCode(code.split('-')[0].toLowerCase()),
            q: qValue ? parseFloat(qValue) : 1.0,
          }
        })
        .sort((a, b) => b.q - a.q)[0]?.code || null
    )
  }

  static normalizeLanguageCode(langCode) {
    return langCode === 'zh' ? 'zh-CN' : langCode
  }
}

class LanguageDetector {
  constructor(env) {
    this.env = env
  }

  async initDatabase() {
    const query = `
          CREATE TABLE IF NOT EXISTS languages (
            language_code TEXT PRIMARY KEY,
            language_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `
    await this.env.DB.prepare(query).run()
  }

  async getLanguageFromDB(langCode) {
    const query = `
          SELECT language_name 
          FROM languages 
          WHERE language_code = ?
        `
    return await this.env.DB.prepare(query).bind(langCode).first()
  }

  async saveLanguageToDB(langCode, languageName) {
    const query = `INSERT INTO languages (language_code, language_name) VALUES (?, ?)`
    await this.env.DB.prepare(query).bind(langCode, languageName).run()
  }

  async detectLanguageWithAI(langCode) {
    const prompt = `Your task is to identify and return the language name in English for the given language code: "${langCode}".
    
Rules:
- Return the language name in English (e.g., "English (United States)", "Chinese (Simplified, China)", "Japanese").
- Do not include any additional text or explanation.
- Use widely accepted standard language names.
- If the code is invalid or unknown, return "Unknown".
    
Example responses:
- For "en": English
- For "en-US": English (United States)
- For "zh": Chinese
- For "zh-CN": Chinese (Simplified, China)
- For "ja": Japanese`
    const response = await this.env.AI.run(CONFIG.DEFAULT_CLOUDFLARE_AI, {
      prompt,
      max_tokens: 1024,
    })
    return response.result
  }
}

class EnvValidator {
  static async validate(env) {
    const required = [ 'AI_PROVIDER', 'ALLOWED_DOMAINS', 'AI_MODEL', 'AI_API_KEY', 'CACHE_TTL', 'MAX_CONTENT_LENGTH', 'SUMMARY_MIN_LENGTH', 'AI', 'DB', 'KV', ]

    const missing = required.filter((key) => !env[key])
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }
  }
}

class RateLimiter {
  static async check(kv, clientIP, rateLimit) {
    const hour = Math.floor(Date.now() / CONFIG.HOUR_IN_MS)
    const key = `ratelimit:${clientIP}:${hour}`

    const count = parseInt((await kv.get(key)) || '0')
    if (count >= rateLimit) {
      throw new Error('Rate limit exceeded')
    }

    await kv.put(key, (count + 1).toString(), { expirationTtl: 3600 })
  }
}

class DomainValidator {
  static validate(url, allowedDomains) {
    try {
      const { hostname } = new URL(url)
      const allowedList = allowedDomains.split(',').map((d) => d.trim())

      const isAllowed = allowedList.some((allowed) =>
        allowed.startsWith('*.')
          ? hostname === allowed.slice(2) || hostname.endsWith('.' + allowed.slice(2))
          : hostname === allowed,
      )

      if (!isAllowed) {
        throw new Error('Domain not allowed')
      }
    } catch (error) {
      throw new Error('Invalid URL or domain not allowed')
    }
  }
}

class CacheManager {
  constructor(db) {
    this.db = db
  }

  async initialize() {
    const query = `
      CREATE TABLE IF NOT EXISTS summaries (
        article_url TEXT NOT NULL,
        summary TEXT NOT NULL,
        model TEXT NOT NULL,
        language TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (article_url, language)
      );
    `
    await this.db.prepare(query).run()
  }

  async get(articleUrl, langCode) {
    const query = `
      SELECT summary, model, created_at 
      FROM summaries 
      WHERE article_url = ? AND language = ?
    `
    return await this.db.prepare(query).bind(articleUrl, langCode).first()
  }

  async set(articleUrl, summary, model, langCode) {
    const query = `
      INSERT OR REPLACE INTO summaries 
      (article_url, summary, model, language, created_at) 
      VALUES (?, ?, ?, ?, ?)
    `
    await this.db.prepare(query).bind(articleUrl, summary, model, langCode, Date.now()).run()
  }
}

class ContentFetcher {
  static async fetch(url, readerUrl = CONFIG.DEFAULT_READER_URL) {
    try {
      const readerContent = await this.fetchFromReader(url, readerUrl)
      if (readerContent) return readerContent

      return await this.fetchDirectly(url)
    } catch (error) {
      throw new Error(`Failed to fetch content: ${error.message}`)
    }
  }

  static async fetchFromReader(url, readerUrl) {
    try {
      const response = await fetch(`${readerUrl}/${url}`)
      return response.ok ? await response.text() : null
    } catch (error) {
      console.error('Reader service error:', error)
      return null
    }
  }

  static async fetchDirectly(url) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`)
    }

    const html = await response.text()
    return this.parseHTML(html)
  }

  static parseHTML(html) {
    const title = html.match(/<title>(.*?)<\/title>/)?.[1]?.trim() || 'No Title Found'
    const content =
      html
        .match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1]
        ?.replace(/<[^>]+>/g, '')
        ?.trim() || 'No Article Content Found'

    return `<h1>${title}</h1><hr>${content}`
  }
}

class AIService {
  constructor(env, language) {
    this.env = env
    this.provider = env.AI_PROVIDER
    this.model = env.AI_MODEL
    this.apiKey = env.AI_API_KEY
    this.apiEndpoint = env.AI_ENDPOINT || this.getDefaultEndpoint()
    this.maxContentLength = env.MAX_CONTENT_LENGTH || 10000
    this.partSize = env.PART_SIZE || 5000
    this.overlapSize = env.OVERLAP_SIZE || 200
    this.language = language
    this.promptTemplate = env.PROMPT_TEMPLATE || this.getDefaultPromptTemplate()
    this.partSummaryPrompt = env.PART_SUMMARY_PROMPT || this.getDefaultPartSummaryPrompt()
    this.combineSummariesPrompt =
      env.COMBINE_SUMMARIES_PROMPT || this.getDefaultCombineSummariesPrompt()
  }

  getDefaultEndpoint() {
    switch (this.provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions'
      case 'anthropic':
        return 'https://api.anthropic.com/v1/messages'
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
      default:
        throw new Error(`No default endpoint for provider: ${this.provider}`)
    }
  }

  getDefaultPromptTemplate() {
    return `You are tasked with generating a concise summary of the provided content. 

IMPORTANT: Your output must ONLY contain the summary text itself - no additional formatting or explanations. Prioritize essential information while meeting length requirements.

The summary MUST be:

1. LANGUAGE & FORMAT
- Written exclusively in ${this.language}
- Keep technical terms, product names, and proper nouns in their original language
- Delivered in plain text format (no markdown/HTML)
- Limited to 2-3 paragraphs
- Minimum length: ${this.env.SUMMARY_MIN_LENGTH} words
- Focus on conciseness while meeting minimum length

2. STRUCTURAL UNDERSTANDING
- Utilize document structure to identify key topics
- Extract main points from structured elements
- Respect the original content hierarchy

3. CONTENT REQUIREMENTS
- Maintain factual accuracy and original context
- Include critical data points and statistics
- Present information objectively`
  }

  getDefaultPartSummaryPrompt() {
    return `You are tasked with summarizing a segment of a larger article. 

IMPORTANT: Your output must ONLY contain the summary text itself - no additional formatting or explanations. Prioritize essential information while meeting length requirements.

The summary MUST be:

1. LANGUAGE & FORMAT
- Written in ${this.language}
- Keep technical terms, product names, and proper nouns in their original language
- Delivered as plain text only
- Length: 100-300 words per segment

2. SEGMENT CONTEXT
- Mark incomplete concepts with [...] at start/end
- Track ongoing themes and arguments
- Note connections to other sections

3. CONTENT FOCUS
- Extract main ideas and essential details
- Preserve critical data and quotes
- Note context-dependent information`
  }

  getDefaultCombineSummariesPrompt() {
    return `You are tasked with creating a unified summary from multiple segment summaries. 

IMPORTANT: Your output must ONLY contain the summary text itself - no additional formatting or explanations. Prioritize essential information while meeting length requirements.

The summary MUST be:

1. LANGUAGE & FORMAT
- Written in ${this.language}
- Keep technical terms, product names, and proper nouns in their original language
- Delivered as plain text only
- Limited to 2-3 paragraphs
- Minimum length: ${this.env.SUMMARY_MIN_LENGTH} words
- Strive for conciseness while ensuring comprehensiveness

2. SYNTHESIS REQUIREMENTS
- Create logical flow across sections
- Remove redundant information
- Connect related themes and ideas
- Ensure balanced coverage of all sections

3. CONTENT INTEGRATION
- Highlight overarching themes
- Resolve any cross-references
- Combine related statistics
- Maintain consistent terminology`
  }

  async generateSummary(content) {
    const summary =
      content.length <= this.maxContentLength
        ? await this.generateSingleSummary(content)
        : await this.generateMultiPartSummary(content)

    return { summary, model: this.model }
  }

  async generateSingleSummary(content) {
    const messages = this.createMessages(content)
    return await this.callExternalAPI(messages)
  }

  async generateMultiPartSummary(content) {
    const parts = this.splitContent(content)
    const partSummaries = await Promise.all(parts.map((part) => this.generatePartSummary(part)))
    return await this.combineSummaries(partSummaries)
  }

  createMessages(content) {
    return [
      { role: 'system', content: this.promptTemplate },
      { role: 'user', content: content },
    ]
  }

  splitContent(content) {
    const parts = []
    let start = 0

    while (start < content.length) {
      const end = Math.min(start + this.partSize, content.length)
      parts.push(content.slice(start, end))
      start = end - this.overlapSize
    }

    return parts
  }

  async generatePartSummary(part) {
    const messages = [
      { role: 'system', content: this.partSummaryPrompt },
      { role: 'user', content: part },
    ]
    return await this.callExternalAPI(messages)
  }

  async combineSummaries(summaries) {
    const messages = [
      { role: 'system', content: this.combineSummariesPrompt },
      { role: 'user', content: summaries },
    ]
    return await this.callExternalAPI(messages)
  }

  async callExternalAPI(messages) {
    const apiConfigs = {
      openai: {
        body: {
          model: this.model,
          messages,
          max_tokens: 1024,
        },
        headers: {},
      },
      anthropic: {
        body: {
          model: this.model,
          messages,
          max_tokens: 1024,
        },
        headers: { 'anthropic-version': '2023-06-01' },
      },
      gemini: {
        body: {
          contents: messages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }],
          })),
          generationConfig: { maxOutputTokens: 1024 },
        },
        headers: {},
      },
    }

    const config = apiConfigs[this.provider]
    if (!config) {
      if (this.provider === 'cloudflare') {
        return this.getCloudflareAISummary(messages)
      }
      throw new Error(`Unsupported AI provider: ${this.provider}`)
    }

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...config.headers,
      },
      body: JSON.stringify(config.body),
    })

    if (!response.ok) {
      throw new Error(
        `API error: ${response.status} ${response.statusText}\n${await response.text()}`,
      )
    }

    return this.extractSummaryFromResponse(await response.json())
  }

  extractSummaryFromResponse(data) {
    const extractors = {
      openai: (data) => data.choices[0].message.content,
      anthropic: (data) => data.content[0].text,
      gemini: (data) => data.candidates[0].content.parts[0].text,
    }

    const extractor = extractors[this.provider]
    if (!extractor) {
      throw new Error(`Unsupported AI provider: ${this.provider}`)
    }

    return extractor(data)
  }

  async getCloudflareAISummary(messages) {
    if (!this.env.AI) {
      throw new Error('Cloudflare AI binding is not available')
    }

    const response = await this.env.AI.run(this.model, {
      messages,
      max_tokens: 1024,
    })

    return response.response
  }
}
