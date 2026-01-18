import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BrowserPool } from './browser-pool.js';
import { ScreenshotService, ScreenshotOptions } from './screenshot.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const POOL_SIZE = parseInt(process.env.POOL_SIZE || '10', 10);

// Browser pool and screenshot service
let screenshotService: ScreenshotService;

// Zod schemas for validation
const ScreenshotQuerySchema = z.object({
  url: z.string().url('Invalid URL format'),
  fullPage: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  type: z.enum(['png', 'jpeg', 'pdf']).optional().default('png'),
  quality: z.coerce
    .number()
    .int()
    .min(1, 'Quality must be at least 1')
    .max(100, 'Quality must be at most 100')
    .optional(),
  width: z.coerce.number().int().min(1).max(3840).optional(),
  height: z.coerce.number().int().min(1).max(2160).optional(),
  delay: z.coerce.number().int().min(0).max(30).optional(),
  device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
  blockAds: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .default('true'),
});

const BatchBodySchema = z.object({
  urls: z
    .array(z.string().url('Invalid URL format'))
    .min(1, 'At least one URL is required')
    .max(20, 'Maximum 20 URLs per batch'),
  options: z
    .object({
      fullPage: z.boolean().optional(),
      type: z.enum(['png', 'jpeg', 'pdf']).optional(),
      quality: z.number().int().min(1).max(100).optional(),
      width: z.number().int().min(1).max(3840).optional(),
      height: z.number().int().min(1).max(2160).optional(),
      delay: z.number().int().min(0).max(30).optional(),
      device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
      blockAds: z.boolean().optional().default(true),
    })
    .optional(),
});

// Format Zod errors into readable messages
function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join('; ');
}

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

  // Validate query parameters
  const parseResult = ScreenshotQuerySchema.safeParse(req.query);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatZodError(parseResult.error),
    });
  }

  const validated = parseResult.data;

  try {
    const options: ScreenshotOptions = {
      url: validated.url,
      fullPage: validated.fullPage,
      type: validated.type,
      quality: validated.quality,
      width: validated.width,
      height: validated.height,
      delay: validated.delay,
      device: validated.device,
      blockAds: validated.blockAds,
    };

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

  // Validate request body
  const parseResult = BatchBodySchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatZodError(parseResult.error),
    });
  }

  const { urls, options: globalOptions } = parseResult.data;

  try {
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
