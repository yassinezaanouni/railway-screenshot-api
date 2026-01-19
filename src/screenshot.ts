import { BrowserPool } from './browser-pool.js';
import { Page } from 'playwright';

export interface ScreenshotOptions {
  url: string;
  fullPage?: boolean;
  type?: 'png' | 'jpeg' | 'pdf';
  quality?: number;
  width?: number;
  height?: number;
  delay?: number;
  device?: 'desktop' | 'tablet' | 'mobile';
  blockAds?: boolean;
}

const deviceViewports = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

// Common ad/tracking domains and patterns to block
const BLOCKED_PATTERNS = [
  // Ad networks
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googletagservices.com/*',
  '*://*.facebook.net/*',
  '*://*.facebook.com/tr/*',
  '*://*.fbcdn.net/signals/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.adsrvr.org/*',
  '*://*.adnxs.com/*',
  '*://*.criteo.com/*',
  '*://*.criteo.net/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  '*://*.pubmatic.com/*',
  '*://*.rubiconproject.com/*',
  '*://*.openx.net/*',
  '*://*.casalemedia.com/*',
  '*://*.advertising.com/*',
  '*://*.adform.net/*',
  '*://*.ads-twitter.com/*',
  '*://*.moatads.com/*',
  '*://*.quantserve.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.rlcdn.com/*',
  '*://*.bluekai.com/*',
  '*://*.krxd.net/*',
  '*://*.exelator.com/*',
  '*://*.everesttech.net/*',
  // Cookie consent popups
  '*://*.cookielaw.org/*',
  '*://*.cookiebot.com/*',
  '*://*.onetrust.com/*',
  '*://*.trustarc.com/*',
  '*://*.cookiepro.com/*',
  '*://*.consentmanager.net/*',
  '*://*.usercentrics.eu/*',
  '*://*.privacymanager.io/*',
  '*://*.termly.io/*',
  '*://*.iubenda.com/*',
  // Tracking pixels and analytics
  '*://*.hotjar.com/*',
  '*://*.fullstory.com/*',
  '*://*.mixpanel.com/*',
  '*://*.segment.io/*',
  '*://*.segment.com/*',
  '*://*.amplitude.com/*',
  '*://*.heapanalytics.com/*',
  '*://*.mouseflow.com/*',
  '*://*.luckyorange.com/*',
  '*://*.crazyegg.com/*',
  '*://*.inspectlet.com/*',
  // More ad networks
  '*://*.adskeeper.com/*',
  '*://*.mgid.com/*',
  '*://*.revcontent.com/*',
  '*://*.content.ad/*',
  '*://*.zergnet.com/*',
];

// Convert glob patterns to regex
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const BLOCKED_REGEXES = BLOCKED_PATTERNS.map(globToRegex);

function shouldBlockUrl(url: string): boolean {
  return BLOCKED_REGEXES.some((regex) => regex.test(url));
}

// Wait for images to load (with timeout to avoid waiting forever)
async function waitForImages(
  page: Page,
  viewportOnly = true,
  timeout = 5000,
): Promise<void> {
  await page.evaluate(
    ({ maxWait, viewportOnly }) => {
      return new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, maxWait);

        const images = Array.from(document.images);

        // Filter to viewport-visible images if requested
        const targetImages = viewportOnly
          ? images.filter((img) => {
              const rect = img.getBoundingClientRect();
              return (
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0
              );
            })
          : images;

        const unloadedImages = targetImages.filter((img) => !img.complete);

        if (unloadedImages.length === 0) {
          clearTimeout(timeoutId);
          resolve();
          return;
        }

        let loaded = 0;
        const checkDone = () => {
          loaded++;
          if (loaded >= unloadedImages.length) {
            clearTimeout(timeoutId);
            resolve();
          }
        };

        unloadedImages.forEach((img) => {
          img.addEventListener('load', checkDone);
          img.addEventListener('error', checkDone);
        });
      });
    },
    { maxWait: timeout, viewportOnly },
  );
}

// Scroll to bottom to trigger lazy-loaded content
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const delay = 100;

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          // Scroll back to top for consistent screenshot
          window.scrollTo(0, 0);
          // Small delay to let any final lazy-loads trigger
          setTimeout(resolve, 200);
        }
      }, delay);
    });
  });
}

export class ScreenshotService {
  private pool: BrowserPool;

  constructor(pool: BrowserPool) {
    this.pool = pool;
  }

  async capture(options: ScreenshotOptions): Promise<Buffer> {
    const { page, release } = await this.pool.acquirePage();
    const blockAds = options.blockAds ?? true; // Default to blocking

    try {
      // Set up ad/cookie blocking if enabled
      if (blockAds) {
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (shouldBlockUrl(url)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }

      // Set viewport
      const viewport = options.device
        ? deviceViewports[options.device]
        : {
            width: options.width || 1280,
            height: options.height || 720,
          };

      await page.setViewportSize(viewport);

      // Navigate to URL - use domcontentloaded for speed (ads are blocked anyway)
      await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // For viewport screenshots: wait for visible images only
      // For fullPage: scroll first (triggers lazy-load), then wait for all images
      if (options.fullPage) {
        await scrollToBottom(page);
        await waitForImages(page, false); // all images after scroll
      } else {
        await waitForImages(page, true); // viewport images only
      }

      // User-specified delay (optional)
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
      // Clear routes and page state for reuse
      await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
      await page.goto('about:blank').catch(() => {});
      await release();
    }
  }

  async captureMany(
    optionsArray: ScreenshotOptions[],
  ): Promise<{ url: string; success: boolean; buffer?: Buffer; error?: string }[]> {
    const results = await Promise.allSettled(
      optionsArray.map((opts) => this.capture(opts)),
    );

    return results.map((result, index) => {
      const url = optionsArray[index].url;
      if (result.status === 'fulfilled') {
        return { url, success: true, buffer: result.value };
      } else {
        return {
          url,
          success: false,
          error: result.reason?.message || 'Screenshot failed',
        };
      }
    });
  }
}
