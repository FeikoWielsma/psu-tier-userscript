import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const screenshotDir = path.resolve(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotDir)) {
        console.error(`Error: screenshots directory not found at ${screenshotDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png') && !f.includes('_webstore'));
    if (files.length === 0) {
        console.log("No source PNG screenshots found in screenshots/ directory.");
        return;
    }

    console.log(`Found ${files.length} screenshots to convert...`);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    for (const file of files) {
        const filePath = path.join(screenshotDir, file);
        const fileBuffer = fs.readFileSync(filePath);
        const base64Image = fileBuffer.toString('base64');
        const mimeType = 'image/png';

        console.log(`Processing ${file}...`);

        // Perform image scaling and conversion inside the browser sandbox using HTML5 Canvas
        const resultBase64 = await page.evaluate(async ({ base64, mime }) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    // 1. Create a helper canvas to read the original image data and sample the background color
                    const helperCanvas = document.createElement('canvas');
                    helperCanvas.width = img.width;
                    helperCanvas.height = img.height;
                    const helperCtx = helperCanvas.getContext('2d');
                    helperCtx.drawImage(img, 0, 0);

                    // Sample top-left corner pixel to auto-detect background color
                    const p = helperCtx.getImageData(0, 0, 1, 1).data;
                    const bgColor = `rgb(${p[0]}, ${p[1]}, ${p[2]})`;

                    // 2. Create the final webstore screenshot canvas (1280 x 800)
                    const canvas = document.createElement('canvas');
                    canvas.width = 1280;
                    canvas.height = 800;
                    const ctx = canvas.getContext('2d');

                    // Fill canvas with detected background color
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(0, 0, 1280, 800);

                    // Calculate the optimal scaling factor to fit the image without stretching
                    const scale = Math.min(1280 / img.width, 800 / img.height);
                    const w = img.width * scale;
                    const h = img.height * scale;
                    const x = (1280 - w) / 2;
                    const y = (800 - h) / 2;

                    // Draw the image centered
                    ctx.drawImage(img, x, y, w, h);

                    // Export as JPEG (no alpha channel, quality 90%)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    resolve(dataUrl.split(',')[1]);
                };
                img.onerror = () => reject(new Error("Failed to load image"));
                img.src = `data:${mime};base64,${base64}`;
            });
        }, { base64: base64Image, mime: mimeType });

        const outputName = file.replace('.png', '_webstore.jpg');
        const outputPath = path.join(screenshotDir, outputName);
        fs.writeFileSync(outputPath, Buffer.from(resultBase64, 'base64'));
        console.log(`Saved webstore screenshot to ${outputName}`);
    }

    await browser.close();
    console.log("All screenshots processed successfully.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
