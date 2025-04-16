const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');
const fs = require("fs");
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('@electron/remote/main').initialize();
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

let mainWindow, secondWindow, consoleWindow, downloadWindow;
const configPath = "./config.json";

const server = express();
const PORT = 3000;

server.use(express.static(path.join(__dirname, '/')));

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function readConfig() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return config;
    } catch (error) {
        console.error('Error reading config file:', error);
        return { debug: false };
    }
}

const config = readConfig();
const showConsole = config.debug;

function spawnConsole() {
    if (showConsole) {
        console.log("Console window will be visible");

        if (!consoleWindow) {
            createConsoleWindow();
        }
        
        console.log = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'log', message: logMessage });
            }
            logToFile('log', args);
            originalLog(...args);
        };

        console.warn = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'warn', message: logMessage });
            }
            logToFile('log', args);
            originalWarn(...args);
        };

        console.error = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'error', message: logMessage });
            }
            logToFile('log', args);
            originalError(...args);
        };

        console.trace = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'trace', message: logMessage });
            }
            logToFile('log', args);
            originalError(...args);
        };

        console.success = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'success', message: logMessage });
            }
            logToFile('log', args);
            originalError(...args);
        };

        console.info = function (...args) {
            const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            if (consoleWindow && !consoleWindow.isDestroyed()) {
                consoleWindow.webContents.send('new-log', { level: 'info', message: logMessage });
            }
            logToFile('log', args);
            originalError(...args);
        };
    } else {
        console.log = function (...args) {
            logToFile('log', args);
            originalLog(...args);
        };
        
        console.warn = function (...args) {
            logToFile('log', args);
            originalWarn(...args);
        };
        
        console.error = function (...args) {
            logToFile('log', args);
            originalError(...args);
        };        
    }
}

// Add these variables to track download status
let downloadStartTime = 0;
let currentDownloadingFile = '';

const compareFileHash = async (existingFilePath, remoteFileUrl) => {
    try {
        if (fs.existsSync(existingFilePath)) {
            const localHash = await generateFileHash(existingFilePath);
            console.trace(`[Updater]: Local file hash for ${getFileNameFromPath(existingFilePath)}: ${localHash}`);

            const buffer = await fetchFileBuffer(remoteFileUrl);
            const remoteHash = crypto.createHash('sha256').update(buffer).digest('hex');
            console.trace(`[Updater]: Remote file hash for ${getFileNameFromUrl(remoteFileUrl)}: ${remoteHash}`);

            if (localHash === remoteHash) {
                console.trace(`[Updater]: File is up-to-date: ${getFileNameFromPath(existingFilePath)}`);
            } else {
                console.warn(`[Updater]: File needs to be updated: ${getFileNameFromPath(existingFilePath)}`);
                return true;
            }
        } else {
            console.warn(`[Updater]: Local file not found: ${getFileNameFromPath(existingFilePath)}`);
            return true;
        }
    } catch (error) {
        console.error('[Updater]: Error comparing hashes:', error);
    }
    return false;
};

const generateFileHash = (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
};

function getFormattedDateTime() {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // yyyy-mm-dd
    const hour = now.getHours().toString().padStart(2, '0'); // hh
    const minute = now.getMinutes().toString().padStart(2, '0'); // mm
    const second = now.getSeconds().toString().padStart(2, '0'); // ss
    const time = `${hour}:${minute}:${second}`;
    return { date, time };
}

const logToFile = (level, args) => {
    const { date, time } = getFormattedDateTime();
    const logFilePath = `./Logs/${level.toUpperCase()}_${date}_${time.split(":")[0]}.txt`;

    const header = `
/*
      Log file from: ${date}
      Modified at: ${time}
      -----------------------------------------------------------
      This file contains logs generated by the application.
      -----------------------------------------------------------
*/

`;

    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, header, 'utf8');
    }

    const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');

    fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
};

server.use((req, res, next) => {
    console.log('[BFHacks]: Request for:', req.url);
    next();
});

server.listen(PORT, () => {
    console.info(`[BFHacks]: Server running at http://localhost:${PORT}`);
});

let downloadedFiles = 0;
let downloadedBytes = 0;
let totalFileSize = 0;
let totalFiles = 0;

const getFileNameFromUrl = (url) => {
    try {
        const parsedUrl = new URL(url);
        const fileName = parsedUrl.pathname.split('/').pop();
        return fileName;
    } catch (error) {
        console.error("Invalid URL:", error);
        return null;
    }
};

async function getFileSize(url) {
    try {
        const headResponse = await new Promise((resolve, reject) => {
            const req = https.request(url, { method: 'HEAD' }, resolve);
            req.on('error', reject);
            req.end();
        });

        const size = headResponse.headers['content-length'];
        if (size && Number.isFinite(parseInt(size, 10))) {
            return parseInt(size, 10);
        }

        console.warn(`[Updater]: Content-Length missing for ${url}, fetching file to determine size`);
        const buffer = await fetchFileBuffer(url);
        return buffer.length;
    } catch (error) {
        return 0;
    }
}

function downloadFile(url, dest, filename) {
    console.log(`[Updater]: Downloading`, `"${filename}"`);

    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
        const fileSize = response.headers['content-length'] ? parseInt(response.headers['content-length'], 10) : 0;
        totalFileSize += fileSize;

        response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            updateDownloadProgress();
        });

        response.pipe(file);
        file.on('finish', () => {
            file.close();
            downloadedFiles++;
            console.log(`[Updater]: Downloaded`, `"${filename}"`);
            updateDownloadProgress();
        });
    }).on('error', (err) => {
        fs.unlink(dest, () => {});
        console.error(`[Updater]: Error downloading ${filename}:`, err.message);
    });
}

const fetchFileBuffer = (url) => {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });
            response.on('error', (err) => reject(err));
        });
    });
};

const getFileNameFromPath = (filePath) => {
    try {
        const fileName = path.basename(filePath);
        return fileName;
    } catch (error) {
        console.error("Error extracting file name:", error);
        return null;
    }
};

async function extractGameFiles() {
    const folderPath = './bf-build';
    const extractedPath = './bf-build/extracted';
    
    if (!fs.existsSync(extractedPath)) {
        fs.mkdirSync(extractedPath, { recursive: true });
    }
    
    console.info('[BFHacks]: Extracting game files...');
    
    try {
        if (fs.existsSync('./bf-build/game.data.gz')) {
            const compressedData = fs.readFileSync('./bf-build/game.data.gz');
            const decompressedData = await gunzip(compressedData);
            fs.writeFileSync('./bf-build/extracted/game.data', decompressedData);
            console.success('[BFHacks]: Extracted game.data');
            
            if (downloadWindow && !downloadWindow.isDestroyed()) {
                downloadWindow.webContents.send('extraction-progress', {
                    file: 'game.data.gz',
                    status: 'complete'
                });
            }
        }
        
        if (fs.existsSync('./bf-build/game.wasm.gz')) {
            const compressedWasm = fs.readFileSync('./bf-build/game.wasm.gz');
            const decompressedWasm = await gunzip(compressedWasm);
            fs.writeFileSync('./bf-build/extracted/game.wasm', decompressedWasm);
            console.success('[BFHacks]: Extracted game.wasm');
            
            if (downloadWindow && !downloadWindow.isDestroyed()) {
                downloadWindow.webContents.send('extraction-progress', {
                    file: 'game.wasm.gz',
                    status: 'complete'
                });
            }
        }
        
        if (fs.existsSync('./bf-build/game.framework.js.gz')) {
            const compressedFramework = fs.readFileSync('./bf-build/game.framework.js.gz');
            const decompressedFramework = await gunzip(compressedFramework);
            fs.writeFileSync('./bf-build/extracted/game.framework.js', decompressedFramework);
            console.success('[BFHacks]: Extracted game.framework.js');
            
            if (downloadWindow && !downloadWindow.isDestroyed()) {
                downloadWindow.webContents.send('extraction-progress', {
                    file: 'game.framework.js.gz',
                    status: 'complete'
                });
            }
        }
        
        if (fs.existsSync('./bf-build/game.loader.js')) {
            fs.copyFileSync(
                './bf-build/game.loader.js', 
                './bf-build/extracted/game.loader.js'
            );
            console.success('[BFHacks]: Copied game.loader.js');
        }
        
        return true;
    } catch (error) {
        console.error('[BFHacks]: Error extracting game files:', error);
        return false;
    }
}

function updateDownloadProgress() {
    let progress = 0;
    
    if (totalFiles > 0) {
        progress = (downloadedFiles / totalFiles) * 100;
    } else if (totalFileSize > 0) {
        progress = (downloadedBytes / totalFileSize) * 100;
    }
    
    if (downloadWindow && !downloadWindow.isDestroyed()) {
        downloadWindow.webContents.send('update-download-progress', progress);
        
        const now = Date.now();
        const elapsedTime = (now - downloadStartTime) / 1000;
        if (elapsedTime > 0) {
            const speedInBytesPerSec = downloadedBytes / elapsedTime;
            const speedInMBPerSec = (speedInBytesPerSec / (1024 * 1024)).toFixed(2);
            
            downloadWindow.webContents.send('download-stats', {
                speed: `${speedInMBPerSec} MB/s`,
                eta: calculateETA(totalFileSize - downloadedBytes, speedInBytesPerSec),
                currentFile: currentDownloadingFile || 'Initializing...'
            });
        }
    }
    
    if (downloadedFiles === totalFiles) {
        console.success('[BFHacks]: All files downloaded, setting up game environment...');
        
        if (downloadWindow && !downloadWindow.isDestroyed()) {
            downloadWindow.webContents.send('download-status', { status: 'complete' });
        }
        
        setupGameEnvironment().then(() => {
            console.success('[BFHacks]: Game environment ready, launching main window...');
            
            setTimeout(() => {
                createMainWindow();
                mainWindow.webContents.on('did-finish-load', () => {
                    console.log('[BFHacks]: mainWindow loaded, creating secondWindow');
                    createSecondWindow();
                });
                
                setTimeout(() => {
                    if (downloadWindow && !downloadWindow.isDestroyed()) {
                        downloadWindow.close();
                    }
                }, 2000);
            }, 1000);
        });
    }
}

function downloadFile(url, dest, filename) {
    return new Promise((resolve, reject) => {
        console.log(`[Updater]: Downloading "${filename}"`);
        currentDownloadingFile = filename;
        
        if (!downloadStartTime) {
            downloadStartTime = Date.now();
        }
        
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            const fileSize = parseInt(response.headers['content-length'], 10);
            let downloadedFileBytes = 0;
            
            totalFileSize += fileSize;
            
            if (downloadWindow && !downloadWindow.isDestroyed()) {
                downloadWindow.webContents.send('file-status', {
                    filename: filename,
                    size: getFileSize(fileSize),
                    status: 'downloading'
                });
            }
            
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                downloadedFileBytes += chunk.length;
                
                const fileProgress = fileSize ? (downloadedFileBytes / fileSize) * 100 : 0;
                
                if (downloadWindow && !downloadWindow.isDestroyed()) {
                    downloadWindow.webContents.send('file-progress', {
                        filename: filename,
                        progress: fileProgress.toFixed(1)
                    });
                }
                
                updateDownloadProgress();
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                downloadedFiles++;
                console.log(`[Updater]: Downloaded "${filename}"`);
                
                if (downloadWindow && !downloadWindow.isDestroyed()) {
                    downloadWindow.webContents.send('file-status', {
                        filename: filename,
                        status: 'complete'
                    });
                }
                
                updateDownloadProgress();
                resolve();
            });
            
            response.on('error', (err) => {
                fs.unlink(dest, () => {});
                console.error(`[Updater]: Error downloading ${filename}:`, err.message);
                
                if (downloadWindow && !downloadWindow.isDestroyed()) {
                    downloadWindow.webContents.send('file-status', {
                        filename: filename,
                        status: 'error',
                        error: err.message
                    });
                }
                
                reject(err);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            console.error(`[Updater]: Error downloading ${filename}:`, err.message);
            
            if (downloadWindow && !downloadWindow.isDestroyed()) {
                downloadWindow.webContents.send('file-status', {
                    filename: filename,
                    status: 'error',
                    error: err.message
                });
            }
            
            reject(err);
        });
    });
}

function calculateETA(remainingBytes, bytesPerSecond) {
    if (bytesPerSecond <= 0) return 'calculating...';
    
    const seconds = Math.floor(remainingBytes / bytesPerSecond);
    
    if (seconds < 60) {
        return `${seconds}s remaining`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')} remaining`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}:${minutes.toString().padStart(2, '0')} remaining`;
    }
}

function formatFileSize(bytes, decimals = 1) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return 'Unknown size';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

async function setupGameEnvironment() {
    console.success('[BFHacks]: Game environment setup complete');
    return true;
}

const fetchLoaderOptions = async () => {
    try {
        totalFiles = 4;
        downloadedFiles = 0;
        totalFileSize = 0;
        downloadedBytes = 0;
        downloadStartTime = Date.now();

        if (!downloadWindow || downloadWindow.isDestroyed()) {
            console.warn('[Updater]: Download window not available, recreating...');
            createDownloadWindow();
        }

        const response = await fetch('https://games.crazygames.com/en_US/bullet-force-multiplayer/index.html');
        const html = await response.text();

        let loaderOptions = JSON.parse(html.split(`"loaderOptions":`)[1].split(`,"thumbnail":`)[0]);

        console.success(`[Updater]: Loader options found!`);
        console.success(JSON.stringify(loaderOptions, null, 2));
        console.info(`[Updater]: Downloading game files...`);

        const folderPath = './bf-build';
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const loaderSize = await getFileSize(loaderOptions.unityLoaderUrl);
        const wasmSize = await getFileSize(loaderOptions.unityConfigOptions.codeUrl);
        const dataSize = await getFileSize(loaderOptions.unityConfigOptions.dataUrl);
        const frameworkSize = await getFileSize(loaderOptions.unityConfigOptions.frameworkUrl);

        if (downloadWindow && !downloadWindow.isDestroyed()) {
            try {
                downloadWindow.webContents.send('init-download', {
                    files: [
                        { name: 'game.loader.js', size: formatFileSize(loaderSize) },
                        { name: 'game.wasm.gz', size: formatFileSize(wasmSize) },
                        { name: 'game.data.gz', size: formatFileSize(dataSize) },
                        { name: 'game.framework.js.gz', size: formatFileSize(frameworkSize) }
                    ],
                    totalFiles: totalFiles
                });
            } catch (err) {
                console.error('[Updater]: Failed to send init-download:', err.message);
            }
        }

        const filesToDownload = [
            { url: loaderOptions.unityLoaderUrl, dest: './bf-build/game.loader.js', name: 'game.loader.js' },
            { url: loaderOptions.unityConfigOptions.codeUrl, dest: './bf-build/game.wasm.gz', name: 'game.wasm.gz' },
            { url: loaderOptions.unityConfigOptions.dataUrl, dest: './bf-build/game.data.gz', name: 'game.data.gz' },
            { url: loaderOptions.unityConfigOptions.frameworkUrl, dest: './bf-build/game.framework.js.gz', name: 'game.framework.js.gz' }
        ];

        for (const file of filesToDownload) {
            const needsUpdate = await compareFileHash(file.dest, file.url);
            if (needsUpdate) {
                await downloadFile(file.url, file.dest, file.name);
            } else {
                console.log(`[Updater]: ${file.name} is up-to-date, skipping download`);
                downloadedFiles++;
                const stats = await fs.promises.stat(file.dest);
                totalFileSize += stats.size;
                updateDownloadProgress();
            }
        }
    } catch (error) {
        console.error('[Updater]: Error fetching or downloading files:', error);
        if (downloadWindow && !downloadWindow.isDestroyed()) {
            try {
                downloadWindow.webContents.send('download-status', {
                    status: 'error',
                    message: 'Failed: ' + error.message
                });
            } catch (err) {
                console.error('[Updater]: Failed to send download-status:', err.message);
            }
        }
    }
};

function createDownloadWindow() {
    downloadWindow = new BrowserWindow({
        width: 1450,
        height: 600,
        title: 'Downloading...',
        frame: false,
        transparent: true,
        icon: './assets/icon.ico',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    downloadWindow.loadFile('./download.html');

    downloadWindow.on('closed', () => {
        downloadWindow = null;
    });
}

function createConsoleWindow() {
    consoleWindow = new BrowserWindow({
        width: 1450,
        height: 600, 
        title: 'Debug Console',
        frame: false,
        transparent: true,
        modal: false,
        show: true,
        focusable: true,
        skipTaskbar: false,        
        icon: './assets/icon.ico',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    consoleWindow.loadFile('./console.html');
    consoleWindow.setAlwaysOnTop(false);

    consoleWindow.on('closed', () => {
        consoleWindow = null;
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1861,
        height: 945,
        frame: false,
        transparent: true,
        icon: './assets/icon.ico',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webSecurity: false,
            preload: path.join(__dirname, 'indexPreload.js')
        }
    });

    console.log('[BFHacks]: Loading mainWindow with URL:', `http://localhost:${PORT}/index.html`);
    mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[BFHacks]: mainWindow finished loading');
    });

    ipcMain.on("minimize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window.minimize();
    });

    ipcMain.on("maximize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
    });
      
    ipcMain.on("close-window", (event, options) => {
        const loginWindow = BrowserWindow.fromWebContents(event.sender);
        loginWindow.close();
    });

    ipcMain.on('player-list-update', (event, playerList) => {
        mainWindow.webContents.send('update-player-list', playerList);
    });

    ipcMain.on('checkbox-toggle', (event, options) => {
        mainWindow.webContents.send('checkbox-toggle-update', options);
    });

    ipcMain.on('button-press', (event, options) => {
        mainWindow.webContents.send('button-press-update', options);
    });

    ipcMain.on('player-list-clear', (event) => {
        mainWindow.webContents.send('clear-player-list');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[BFHacks]: mainWindow failed to load:', errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
        console.log('[BFHacks]: mainWindow closed');
        mainWindow = null;
    });
}

function createSecondWindow() {
    secondWindow = new BrowserWindow({
        width: 1920 / 1.5,
        height: 1080 / 1.5,
        frame: false,
        transparent: true,
        icon: './assets/icon.ico',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webSecurity: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    console.log('[BFHacks]: Loading secondWindow with URL:', `http://localhost:${PORT}/game.html`);
    secondWindow.loadURL(`http://localhost:${PORT}/game.html`);

    secondWindow.webContents.on('did-finish-load', () => {
        console.success('[BFHacks]: secondWindow finished loading');
        secondWindow.webContents.executeJavaScript('window.mainWindowReady = true; console.log("mainWindowReady set to true");')
            .catch(err => console.error('[BFHacks]: Error setting mainWindowReady:', err));
    });

    ipcMain.on("minimize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window.minimize();
    });

    ipcMain.on("maximize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
    });
      
    ipcMain.on("close-window", (event, options) => {
        const loginWindow = BrowserWindow.fromWebContents(event.sender);
        loginWindow.close();
    });

    secondWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[BFHacks]: secondWindow failed to load:', errorCode, errorDescription);
    });
}

let loginWindow;

function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 1920 / 1.5,
        height: 1080 / 1.5,
        frame: false,
        transparent: true,
        icon: './assets/icon.ico',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webSecurity: false
        }
    });

    loginWindow.loadURL(`http://localhost:${PORT}/login.html`);

    ipcMain.on("minimize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window.minimize();
    });

    ipcMain.on("maximize-window", (event, options) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
    });
      
    ipcMain.on("close-window", (event, options) => {
        const loginWindow = BrowserWindow.fromWebContents(event.sender);
        loginWindow.close();
    });

    ipcMain.on('login-success', (event, options) => {
        setTimeout(() => {
            loginWindow.close();
            createDownloadWindow();

            fetchLoaderOptions();
        })
    });
}

ipcMain.handle('add-to-request-list', async (event, requestText) => {
    console.trace('[BFHacks]: IPC add-to-request-list called with:', requestText);
    if (mainWindow && !mainWindow.isDestroyed()) {
        const code = `
            requestList = document.getElementById('requestList');
            if (requestList) {
                const option = document.createElement('option');
                option.text = '${requestText.replace(/'/g, "\\'")}';
                option.dataset.originalText = '${requestText.replace(/'/g, "\\'")}';
                requestList.add(option);
                requestList.scrollTop = requestList.scrollHeight;
                console.log('[BFHacks]: Main window added to requestList:', '${requestText.replace(/'/g, "\\'")}');
            } else {
                console.log('[BFHacks]: requestList not found in mainWindow');
            }
        `;
        await mainWindow.webContents.executeJavaScript(code);
        return true;
    } else {
        console.log('mainWindow not available');
        return false;
    }
});

ipcMain.handle('update-request-list', async (event, originalText, updatedText) => {
    console.info('[BFHacks]: IPC update-request-list called, original:', originalText, 'updated:', updatedText);
    if (mainWindow && !mainWindow.isDestroyed()) {
        const code = `
            requestList = document.getElementById('requestList');
            if (requestList) {
                let updated = false;
                for (let i = 0; i < requestList.options.length; i++) {
                    if (requestList.options[i].dataset.originalText === '${originalText}') {
                        requestList.options[i].text = '${updatedText}';
                        requestList.scrollTop = requestList.scrollHeight;
                        console.log('[BFHacks]: Main window updated requestList:', '${originalText}', 'to', '${updatedText}');
                        updated = true;
                    }
                }
                if (!updated) {
                    console.log('[BFHacks]: No matching entry found for:', '${originalText}');
                }
            } else {
                console.log('[BFHacks]: requestList not found in mainWindow');
            }
        `;
        await mainWindow.webContents.executeJavaScript(code);
        return true;
    } else {
        console.log('[BFHacks]: mainWindow not available');
        return false;
    }
});

app.whenReady().then(() => {
    if (showConsole) {
        spawnConsole();
        require('@electron/remote/main').enable(consoleWindow.webContents);
        console.log('[BFHacks]: Debug mode is ON. Console will be visible.');
    } else {
        console.log('[BFHacks]: Debug mode is OFF. Console will not be visible.');
    }

    console.log('[BFHacks]: App is ready, creating downloadWindow');

    createLoginWindow();
});