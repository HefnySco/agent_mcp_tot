import { renderMermaid as mermaidCliRender } from '@mermaid-js/mermaid-cli';
import puppeteer from 'puppeteer';

export type MermaidFormat = 'mmd' | 'png' | 'svg';

export interface RenderResult {
  data: string;
  mimeType: string;
}

/**
 * Render Mermaid diagram to specified format using the mermaid-cli programmatic API.
 * Avoids spawning a child process by calling renderMermaid() directly.
 *
 * @param mermaidCode - The Mermaid diagram code
 * @param format - Output format: 'mmd' for raw text, 'png' for image, 'svg' for SVG
 * @returns RenderResult with base64 encoded data and MIME type
 *
 * @throws Error if rendering fails
 */
export async function renderMermaid(
  mermaidCode: string,
  format: MermaidFormat = 'png'
): Promise<RenderResult> {
  if (format === 'mmd') {
    return {
      data: mermaidCode,
      mimeType: 'text/plain'
    };
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const { data } = await mermaidCliRender(
      browser,
      mermaidCode,
      format as 'png' | 'svg',
      { backgroundColor: 'white' }
    );

    return {
      data: (data as Buffer).toString('base64'),
      mimeType: format === 'png' ? 'image/png' : 'image/svg+xml'
    };
  } finally {
    await browser.close();
  }
}
