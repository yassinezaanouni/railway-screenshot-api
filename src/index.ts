import express, { Request, Response, NextFunction } from 'express';
import { BrowserPool } from './browser-pool.js';
import { ScreenshotService, ScreenshotOptions } from './screenshot.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const POOL_SIZE = parseInt(process.env.POOL_SIZE || '10', 10);

// Browser pool and screenshot service
let screenshotService: ScreenshotService;

// API Key middleware
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!API_KEY) {
    console.error('API_KEY not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const key = req.header('x-api-key') || req.query.api_key;

  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid or missing API key' });
  }

  next();
};

// Health check (no auth)
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Railway Screenshot API running' });
});

// Pool stats (no auth)
app.get('/stats', (req, res) => {
  if (!screenshotService) {
    return res.json({ status: 'initializing' });
  }
  res.json({ status: 'ready', pool: (screenshotService as any).pool.getStats() });
});

// Single screenshot
app.get('/take', authMiddleware, async (req, res) => {
  const startTime = Date.now();

  try {
    const options: ScreenshotOptions = {
      url: req.query.url as string,
      fullPage: req.query.fullPage === 'true',
      type: (req.query.type as 'png' | 'jpeg' | 'pdf') || 'png',
      quality: req.query.quality ? parseInt(req.query.quality as string, 10) : undefined,
      width: req.query.width ? parseInt(req.query.width as string, 10) : undefined,
      height: req.query.height ? parseInt(req.query.height as string, 10) : undefined,
      delay: req.query.delay ? parseInt(req.query.delay as string, 10) : undefined,
      device: req.query.device as 'desktop' | 'tablet' | 'mobile' | undefined,
    };

    if (!options.url) {
      return res.status(400).json({ error: 'url parameter is required' });
    }

    const screenshot = await screenshotService.capture(options);

    const duration = Date.now() - startTime;
    console.log(`Screenshot captured in ${duration}ms: ${options.url}`);

    const contentTypes = { png: 'image/png', jpeg: 'image/jpeg', pdf: 'application/pdf' };
    res.set('Content-Type', contentTypes[options.type || 'png']);
    res.set('X-Duration-Ms', duration.toString());
    res.send(screenshot);
  } catch (error: any) {
    console.error('Screenshot error:', error.message);
    res.status(500).json({ error: 'Screenshot failed', details: error.message });
  }
});

// Batch screenshots (POST with array of URLs)
app.post('/batch', authMiddleware, async (req, res) => {
  const startTime = Date.now();

  try {
    const { urls, options: globalOptions } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    if (urls.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 URLs per batch' });
    }

    const optionsArray: ScreenshotOptions[] = urls.map((url: string) => ({
      url,
      ...globalOptions,
    }));

    const screenshots = await screenshotService.captureMany(optionsArray);

    const duration = Date.now() - startTime;
    console.log(`Batch of ${urls.length} screenshots captured in ${duration}ms`);

    // Return as JSON with base64 encoded images
    const results = screenshots.map((buffer, index) => ({
      url: urls[index],
      image: buffer.toString('base64'),
      type: globalOptions?.type || 'png',
    }));

    res.json({
      count: results.length,
      durationMs: duration,
      avgMs: Math.round(duration / results.length),
      results,
    });
  } catch (error: any) {
    console.error('Batch screenshot error:', error.message);
    res.status(500).json({ error: 'Batch screenshot failed', details: error.message });
  }
});

// Initialize and start
async function main() {
  console.log('Initializing browser pool...');
  const pool = new BrowserPool(POOL_SIZE);
  await pool.initialize();

  screenshotService = new ScreenshotService(pool);

  app.listen(PORT, () => {
    console.log(`Screenshot API running on port ${PORT}`);
    console.log(`Pool size: ${POOL_SIZE}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await pool.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
