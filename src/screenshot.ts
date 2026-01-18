import { BrowserPool } from './browser-pool.js';

export interface ScreenshotOptions {
  url: string;
  fullPage?: boolean;
  type?: 'png' | 'jpeg' | 'pdf';
  quality?: number;
  width?: number;
  height?: number;
  delay?: number;
  device?: 'desktop' | 'tablet' | 'mobile';
}

const deviceViewports = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

export class ScreenshotService {
  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  async capture(options: ScreenshotOptions): Promise<Buffer> {
    const { page, release } = await this.pool.acquirePage();

    try {
      // Set viewport
      const viewport = options.device
        ? deviceViewports[options.device]
        : {
            width: options.width || 1280,
            height: options.height || 720,
          };

      await page.setViewportSize(viewport);

      // Navigate to URL
      await page.goto(options.url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Optional delay
      if (options.delay && options.delay > 0) {
        await page.waitForTimeout(options.delay * 1000);
      }

      // Take screenshot or PDF
      if (options.type === 'pdf') {
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
        });
        return pdf;
      }

      const screenshot = await page.screenshot({
        fullPage: options.fullPage ?? false,
        type: options.type || 'png',
        quality: options.type === 'jpeg' ? options.quality || 80 : undefined,
      });

      return screenshot;
    } finally {
      // Clear page state for reuse
      await page.goto('about:blank').catch(() => {});
      await release();
    }
  }

  async captureMany(optionsArray: ScreenshotOptions[]): Promise<Buffer[]> {
    return Promise.all(optionsArray.map((opts) => this.capture(opts)));
  }
}
