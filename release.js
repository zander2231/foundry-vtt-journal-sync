// scripts/release.js
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const archiver = require('archiver');
const readline = require('readline');  // Module for user interaction

// Read module.json file
const moduleJsonPath = 'module.json';
const moduleJson = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
const version = moduleJson.version;
const name = moduleJson.id;
const url = moduleJson.url;

// Helper functions
function execCommand(command) {
    try {
        execSync(command, { stdio: 'inherit' });
    } catch (error) {
        console.error(`Error executing command: ${command}`);
        process.exit(1);
    }
}

function updateVersionInFiles() {
    // Update package.json if it exists
    if (fs.existsSync('package.json')) {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        packageJson.version = version;
        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    }
}

// Function to create ZIP file
function createZip() {
    const zipPath = path.join(__dirname, `${name}.zip`);
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log(`File ${zipPath} deleted.`);
    }

    const zipName = 'journal-sync.zip';
    const output = fs.createWriteStream(zipName);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        console.log(`File ${zipName} created successfully (${archive.pointer()} bytes).`);
    });

    archive.on('error', (err) => {
        throw err;
    });

    archive.pipe(output);

    // Add required directories
    const foldersToAdd = ['lang', 'scripts', 'module'];
    for (const folder of foldersToAdd) {
        if (fs.existsSync(folder)) {
            archive.directory(folder, folder);
        }
    }

    archive.finalize();
}

// Function to request release name/description
function askReleaseInfo(callback) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Enter a name or description for the release: ', (info) => {
        rl.close();
        callback(info);  // Pass info to callback
    });
}

// Main
console.log(`Starting release of version ${version}...`);

// 1. Update versions in files
updateVersionInFiles();

// 2. Create new ZIP file
createZip();

// Request release information and execute commit with custom message
askReleaseInfo((info) => {
    const releaseMessage = `Release v${version} - ${info}`;

    // 4. Commit changes
    execCommand('git add .');
    execCommand(`git commit -m "${releaseMessage}"`);  // Commit with provided description

    // 5. Create and push tag
    execCommand(`git tag -a v${version} -m "${releaseMessage}"`);  // Tag with same message
    execCommand('git push');
    execCommand('git push --tags');

    execCommand(`gh release upload v${version} ${name}.zip CHANGELOG.md README.md module.json`);

    console.log(`${releaseMessage}`);
    console.log('GitHub Actions will automatically create the release with the files.');
    console.log(`Check progress at: ${url}/actions`);
});