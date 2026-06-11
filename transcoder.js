// transcoder.js — Async Video Transcoder Queue
// Dispatches ffmpeg subprocess jobs. Phase 2: adds retry logic with exponential back-off.

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, 'transcoded');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 8000, 32000]; // exponential back-off

// Job queue
const queue = [];
const activeJobs = new Map(); // jobId -> jobInfo

let broadcastCallback = null;

function setBroadcastCallback(fn) {
    broadcastCallback = fn;
}

function broadcast(message) {
    if (broadcastCallback) broadcastCallback(message);
}

// ----------------------------------------------------------------
// ADD JOB TO QUEUE
// ----------------------------------------------------------------
function addToQueue(fileId, originalName, inputPath, retryCount = 0) {
    const job = {
        id: fileId,
        filename: originalName,
        inputPath,
        status: 'queued',
        progress: 0,
        retryCount,
        createdAt: Date.now()
    };

    queue.push(job);
    activeJobs.set(fileId, job);

    console.log(`TRANSCODER: Job queued — [${originalName}] (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });

    // Process next if not already running
    processNext();

    return job;
}

// ----------------------------------------------------------------
// PROCESS NEXT JOB IN QUEUE
// ----------------------------------------------------------------
let isProcessing = false;

function processNext() {
    if (isProcessing || queue.length === 0) return;

    const job = queue.shift();
    isProcessing = true;

    job.status = 'processing';
    job.progress = 0;
    activeJobs.set(job.id, job);
    broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });

    const outputFilename = `${job.id}_${path.basename(job.filename, path.extname(job.filename))}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // Determine if ffmpeg is available
    const ffmpegAvailable = checkFfmpegAvailable();
    if (!ffmpegAvailable) {
        job.status = 'error';
        job.error = 'ffmpeg not found on PATH. Install ffmpeg to enable transcoding.';
        activeJobs.set(job.id, job);
        broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });
        isProcessing = false;
        processNext();
        return;
    }

    const ffmpegArgs = [
        '-i', job.inputPath,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        outputPath
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';

    ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // Parse progress from ffmpeg output
        const timeMatch = stderr.match(/time=(\d{2}:\d{2}:\d{2})/g);
        if (timeMatch && timeMatch.length > 0) {
            const lastTime = timeMatch[timeMatch.length - 1].replace('time=', '');
            job.progress = Math.min(95, estimateProgress(lastTime));
            activeJobs.set(job.id, job);
            broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });
        }
    });

    ffmpegProcess.on('close', (code) => {
        isProcessing = false;

        if (code === 0) {
            // Success
            job.status = 'done';
            job.progress = 100;
            job.outputFile = `/transcoded/${outputFilename}`;
            activeJobs.set(job.id, job);
            console.log(`TRANSCODER: Job complete — [${job.filename}] -> ${outputFilename}`);
            broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });

            // Cleanup input file
            try { fs.unlinkSync(job.inputPath); } catch {}
        } else {
            // Failed — check if we should retry
            console.error(`TRANSCODER: Job failed [${job.filename}] (code ${code}). Retry count: ${job.retryCount}`);

            if (job.retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAYS_MS[job.retryCount] || 30000;
                const nextRetry = job.retryCount + 1;

                job.status = 'retrying';
                job.error = `Attempt ${job.retryCount + 1} failed. Retrying in ${delay / 1000}s...`;
                activeJobs.set(job.id, job);
                broadcast({ type: 'TRANSCODER_RETRY', payload: { ...job, retryIn: delay } });

                console.log(`TRANSCODER: Scheduling retry ${nextRetry}/${MAX_RETRIES} for [${job.filename}] in ${delay}ms`);
                setTimeout(() => {
                    addToQueue(job.id, job.filename, job.inputPath, nextRetry);
                }, delay);
            } else {
                // All retries exhausted
                job.status = 'failed';
                job.error = `Transcoding failed after ${MAX_RETRIES + 1} attempts.`;
                activeJobs.set(job.id, job);
                broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });
                console.error(`TRANSCODER: Job permanently failed — [${job.filename}]`);

                // Cleanup failed input
                try { fs.unlinkSync(job.inputPath); } catch {}
            }
        }

        processNext();
    });

    ffmpegProcess.on('error', (err) => {
        isProcessing = false;
        job.status = 'error';
        job.error = err.message;
        activeJobs.set(job.id, job);
        broadcast({ type: 'TRANSCODER_UPDATE', payload: { ...job } });
        console.error(`TRANSCODER: ffmpeg spawn error:`, err.message);
        processNext();
    });
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------
function estimateProgress(timeStr) {
    // Simple time-string to percentage (assumes max 60-min video)
    const parts = timeStr.split(':').map(Number);
    const seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    return Math.floor((seconds / 3600) * 100);
}

function checkFfmpegAvailable() {
    try {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function getTranscoderStatus() {
    return {
        queueLength: queue.length,
        isProcessing,
        jobs: [...activeJobs.values()].map(j => ({
            id: j.id,
            filename: j.filename,
            status: j.status,
            progress: j.progress,
            retryCount: j.retryCount,
            error: j.error || null,
            outputFile: j.outputFile || null
        }))
    };
}

module.exports = { addToQueue, getTranscoderStatus, setBroadcastCallback };
