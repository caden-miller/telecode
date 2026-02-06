// server.js - Complete version
const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY
});

// Project path mapping
const PROJECTS = {
    'gthrly': 'C:\\Users\\Caden\\Projects\\Gthrly',
    'trading-bot': 'C:\\Users\\Caden\\Projects\\trading-bot',
    'automation': 'C:\\Users\\Caden\\Projects\\automation'
};

// Store active sessions
const sessions = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running',
        activeSessions: sessions.size,
        projects: Object.keys(PROJECTS)
    });
});

// Main execution endpoint
app.post('/execute', async (req, res) => {
    const { prompt, project } = req.body;
    
    // Validate project
    if (!PROJECTS[project]) {
        return res.status(400).json({ 
            error: `Unknown project: ${project}. Available: ${Object.keys(PROJECTS).join(', ')}` 
        });
    }
    
    // Check if project already has active session
    if (sessions.has(project)) {
        return res.status(409).json({ 
            error: `Project ${project} already has an active session` 
        });
    }
    
    const sessionId = Date.now();
    
    // Initialize session
    sessions.set(project, {
        sessionId,
        startTime: Date.now(),
        output: [],
        filesModified: new Set(),
        currentPlan: '',
        lastSummary: Date.now()
    });
    
    // Respond immediately
    res.json({ 
        sessionId, 
        project,
        started: true 
    });
    
    // Start the task asynchronously
    runClaudeCodeWithMonitoring(project, prompt).catch(err => {
        console.error('Task failed:', err);
        sendTelegram(`❌ Task failed: ${err.message}`);
    });
});

// Run Claude Code with monitoring
async function runClaudeCodeWithMonitoring(project, prompt) {
    const session = sessions.get(project);
    const projectPath = PROJECTS[project];
    
    // Send initial message
    await sendTelegram(`🚀 Starting task: ${prompt}\n📁 Project: ${project}`);
    
    // Spawn Claude Code process
    const claudeProcess = spawn('claude-code', [
        prompt,
        '--project-dir', projectPath
    ], {
        shell: true,
        cwd: projectPath
    });
    
    let outputBuffer = '';
    
    // Capture stdout
    claudeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('[Claude Code]:', text);
        
        outputBuffer += text;
        session.output.push(text);
        
        // Parse output
        parseForFiles(text, session);
        parseForPlans(text, session);
    });
    
    // Capture stderr
    claudeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.error('[Claude Code Error]:', text);
        session.output.push(`[ERROR] ${text}`);
    });
    
    // Every 5 seconds, send summary
    const summaryInterval = setInterval(async () => {
        const now = Date.now();
        const timeSinceLastSummary = now - session.lastSummary;
        
        // Only send if there's new output and 5+ seconds passed
        if (outputBuffer.trim().length > 50 && timeSinceLastSummary >= 5000) {
            await sendSmartSummary(session, outputBuffer);
            outputBuffer = '';
            session.lastSummary = now;
        }
    }, 5000);
    
    // On completion
    claudeProcess.on('close', async (code) => {
        clearInterval(summaryInterval);
        
        console.log(`Claude Code exited with code ${code}`);
        
        // Generate final summary
        const finalSummary = await generateFinalSummary(session);
        
        if (code === 0) {
            await sendTelegram(`✅ Task complete!\n\n${finalSummary}`);
        } else {
            await sendTelegram(`⚠️ Task completed with errors (code ${code})\n\n${finalSummary}`);
        }
        
        // Cleanup
        sessions.delete(project);
    });
}

// Parse for file modifications
function parseForFiles(text, session) {
    // Common patterns Claude Code outputs
    const patterns = [
        /(?:Modified|Created|Updated|Edited):\s+([^\n]+)/gi,
        /Writing to:\s+([^\n]+)/gi,
        /Saved:\s+([^\n]+)/gi
    ];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const filename = match[1].trim();
            if (filename && !filename.includes('...')) {
                session.filesModified.add(filename);
            }
        }
    });
}

// Parse for plans/thinking
function parseForPlans(text, session) {
    const planIndicators = ['Plan:', 'Next:', 'Working on:', 'Now:', 'Step'];
    
    const lines = text.split('\n');
    for (const line of lines) {
        if (planIndicators.some(indicator => line.includes(indicator))) {
            session.currentPlan = line.trim();
        }
    }
}

// Send smart summary using Claude API
async function sendSmartSummary(session, recentOutput) {
    // Skip if API key not configured
    if (ANTHROPIC_API_KEY === 'YOUR_API_KEY_HERE') {
        console.log('[Skipping summary - no API key configured]');
        return;
    }
    
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
    
    const prompt = `Summarize this Claude Code session update in 2-3 concise bullet points.
Focus on: current action, files being modified, progress.
Be extremely brief - this is for quick mobile notifications.

Recent output:
${recentOutput.slice(-1000)} // Last 1000 chars

Files modified: ${Array.from(session.filesModified).slice(-5).join(', ') || 'none yet'}
Current plan: ${session.currentPlan || 'working...'}

Provide ONLY the bullet points, no preamble:`;

    try {
        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-20250514', // Cheapest model for summaries
            max_tokens: 150,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });
        
        const summary = message.content[0].text;
        await sendTelegram(`📝 Update (${elapsed}s)\n${summary}`);
        
    } catch (error) {
        console.error('Summary generation failed:', error.message);
        // Fall back to simple update
        const fileCount = session.filesModified.size;
        await sendTelegram(`📝 Update (${elapsed}s)\n• Working... (${fileCount} files modified)`);
    }
}

// Generate final summary
async function generateFinalSummary(session) {
    // Skip if API key not configured
    if (ANTHROPIC_API_KEY === 'YOUR_API_KEY_HERE') {
        const fileCount = session.filesModified.size;
        const files = Array.from(session.filesModified).join(', ');
        return `Modified ${fileCount} file(s): ${files}`;
    }
    
    const fullOutput = session.output.join('\n');
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
    
    const prompt = `Summarize this completed Claude Code session in 3-5 clear bullet points.
Include: what was accomplished, files modified, any notable issues.

Session output (last 3000 chars):
${fullOutput.slice(-3000)}

Files modified: ${Array.from(session.filesModified).join(', ') || 'none'}
Duration: ${elapsed} seconds

Provide a clear summary:`;

    try {
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });
        
        return message.content[0].text;
    } catch (error) {
        console.error('Final summary generation failed:', error.message);
        const fileCount = session.filesModified.size;
        const files = Array.from(session.filesModified).join(', ');
        return `Task completed in ${elapsed}s. Modified ${fileCount} file(s): ${files}`;
    }
}

// Send message to Telegram
async function sendTelegram(message) {
    // Skip if not configured
    if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
        console.log('[Would send to Telegram]:', message);
        return;
    }
    
    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            }
        );
    } catch (error) {
        console.error('Failed to send Telegram message:', error.message);
    }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Claude Code service running on port ${PORT}`);
    console.log(`📁 Available projects:`, Object.keys(PROJECTS));
    console.log(`🔧 Telegram configured:`, TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE');
    console.log(`🤖 Claude API configured:`, ANTHROPIC_API_KEY !== 'YOUR_API_KEY_HERE');
});