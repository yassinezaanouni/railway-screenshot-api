import { chromium, Browser, BrowserContext, Page } from 'playwright';

interface PooledPage {
  page: Page;
  context: BrowserContext;
  inUse: boolean;
  createdAt: number;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private pages: PooledPage[] = [];
  private poolSize: number;
  private maxPageAge: number = 5 * 60 * 1000; // 5 minutes

  constructor(poolSize: number = 10) {
    this.poolSize = poolSize;
  }

  async initialize(): Promise<void> {
    console.log('Launching browser...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--mute-audio',
        '--hide-scrollbars',
      ],
    });

    console.log(`Pre-warming ${this.poolSize} pages...`);
    const warmupPromises = [];
    for (let i = 0; i < this.poolSize; i++) {
      warmupPromises.push(this.createPooledPage());
    }
    await Promise.all(warmupPromises);
    console.log(`Browser pool ready with ${this.pages.length} pages`);
  }

  private async createPooledPage(): Promise<PooledPage> {
    if (!this.browser) throw new Error('Browser not initialized');

    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const pooledPage: PooledPage = {
      page,
      context,
      inUse: false,
      createdAt: Date.now(),
    };

    this.pages.push(pooledPage);
    return pooledPage;
  }

  async acquirePage(): Promise<{ page: Page; release: () => Promise<void> }> {
    // Find available page
    let pooledPage = this.pages.find((p) => !p.inUse);

    // If no available page, wait briefly and try again
    if (!pooledPage) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      pooledPage = this.pages.find((p) => !p.inUse);
    }

    // Still no page? Create a new one temporarily
    if (!pooledPage) {
      pooledPage = await this.createPooledPage();
    }

    pooledPage.inUse = true;

    const release = async () => {
      pooledPage!.inUse = false;

      // If page is too old, replace it
      if (Date.now() - pooledPage!.createdAt > this.maxPageAge) {
        const index = this.pages.indexOf(pooledPage!);
        if (index > -1) {
          this.pages.splice(index, 1);
          await pooledPage!.context.close().catch(() => {});
          // Create replacement
          this.createPooledPage().catch(console.error);
        }
      }
    };

    return { page: pooledPage.page, release };
  }

  async close(): Promise<void> {
    for (const pooledPage of this.pages) {
      await pooledPage.context.close().catch(() => {});
    }
    await this.browser?.close();
  }

  getStats() {
    return {
      total: this.pages.length,
      available: this.pages.filter((p) => !p.inUse).length,
      inUse: this.pages.filter((p) => p.inUse).length,
    };
  }
}
