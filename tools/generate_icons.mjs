import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const svgPath = path.resolve(__dirname, '../extension/icon.svg');
    if (!fs.existsSync(svgPath)) {
        console.error(`Error: SVG icon not found at ${svgPath}`);
        process.exit(1);
    }
    const svgContent = fs.readFileSync(svgPath, 'utf8');

    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Inject SVG and remove margin/padding to prevent cropping issues
    await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                html, body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: transparent;
                }
                svg {
                    width: 100%;
                    height: 100%;
                    display: block;
                }
            </style>
        </head>
        <body>
            ${svgContent}
        </body>
        </html>
    `);

    const sizes = [16, 32, 48, 128];
    for (const size of sizes) {
        await page.setViewportSize({ width: size, height: size });
        const outPath = path.resolve(__dirname, `../extension/icon-${size}.png`);
        await page.screenshot({
            path: outPath,
            omitBackground: true,
            type: 'png'
        });
        console.log(`Generated ${path.basename(outPath)}`);
    }

    await browser.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
