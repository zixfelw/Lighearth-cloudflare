const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Find all PNG files excluding already converted ones
const findPngs = () => {
    const result = execSync('Get-ChildItem -Path . -Recurse -Filter *.png | Where-Object { $_.DirectoryName -notmatch "node_modules|\\.git" } | Select-Object -ExpandProperty FullName', {
        shell: 'powershell',
        encoding: 'utf8',
        cwd: process.cwd()
    });
    return result.trim().split('\n').filter(f => f.trim()).map(f => f.trim());
};

async function convertAllToWebP() {
    console.log('🚀 Converting ALL PNG files to WebP...\n');

    const pngFiles = findPngs();
    let totalSaved = 0;
    let converted = 0;

    for (const pngPath of pngFiles) {
        try {
            const webpPath = pngPath.replace(/\.png$/i, '.webp');

            // Skip if webp already exists
            if (fs.existsSync(webpPath)) {
                console.log(`⏭️  Skip (exists): ${path.basename(pngPath)}`);
                continue;
            }

            const inputSize = fs.statSync(pngPath).size;

            await sharp(pngPath)
                .webp({ quality: 85 })
                .toFile(webpPath);

            const outputSize = fs.statSync(webpPath).size;
            const saved = inputSize - outputSize;
            totalSaved += saved;
            converted++;

            const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1);
            console.log(`✅ ${path.basename(pngPath)}: ${(inputSize / 1024).toFixed(0)}KB → ${(outputSize / 1024).toFixed(0)}KB (${reduction}%)`);
        } catch (err) {
            console.error(`❌ ${path.basename(pngPath)}: ${err.message}`);
        }
    }

    console.log(`\n✨ Done! Converted ${converted} files, saved ${(totalSaved / 1024).toFixed(0)} KB total`);
}

convertAllToWebP();
