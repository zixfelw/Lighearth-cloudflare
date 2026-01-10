const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const images = [
    { input: 'images/3dhome/house-3d-light.png', output: 'images/3dhome/house-3d-light.webp' },
    { input: 'images/3dhome/house-3d-dark.png', output: 'images/3dhome/house-3d-dark.webp' },
    { input: 'images/solar-panel-3d.png', output: 'images/solar-panel-3d.webp' },
    { input: 'images/solar-panel-3d-mobile.png', output: 'images/solar-panel-3d-mobile.webp' },
    { input: 'images/lumentree-logo.png', output: 'images/lumentree-logo.webp' },
    { input: 'logo.png', output: 'logo.webp' }
];

async function convertToWebP() {
    console.log('🚀 Starting WebP conversion...\n');

    for (const img of images) {
        try {
            if (!fs.existsSync(img.input)) {
                console.log(`⏭️  Skipping ${img.input} (not found)`);
                continue;
            }

            const inputSize = fs.statSync(img.input).size;

            await sharp(img.input)
                .webp({ quality: 85 })
                .toFile(img.output);

            const outputSize = fs.statSync(img.output).size;
            const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1);

            console.log(`✅ ${path.basename(img.input)}`);
            console.log(`   ${(inputSize / 1024).toFixed(0)} KB → ${(outputSize / 1024).toFixed(0)} KB (${reduction}% reduction)\n`);
        } catch (err) {
            console.error(`❌ Error converting ${img.input}:`, err.message);
        }
    }

    console.log('✨ WebP conversion complete!');
}

convertToWebP();
