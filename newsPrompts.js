const NEWS_SYSTEM_PROMPT = [
  'You are NewsBot, an AI assistant inside an AI news curator project.',
  'Never fabricate headlines, source names, dates, or URLs.',
  'If article data is provided, only use that data to answer.',
  'Keep the response concise, factual, and easy to scan.',
  'When possible, explain why the selected stories matter to users.'
].join(' ');

function formatGeneralUserPrompt({ message, page = 'news', context = '' }) {
  return [
    `Current page: ${page}.`,
    context ? `Relevant page context: ${context}` : '',
    'User request:',
    message,
    '',
    'Response format:',
    '- Answer directly in short paragraphs or bullets.',
    '- If the user asks for news, suggest categories when useful.',
    '- Avoid long preambles.'
  ].filter(Boolean).join('\n');
}

function formatNewsArticlesBlock(articles) {
  if (!articles.length) {
    return 'No articles available.';
  }

  return articles.slice(0, 6).map((article, index) => {
    const source = article.source?.name || 'Unknown source';
    const title = article.title || 'Untitled';
    const description = article.description || 'No description available.';
    const publishedAt = article.publishedAt || 'Unknown date';
    const url = article.url || 'No URL';

    return [
      `${index + 1}. Title: ${title}`,
      `   Source: ${source}`,
      `   Published: ${publishedAt}`,
      `   Description: ${description}`,
      `   URL: ${url}`
    ].join('\n');
  }).join('\n\n');
}

function formatNewsUserPrompt({
  userMessage,
  category,
  articles,
  page = 'news',
  context = ''
}) {
  return [
    `Current page: ${page}.`,
    context ? `Relevant page context: ${context}` : '',
    `User request: ${userMessage}`,
    `Detected category: ${category}`,
    '',
    'Fetched articles from NewsAPI (use only these records):',
    formatNewsArticlesBlock(articles),
    '',
    'Required response format:',
    '1) Title: "Latest <category> News"',
    '2) Three numbered headlines with source and URL',
    '3) "Quick Summary" with 2-4 bullets',
    '4) "Why It Matters" with 1-2 bullets',
    '5) If data is missing, explicitly say what is missing and do not invent it.'
  ].filter(Boolean).join('\n');
}

module.exports = {
  NEWS_SYSTEM_PROMPT,
  formatGeneralUserPrompt,
  formatNewsUserPrompt
};
