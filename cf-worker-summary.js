export default {
    async fetch(request, env, ctx) {
        const commonHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };

        try {
            if (request.method === "OPTIONS") {
                return new Response(null, { headers: commonHeaders });
            }

            const { pathname, searchParams } = new URL(request.url);
            
            if (pathname !== "/summary" || request.method !== "GET") {
                return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: commonHeaders });
            }

            const articleUrl = searchParams.get('url');
            const acceptLanguage = request.headers.get('Accept-Language');
            const language = searchParams.get('lang') || getPreferredLanguage(acceptLanguage) || 'en';
            if (!articleUrl) {
                return new Response(JSON.stringify({ error: "Article URL is required" }), { status: 400, headers: commonHeaders });
            }

            await validateEnvironment(env);
            await checkRateLimit(env.KV, request.headers.get('CF-Connecting-IP'), env.RATE_LIMIT);
            await validateAllowedDomain(articleUrl, env.ALLOWED_DOMAINS);

            // Ensure database is initialized
            await initializeDatabase(env.DB);

            const cachedSummary = await getCachedSummary(env.DB, articleUrl, language);
            
            if (cachedSummary) {
                if (Date.now() - cachedSummary.created_at < env.CACHE_TTL * 1000) {
                    return new Response(JSON.stringify({
                        summary: cachedSummary.summary,
                        model: cachedSummary.model
                    }), { headers: commonHeaders });
                }
                
                try {
                    const articleContent = await fetchArticleContent(articleUrl);
                    if (articleContent.length > env.MAX_CONTENT_LENGTH) {
                        throw new Error("Content too long");
                    }

                    const aiService = new AIService(env);
                    const { summary, model } = await aiService.generateSummary(articleContent, language);

                    await cacheSummary(env.DB, articleUrl, summary, model, language);

                    return new Response(JSON.stringify({ summary, model }), { headers: commonHeaders });
                } catch (error) {
                    console.error('Failed to update summary:', error);
                    return new Response(JSON.stringify({
                        summary: cachedSummary.summary,
                        model: cachedSummary.model
                    }), { headers: commonHeaders });
                }
            }

            const articleContent = await fetchArticleContent(articleUrl);
            if (articleContent.length > env.MAX_CONTENT_LENGTH) {
                return new Response(JSON.stringify({ error: "Content too long" }), { status: 400, headers: commonHeaders });
            }

            const aiService = new AIService(env);
            const { summary, model } = await aiService.generateSummary(articleContent, language);

            await cacheSummary(env.DB, articleUrl, summary, model, language);

            return new Response(JSON.stringify({ summary, model }), { headers: commonHeaders });
        } catch (error) {
            console.error('Error in fetch function:', error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: commonHeaders });
        }
    }
};

function normalizeLanguageCode(langCode) {
    if (langCode === 'zh') {
        return 'zh-CN';
    }
    return langCode;
}

function getPreferredLanguage(acceptLanguageHeader) {
    if (!acceptLanguageHeader) {
        return null;
    }

    const languages = acceptLanguageHeader.split(',').map(lang => {
        const [code, qValue] = lang.trim().split(';q=');
        return {
            code: normalizeLanguageCode(code.split('-')[0].toLowerCase()),
            q: qValue ? parseFloat(qValue) : 1.0
        };
    });

    languages.sort((a, b) => b.q - a.q);
    return languages.length > 0 ? languages[0].code : null;
}

class AIService {
    constructor(env) {
        this.env = env;
        this.provider = env.AI_PROVIDER;
        this.model = env.AI_MODEL;
        this.apiKey = env.AI_API_KEY;
        this.apiEndpoint = env.AI_ENDPOINT || this.getDefaultEndpoint();
        this.promptTemplate = env.PROMPT_TEMPLATE || this.getDefaultPromptTemplate();
    }

    getDefaultEndpoint() {
        switch (this.provider) {
            case 'openai':
                return 'https://api.openai.com/v1/chat/completions';
            case 'anthropic':
                return 'https://api.anthropic.com/v1/messages';
            case 'gemini':
                return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
            default:
                throw new Error(`No default endpoint for provider: ${this.provider}`);
        }
    }

    getDefaultPromptTemplate() {
        return `You are a language expert proficient in multiple languages, particularly skilled in reading and summarizing content. You have the ability to understand and appreciate diverse cultures. Summarize an article potentially containing HTML tags, leveraging the tag structure to comprehend organization while focusing on content in your concise summary.​​​​​​​​​​​​​​​​

Rules:
- Content requirements: The summary should accurately convey the facts and background of the original text. Emphasize detailed reasoning, chain thinking, self-reflection, and error checking. Maintain a neutral, objective, and rational attitude.
- Expression style: Use an analytical, slightly formal tone, focusing on clearly conveying the essence of the article.
- Format requirements: Organize information into 2-3 short paragraphs.
- Word count requirement: The summary should contain at least ${this.env.SUMMARY_MIN_LENGTH} words.
- Special considerations: Briefly mention each viewpoint when multiple are involved. Note the relevant time for time-sensitive content. Distinguish between factual statements, author's opinions, and quoted opinions.

Strategy:
1. Read deeply and understand the structure and content of the article.
2. Think about the content, author's intentions, and distill the core points of the article.
3. Reflect on your thought process and summarized points, try to find errors and correct them by referring back to the article.
4. Combine the points summarized in the above three steps with the original text to output an easy-to-understand summary.

Now, please read the following article and provide a summary based on these guidelines:`;
    }

    async generateSummary(content, targetLanguage) {
        const messages = this.createMessages(content);
        const englishSummary = await this.callExternalAPI(messages);
        
        if (targetLanguage.toLowerCase() === 'en') {
            return { summary: englishSummary, model: this.model };
        }

        const translatedSummary = await this.translateSummary(englishSummary, targetLanguage);
        return { summary: translatedSummary, model: this.model };
    }

    createMessages(content) {
        const systemPrompt = this.formatPrompt(this.promptTemplate, {
            MIN_LENGTH: this.env.SUMMARY_MIN_LENGTH
        });

        return [
            { role: "system", content: systemPrompt },
            { role: "user", content: content.substring(0, this.env.MAX_CONTENT_LENGTH) }
        ];
    }

    formatPrompt(template, values) {
        return template.replace(/\${(\w+)}/g, (_, key) => values[key] || '');
    }

        async translateSummary(englishSummary, targetLanguage) {
        const translationPrompt = `You are an expert translator fluent in ${targetLanguage}, specializing in translating professional academic texts into clear, concise, and professional writing. Please translate the following English content into ${targetLanguage}, adhering to these guidelines:

Translation Rules:
- Accurately convey the facts and background of the original text.
- Retain original paragraph formatting, and keep terms like FLAC, JPEG, etc. unchanged. Maintain company abbreviations such as Microsoft, Amazon, and OpenAI.
- Do not translate personal names.
- Use half-width parentheses, adding a half-width space before the left parenthesis and after the right parenthesis.
- For professional terms, provide the English term in parentheses when first mentioned (e.g., "生成式 AI (Generative AI)"), and use only the ${targetLanguage} term thereafter.

Please provide the final translation result that strictly complies with the above rules, and ensure that only the translated content is returned without showing any translation process or intermediary steps. Now, please begin translating the following content:`;

        const translationMessages = [
            { role: "system", content: translationPrompt },
            { role: "user", content: englishSummary }
        ];

        return this.callExternalAPI(translationMessages);
    }

    async callExternalAPI(messages) {
        let apiRequestBody;
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };

        switch (this.provider) {
            case 'openai':
                apiRequestBody = JSON.stringify({
                    model: this.model,
                    messages: messages,
                    max_tokens: 1024
                });
                break;
            case 'anthropic':
                apiRequestBody = JSON.stringify({
                    model: this.model,
                    messages: messages,
                    max_tokens: 1024
                });
                headers['anthropic-version'] = '2023-06-01';
                break;
            case 'gemini':
                apiRequestBody = JSON.stringify({
                    contents: messages.map(msg => ({
                        role: msg.role,
                        parts: [{
                            text: msg.content
                        }]
                    })),
                    generationConfig: {
                        maxOutputTokens: 1024
                    }
                });
                break;
            case 'cloudflare':
                return this.getCloudflareAISummary(messages);
            default:
                throw new Error(`Unsupported AI provider: ${this.provider}`);
        }

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: headers,
            body: apiRequestBody
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} ${response.statusText}\n${errorText}`);
        }

        const data = await response.json();
        return this.extractSummaryFromResponse(data);
    }

    extractSummaryFromResponse(data) {
        switch (this.provider) {
            case 'openai':
                return data.choices[0].message.content;
            case 'anthropic':
                return data.content[0].text;
            case 'gemini':
                return data.candidates[0].content.parts[0].text;
            default:
                throw new Error(`Unsupported AI provider: ${this.provider}`);
        }
    }

    async getCloudflareAISummary(messages) {
        if (!this.env.AI) {
            throw new Error('Cloudflare AI binding is not available');
        }
        const response = await this.env.AI.run(this.model, {
            messages: messages,
            max_tokens: 1024
        });
        return response.response;
    }
}

async function validateEnvironment(env) {
    const requiredEnvVars = [
        'AI_PROVIDER', 'ALLOWED_DOMAINS', 'AI_MODEL', 'AI_API_KEY',
        'CACHE_TTL', 'MAX_CONTENT_LENGTH', 'RATE_LIMIT',
        'SUMMARY_MIN_LENGTH'
    ];
    for (const varName of requiredEnvVars) {
        if (!env[varName]) {
            throw new Error(`${varName} environment variable is not set`);
        }
    }
}

async function checkRateLimit(kv, clientIP, rateLimit) {
    const hour = Math.floor(Date.now() / 3600000);
    const rateLimitKey = `ratelimit:${clientIP}:${hour}`;
    const count = parseInt(await kv.get(rateLimitKey) || '0');
    if (count >= rateLimit) {
        throw new Error("Rate limit exceeded");
    }
    await kv.put(rateLimitKey, (count + 1).toString(), { expirationTtl: 3600 });
}

async function validateAllowedDomain(url, allowedDomains) {
    if (!isAllowedDomain(url, allowedDomains)) {
        throw new Error("Requested URL is not from an allowed domain");
    }
}

async function initializeDatabase(db) {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_url TEXT NOT NULL,
            summary TEXT NOT NULL,
            model TEXT NOT NULL,
            language TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(article_url, language)
        );
    `;
    
    try {
        await db.prepare(createTableQuery).run();
    } catch (error) {
        console.error('Error creating table:', error);
        throw new Error('Database initialization failed');
    }
}

async function getCachedSummary(db, articleUrl, language) {
    const stmt = db.prepare(`
        SELECT summary, model, created_at 
        FROM summaries 
        WHERE article_url = ? AND language = ?
    `);
    const result = await stmt.bind(articleUrl, language).first();
    if (result) {
        return {
            summary: result.summary,
            model: result.model,
            created_at: result.created_at
        };
    }
    return null;
}

async function cacheSummary(db, articleUrl, summary, model, language) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO summaries 
        (article_url, summary, model, language, created_at) 
        VALUES (?, ?, ?, ?, ?)
    `);
    await stmt.bind(articleUrl, summary, model, language, Date.now()).run();
}

async function fetchArticleContent(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch article content: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const contentMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);

    const title = titleMatch ? titleMatch[1].trim() : 'No Title Found';
    const articleContent = contentMatch ? contentMatch[1].replace(/<[^>]+>/g, '').trim() : 'No Article Content Found';

    return `<h1>${title}</h1><hr>${articleContent}`;
}

function isAllowedDomain(url, allowedDomains) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const allowedDomainsList = allowedDomains.split(',').map(d => d.trim());

        return allowedDomainsList.some(allowedDomain => {
            if (allowedDomain.startsWith('*.')) {
                const baseDomain = allowedDomain.slice(2);
                return domain === baseDomain || domain.endsWith('.' + baseDomain);
            } else {
                return domain === allowedDomain;
            }
        });
    } catch (error) {
        console.error('Error parsing URL:', error);
        return false;
    }
}