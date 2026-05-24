const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
const User = require('./models/User');
const bcrypt = require('bcrypt');
const {
  NEWS_SYSTEM_PROMPT,
  formatGeneralUserPrompt,
  formatNewsUserPrompt
} = require('./newsPrompts');


const app = express();
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.redirect('/news.html');
});

app.get('/index.html', (req, res) => {
  res.redirect('/news.html');
});

app.get('/favorites.html', (req, res) => {
  res.redirect('/favourites.html');
});

const categoryQueries = {
  football: 'football OR "premier league" OR UEFA',
  cricket: 'cricket',
  politics: 'politics OR election OR parliament',
  fashion: 'fashion OR style OR couture',
  lifestyle: 'lifestyle OR wellness OR travel',
  science: 'science OR NASA OR space exploration'
};

const categoryKeywords = {
  sports: ['sports', 'sport', 'match', 'game', 'tournament', 'score'],
  football: ['football', 'soccer', 'ucl', 'premier league', 'fifa'],
  cricket: ['cricket', 'ipl', 't20', 'odi', 'test match', 'wicket'],
  technology: ['technology', 'tech', 'ai', 'software', 'startup', 'coding'],
  business: ['business', 'market', 'finance', 'stock', 'economy', 'trade'],
  science: ['science', 'research', 'space', 'nasa', 'discovery', 'climate'],
  health: ['health', 'fitness', 'medicine', 'wellness', 'hospital', 'covid'],
  entertainment: ['entertainment', 'movie', 'music', 'celebrity', 'film', 'actor'],
  politics: ['politics', 'government', 'election', 'policy', 'parliament', 'minister', 'president', 'senate'],
  fashion: ['fashion', 'style', 'clothing', 'outfit', 'designer', 'trend']
};

function detectCategory(message) {
  const normalizedMessage = message.toLowerCase();
  return Object.entries(categoryKeywords).find(([, keywords]) => {
    return keywords.some((keyword) => normalizedMessage.includes(keyword));
  })?.[0] || null;
}

async function callGemini(systemPrompt, message, apiKey) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\nUser message: ${message}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300
      }
    },
    {
      timeout: 20000
    }
  );

  const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) {
    throw new Error('Gemini returned an empty response.');
  }

  return reply;
}

async function callChatGpt(systemPrompt, message) {
  const openAiKey = process.env.OPENAI_API_KEY;
  const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!openAiKey) {
    throw new Error('OpenAI API key is not configured on the server.');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: openAiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 300
    },
    {
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error('ChatGPT returned an empty response.');
  }

  return reply;
}

async function fetchNewsArticles(category) {
  const newsApiKey = process.env.NEWS_API_KEY;

  if (!newsApiKey) {
    throw new Error('News API key is not configured on the server.');
  }

  let url;
  if (categoryQueries[category]) {
    url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(categoryQueries[category])}&language=en&sortBy=publishedAt&pageSize=6&apiKey=${newsApiKey}`;
  } else {
    url = `https://newsapi.org/v2/top-headlines?category=${encodeURIComponent(category)}&language=en&pageSize=6&apiKey=${newsApiKey}`;
  }

  const response = await axios.get(url, { timeout: 10000 });
  return Array.isArray(response.data?.articles) ? response.data.articles : [];
}

async function buildCategoryReply(category) {
  const articles = await fetchNewsArticles(category);

  if (!articles.length) {
    return `I could not find ${category} news right now.`;
  }

  const top = articles.slice(0, 3);
  const capitalized = category.charAt(0).toUpperCase() + category.slice(1);

  const headlines = top.map((article, index) => {
    const source = article.source?.name || 'Unknown source';
    const url = article.url || 'No URL';
    return `${index + 1}. ${article.title}\n   Source: ${source} | ${url}`;
  }).join('\n\n');

  const summaryBullets = top.map(a => `- ${a.description || a.title}`).join('\n');

  return [
    `Latest ${capitalized} News`,
    '',
    headlines,
    '',
    'Quick Summary:',
    summaryBullets,
    '',
    'Why It Matters:',
    `- These are the most recent ${category} developments as of today.`,
    `- Staying informed about ${category} helps you understand current events and their broader impact.`
  ].join('\n');
}

async function tryAiProviders(systemPrompt, userPrompt, geminiApiKey) {
  if (geminiApiKey) {
    try {
      const reply = await callGemini(systemPrompt, userPrompt, geminiApiKey);
      return { reply, provider: 'gemini' };
    } catch (error) {
      const details = error.response?.data || error.message;
      console.error('Gemini API error:', details);
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const reply = await callChatGpt(systemPrompt, userPrompt);
      return { reply, provider: 'chatgpt' };
    } catch (error) {
      const details = error.response?.data || error.message;
      console.error('OpenAI API error:', details);
    }
  }

  return null;
}

// Connect to MongoDB (use MONGODB_URI from .env)
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_news_curator';

async function connectWithRetry(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('MongoDB connected to', mongoUri);

      // Ensure indexes from models (e.g., unique email) are created
      try {
        await User.init();
        console.log('User model indexes ensured');
      } catch (idxErr) {
        console.warn('Index creation warning:', idxErr.message || idxErr);
      }

      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${i + 1} failed:`, err.message || err);
      const wait = Math.min(30000, 1000 * 2 ** i) + Math.random() * 500;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.error('Could not connect to MongoDB after retries');
  process.exit(1);
}

connectWithRetry();


// Sign Up

// Signup Route
app.post('/signup', async (req, res) => {
    try {
      const { name, email, password } = req.body;
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.json({ message: 'Email already exists' });
  
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ name, email, password: hashedPassword });
      await newUser.save();
      res.json({ message: 'User created' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  });
  

// Login Route
app.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) return res.json({ message: 'Invalid credentials' });
  
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.json({ message: 'Invalid credentials' });
  
      res.json({ message: 'Login successful' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  });

app.post('/api/assistant', async (req, res) => {
    const { message, page = 'news', context = '' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const matchedCategory = detectCategory(message || '');

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    if (matchedCategory) {
      try {
        const articles = await fetchNewsArticles(matchedCategory);

        if (!articles.length) {
          return res.json({ reply: `I could not find ${matchedCategory} news right now.` });
        }

        const newsPrompt = formatNewsUserPrompt({
          userMessage: message,
          category: matchedCategory,
          articles,
          page,
          context
        });

        const aiResult = await tryAiProviders(NEWS_SYSTEM_PROMPT, newsPrompt, apiKey);
        if (aiResult) {
          return res.json(aiResult);
        }

        const reply = await buildCategoryReply(matchedCategory);
        return res.json({ reply, provider: 'newsapi-fallback' });
      } catch (error) {
        console.error('Assistant category fallback error:', error.message);
      }
    }

    const userPrompt = formatGeneralUserPrompt({ message, page, context });

    if (!apiKey && !process.env.OPENAI_API_KEY) {
      return res.json({ reply: 'The AI assistant is unavailable right now. You can still use the category filters to browse the latest news.' });
    }

    const aiResult = await tryAiProviders(NEWS_SYSTEM_PROMPT, userPrompt, apiKey);
    if (aiResult) {
      return res.json(aiResult);
    }

    res.json({ reply: 'Both Gemini and ChatGPT are temporarily unavailable. You can still ask for category news like sports, cricket, or business.' });
  });

app.get('/api/news', async (req, res) => {
    const category = (req.query.category || 'general').toString().trim().toLowerCase();

    try {
      const articles = await fetchNewsArticles(category);
      res.json({ articles });
    } catch (error) {
      const details = error.response?.data || error.message;
      console.error('News API error:', details);
      res.status(502).json({ message: 'Failed to fetch news articles.' });
    }
  });

app.get('/api/news-proxy', async (req, res) => {
    const newsApiKey = process.env.NEWS_API_KEY;

    if (!newsApiKey) {
      return res.status(500).json({ message: 'News API key is not configured on the server.' });
    }

    const endpoint = (req.query.endpoint || 'top-headlines').toString().trim().toLowerCase() === 'everything'
      ? 'everything'
      : 'top-headlines';

    const allowedParams = ['q', 'country', 'category', 'language', 'sortBy', 'pageSize', 'page'];
    const params = new URLSearchParams();

    allowedParams.forEach((key) => {
      const value = req.query[key];
      if (typeof value === 'string' && value.trim()) {
        params.append(key, value.trim());
      }
    });

    if (!params.has('language')) {
      params.set('language', 'en');
    }

    if (!params.has('pageSize')) {
      params.set('pageSize', '20');
    }

    if (endpoint === 'everything' && !params.has('q')) {
      return res.status(400).json({ message: 'Query parameter q is required for everything endpoint.' });
    }

    params.set('apiKey', newsApiKey);

    try {
      const newsApiUrl = `https://newsapi.org/v2/${endpoint}?${params.toString()}`;
      const response = await axios.get(newsApiUrl, { timeout: 15000 });
      res.json(response.data);
    } catch (error) {
      const details = error.response?.data || error.message;
      console.error('News proxy error:', details);
      res.status(502).json({ message: 'Failed to fetch news from provider.' });
    }
  });
  
  

app.listen(port, () => console.log(`Server running on port ${port}`));
