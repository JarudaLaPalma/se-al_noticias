import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const app = express();
const PORT = 3000;

const parser = new Parser({
  customFields: {
    item: ['media:content', 'description', 'content:encoded', 'enclosure'],
  },
});

// Cache map: feedUrl -> { timestamp, data }
const cache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

app.get('/api/rss', async (req, res) => {
  const feedUrl = req.query.url as string;
  if (!feedUrl) {
    res.status(400).json({ error: 'Missing feed URL' });
    return;
  }

  // Check cache
  const cached = cache.get(feedUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    res.json(cached.data);
    return;
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    cache.set(feedUrl, { timestamp: Date.now(), data: feed });
    res.json(feed);
  } catch (error: any) {
    console.error('Error fetching RSS:', error);
    res.status(500).json({ error: 'Failed to fetch RSS feed', details: error.message });
  }
});

app.get('/api/discover', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing URL' });
    return;
  }

  try {
    // If it's already an RSS feed, test it.
    try {
      const feed = await parser.parseURL(targetUrl);
      if (feed) {
        res.json({ url: targetUrl });
        return;
      }
    } catch (e) {
      // Not a direct valid feed, proceed to discover
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'SenalAppBot/1.0',
      },
    });
    
    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to fetch the webpage' });
      return;
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let feedUrl = null;
    
    // Look for <link rel="alternate" type="application/rss+xml"> or similar
    const alternateLinks = $('link[rel="alternate"]');
    
    alternateLinks.each((_, el) => {
      const type = $(el).attr('type');
      if (type && (type.includes('rss') || type.includes('xml') || type.includes('atom'))) {
        feedUrl = $(el).attr('href');
        return false; // Break loop
      }
    });

    if (feedUrl) {
      // Make it absolute if it's relative
      try {
        const absoluteUrl = new URL(feedUrl, targetUrl).href;
        res.json({ url: absoluteUrl });
      } catch (e) {
        res.status(400).json({ error: 'Found an invalid feed URL format on the page.' });
      }
    } else {
      res.status(404).json({ error: 'No RSS feed found on this page.' });
    }
  } catch (error: any) {
    console.error('Error discovering RSS:', error);
    res.status(500).json({ error: 'Failed to discover RSS feed', details: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
