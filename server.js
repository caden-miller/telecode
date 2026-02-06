// server.js - Enhanced with GitHub workflow and security
require('dotenv').config();

const express = require('express');
const { spawn, execSync } = require('child_process');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
app.use(express.json());

// Add debug logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Body:', req.body);
    next();
});

// Configuration from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

// Parse projects from environment
let PROJECTS = {};

Object.keys(process.env).forEach(key => {
    if (key.startsWith('PROJECT_')) {
        const projectKey = key.replace('PROJECT_', '').toLowerCase().replace(/_/g, '-');
        PROJECTS[projectKey] = process.env[key];
    }
});

if (Object.keys(PROJECTS).length === 0) {
    console.error('❌ No projects defined in .env');
    console.error('   Add PROJECT_* variables to your .env file');
    process.exit(1);
}

// Validate required environment variables
const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('   Copy .env.example to .env and fill in your values');
    process.exit(1);
}

const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY
});

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
    let { prompt, project, issue, raw_command } = req.body;
    let branchType = null; // 'feature' or 'fix'
    let issueNumber = null; // For fix/123 format
    
    // If raw_command is provided, parse it
    if (raw_command) {
        console.log('Parsing raw command:', raw_command);
        
        const commandText = raw_command.replace(/^\/code\s+/, '').trim();
        
        if (!commandText) {
            return res.status(400).json({ 
                error: 'Invalid command format. Use: /code <project> <type> | <prompt/issue>' 
            });
        }
        
        const parts = commandText.split('|');
        const projectAndType = parts[0].trim();
        const afterPipe = parts.length > 1 ? parts[1].trim() : '';
        
        const words = projectAndType.split(/\s+/);
        project = words[0];
        const typeOrPrompt = words[1]; // Either 'feature', 'fix', or start of prompt
        
        // Check if second word is 'feature' or 'fix'
        if (typeOrPrompt === 'feature' || typeOrPrompt === 'fix') {
            branchType = typeOrPrompt;
            
            if (typeOrPrompt === 'fix') {
                // Format: /code project fix | 1
                // The issue number is after the pipe
                issueNumber = afterPipe;
                prompt = `Fix issue #${issueNumber}`;
                issue = `Issue #${issueNumber}`; // Will fetch from GitHub if available
            } else {
                // Format: /code project feature | implement dark mode
                prompt = afterPipe || 'implement feature';
                issue = afterPipe; // Use as context
            }
        } else {
            // Original format: /code project do something | issue context
            prompt = words.slice(1).join(' ') || 'list files';
            issue = afterPipe;
        }
        
        console.log('✅ Parsed - Project:', project, '| Type:', branchType, '| Prompt:', prompt, '| Issue:', issueNumber || issue);
    }
    
    // Validate project
    if (!PROJECTS[project]) {
        console.error(`❌ Unknown project: ${project}. Available:`, Object.keys(PROJECTS));
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
        lastSummary: Date.now(),
        issue: issue || null,
        issueNumber: issueNumber || null,
        branchType: branchType || null,
        branchName: null,
        prUrl: null
    });
    
    // Respond immediately
    res.json({ 
        sessionId, 
        project,
        prompt,
        started: true 
    });
    
    console.log(`🎯 Starting Claude Code for project: ${project}`);
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`🏷️ Type: ${branchType || 'auto-detect'}`);
    console.log(`📋 Issue: ${issueNumber || issue || 'none'}`);
    
    // Start the autonomous workflow
    runAutonomousWorkflow(project, prompt, issue, branchType, issueNumber).catch(err => {
        console.error('Workflow failed:', err);
        sendTelegram(`❌ Workflow failed: ${err.message}`);
        sessions.delete(project);
    });
});

// Autonomous workflow - UPDATED SIGNATURE
async function runAutonomousWorkflow(project, prompt, issue, branchType, issueNumber) {
    const session = sessions.get(project);
    const projectPath = PROJECTS[project];
    
    try {
        // Fetch issue details from GitHub if issue number provided
        if (issueNumber && GITHUB_TOKEN) {
            const issueDetails = await fetchGitHubIssue(projectPath, issueNumber);
            if (issueDetails) {
                issue = issueDetails.body;
                prompt = `Fix issue #${issueNumber}: ${issueDetails.title}`;
                session.issue = issue;
                console.log(`📋 Fetched issue #${issueNumber}: ${issueDetails.title}`);
            }
        }
        
        // Step 1: Create feature/fix branch
        const branchName = createBranch(projectPath, prompt, issue, branchType, issueNumber);
        session.branchName = branchName;
        
        await sendTelegram(
            `🚀 Starting autonomous workflow\n` +
            `📁 Project: ${project}\n` +
            `🌿 Branch: ${branchName}\n` +
            `${issueNumber ? `🔢 Issue: #${issueNumber}\n` : ''}` +
            `${issue && !issueNumber ? `📋 Context: ${issue.substring(0, 100)}...\n` : ''}` +
            `🎯 Task: ${prompt}`
        );
        
        // Step 2: Build enhanced prompt with issue context
        const enhancedPrompt = buildEnhancedPrompt(prompt, issue, issueNumber);
        
        // Step 3: Run Claude Code
        await runClaudeCodeWithMonitoring(project, enhancedPrompt, projectPath);
        
        // Step 4: Check if changes were made
        const hasChanges = checkForChanges(projectPath);
        
        if (!hasChanges) {
            await sendTelegram(`ℹ️ No changes made - task may have completed without modifications`);
            const mainBranch = getMainBranch(projectPath);
            execSync(`git checkout ${mainBranch}`, { cwd: projectPath });
            execSync(`git branch -D ${branchName}`, { cwd: projectPath });
            sessions.delete(project);
            return;
        }
        
        // Step 5: Commit changes
        await commitChanges(projectPath, prompt, issue, issueNumber, session);
        await sendTelegram(`✅ Changes committed`);
        
        // Step 6: Push branch
        await pushBranch(projectPath, branchName);
        await sendTelegram(`✅ Pushed to origin/${branchName}`);
        
        // Step 7: Create Pull Request
        const prUrl = await createPullRequest(projectPath, branchName, prompt, issue, issueNumber, session);
        session.prUrl = prUrl;
        
        // Final summary
        const fileCount = session.filesModified.size;
        const files = Array.from(session.filesModified).slice(0, 5).join(', ');
        const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
        
        await sendTelegram(
            `\n🎉 Workflow Complete!\n\n` +
            `📝 Modified ${fileCount} file(s): ${files}${fileCount > 5 ? '...' : ''}\n` +
            `🌿 Branch: ${branchName}\n` +
            `🔗 PR: ${prUrl || 'Created (check GitHub)'}\n` +
            `⏱ Duration: ${elapsed}s`
        );
        
    } catch (error) {
        console.error('Workflow error:', error);
        await sendTelegram(`❌ Workflow failed: ${error.message}`);
        throw error;
    } finally {
        sessions.delete(project);
    }
}

// Fetch GitHub issue details
async function fetchGitHubIssue(projectPath, issueNumber) {
    if (!GITHUB_TOKEN) return null;
    
    try {
        const remoteUrl = execSync('git config --get remote.origin.url', { 
            cwd: projectPath, 
            encoding: 'utf8' 
        }).trim();
        
        const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
        if (!match) return null;
        
        const [, owner, repo] = match;
        
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        return {
            title: response.data.title,
            body: response.data.body || 'No description provided',
            number: response.data.number
        };
    } catch (error) {
        console.error('Failed to fetch issue:', error.message);
        return null;
    }
}

// Build enhanced prompt with issue context
function buildEnhancedPrompt(prompt, issue, issueNumber) {
    let enhancedPrompt = prompt;
    
    if (issue && !issueNumber) {
        // User-provided context
        enhancedPrompt = `${prompt}\n\nContext:\n${issue}`;
    } else if (issue && issueNumber) {
        // Fetched from GitHub
        enhancedPrompt = `${prompt}\n\nIssue details:\n${issue}`;
    }
    
    enhancedPrompt += `\n\nIMPORTANT:
- Write clean, production-ready code
- Follow the project's existing patterns
- Add appropriate error handling
- Include comments for complex logic
- Ensure all changes are complete and functional`;
    
    return enhancedPrompt;
}

// Generate AI summary for branch name
async function generateBranchSummary(prompt) {
    if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'YOUR_API_KEY_HERE') {
        // Fallback: extract 2-3 key words
        const words = prompt.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3 && !['implement', 'create', 'make', 'add'].includes(w))
            .slice(0, 3);
        return words.join('-') || 'feature';
    }
    
    try {
        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-20250514',
            max_tokens: 20,
            messages: [{
                role: 'user',
                content: `Summarize this feature in 2-3 words (kebab-case, lowercase): "${prompt}"`
            }]
        });
        
        return message.content[0].text.trim().toLowerCase().replace(/\s+/g, '-');
    } catch {
        return 'feature';
    }
}

// Create feature or fix branch - UPDATED
function createBranch(projectPath, prompt, issue, branchType, issueNumber) {
    try {
        let branchName;
        
        if (issueNumber) {
            // Format: fix/123 or fix/issue-title-summary
            branchName = `fix/${issueNumber}`;
        } else if (branchType) {
            // User specified feature or fix
            // Generate 2-3 word summary
            const summary = prompt.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3)
                .slice(0, 3)
                .join('-');
            branchName = `${branchType}/${summary || 'update'}`;
        } else {
            // Auto-detect from prompt keywords
            const isFeature = prompt.toLowerCase().includes('add') || 
                             prompt.toLowerCase().includes('implement') ||
                             prompt.toLowerCase().includes('create');
            
            const prefix = isFeature ? 'feature' : 'fix';
            
            const baseName = issue 
                ? `issue-${issue.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)}` 
                : prompt.toLowerCase()
                    .replace(/[^a-zA-Z0-9\s]/g, '')
                    .replace(/\s+/g, '-')
                    .substring(0, 40);
            
            branchName = `${prefix}/${baseName}`;
        }
        
        // Ensure we're on main/master
        const mainBranch = getMainBranch(projectPath);
        execSync(`git checkout ${mainBranch}`, { cwd: projectPath, stdio: 'inherit' });
        
        // Try to pull
        try {
            execSync(`git pull origin ${mainBranch}`, { cwd: projectPath, stdio: 'inherit' });
        } catch (e) {
            console.log('Note: Could not pull from remote');
        }
        
        // Create and checkout new branch
        execSync(`git checkout -b ${branchName}`, { cwd: projectPath, stdio: 'inherit' });
        
        console.log(`✅ Created branch: ${branchName}`);
        return branchName;
        
    } catch (error) {
        throw new Error(`Failed to create branch: ${error.message}`);
    }
}

// Commit changes - UPDATED
function commitChanges(projectPath, prompt, issue, issueNumber, session) {
    try {
        execSync('git add .', { cwd: projectPath, stdio: 'inherit' });
        
        const files = Array.from(session.filesModified);
        let commitMessage;
        
        if (issueNumber) {
            commitMessage = `Fix #${issueNumber}: ${prompt}\n\nFiles modified:\n${files.map(f => `- ${f}`).join('\n')}`;
        } else if (issue) {
            commitMessage = `${prompt}\n\nContext: ${issue.substring(0, 200)}\n\nFiles modified:\n${files.map(f => `- ${f}`).join('\n')}`;
        } else {
            commitMessage = `${prompt}\n\nFiles modified:\n${files.map(f => `- ${f}`).join('\n')}`;
        }
        
        execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { 
            cwd: projectPath, 
            stdio: 'inherit' 
        });
        
        console.log('✅ Changes committed');
    } catch (error) {
        throw new Error(`Failed to commit: ${error.message}`);
    }
}

// Create Pull Request - UPDATED
async function createPullRequest(projectPath, branchName, prompt, issue, issueNumber, session) {
    if (!GITHUB_TOKEN) {
        console.log('ℹ️ No GitHub token - skipping PR creation');
        return null;
    }
    
    try {
        const remoteUrl = execSync('git config --get remote.origin.url', { 
            cwd: projectPath, 
            encoding: 'utf8' 
        }).trim();
        
        const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
        if (!match) {
            throw new Error('Could not parse GitHub repo from remote URL');
        }
        
        const [, owner, repo] = match;
        const mainBranch = getMainBranch(projectPath);
        
        const filesChanged = Array.from(session.filesModified);
        
        let prTitle, prBody;
        
        if (issueNumber) {
            prTitle = `Fix #${issueNumber}: ${prompt}`;
            prBody = `## Fixes Issue
Closes #${issueNumber}

## Changes Made
${filesChanged.map(file => `- \`${file}\``).join('\n')}

## Files Changed (${filesChanged.length})
${filesChanged.join(', ')}

---
*🤖 This PR was automatically created by Claude Code*`;
        } else {
            prTitle = prompt.length > 72 ? prompt.substring(0, 69) + '...' : prompt;
            prBody = `## Summary
${prompt}

${issue ? `## Context\n${issue.substring(0, 500)}...\n` : ''}
## Changes Made
${filesChanged.map(file => `- \`${file}\``).join('\n')}

## Files Changed (${filesChanged.length})
${filesChanged.join(', ')}

---
*🤖 This PR was automatically created by Claude Code*`;
        }

        const response = await axios.post(
            `https://api.github.com/repos/${owner}/${repo}/pulls`,
            {
                title: prTitle,
                head: branchName,
                base: mainBranch,
                body: prBody
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        console.log(`✅ Created PR: ${response.data.html_url}`);
        return response.data.html_url;
        
    } catch (error) {
        console.error('Failed to create PR:', error.response?.data || error.message);
        return null;
    }
}

// Get main branch name
function getMainBranch(projectPath) {
    try {
        const branches = execSync('git branch -a', { cwd: projectPath, encoding: 'utf8' });
        if (branches.includes('remotes/origin/main')) return 'main';
        if (branches.includes('remotes/origin/master')) return 'master';
        // Check local branches
        if (branches.includes('* main') || branches.includes('  main')) return 'main';
        return 'master';
    } catch {
        return 'main';
    }
}

// Run Claude Code with security restrictions
async function runClaudeCodeWithMonitoring(project, prompt, projectPath) {
    return new Promise((resolve, reject) => {
        const session = sessions.get(project);
        
        // Get npm global modules path
        const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const claudeCodePath = `${npmRoot}\\@anthropic-ai\\claude-code\\cli.js`;
        
        console.log('Using Claude Code at:', claudeCodePath);
        
        // Security: Validate project path is absolute and real
        const realProjectPath = path.resolve(projectPath);
        if (!realProjectPath.startsWith('C:\\Users\\')) {
            return reject(new Error('Invalid project path for security'));
        }
        
        const claudeProcess = spawn('node', [
            claudeCodePath,
            '--dangerously-skip-permissions',
            prompt
        ], {
            cwd: realProjectPath,  // Restricts file access to this directory
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PWD: realProjectPath
            }
        });
        
        let outputBuffer = '';
        
        claudeProcess.stdout.on('data', (data) => {
            const text = data.toString();
            console.log('[Claude Code]:', text);
            outputBuffer += text;
            session.output.push(text);
            
            // Auto-approve permission prompts
            if (text.toLowerCase().includes('would you like') || 
                text.toLowerCase().includes('permission to')) {
                console.log('[Auto-approving]');
                try {
                    claudeProcess.stdin.write('yes\n');
                } catch (e) {
                    console.log('[Could not write to stdin]');
                }
            }
            
            parseForFiles(text, session);
            parseForPlans(text, session);
        });
        
        claudeProcess.stderr.on('data', (data) => {
            const text = data.toString();
            console.error('[Claude Code Error]:', text);
            session.output.push(`[ERROR] ${text}`);
        });
        
        const summaryInterval = setInterval(async () => {
            if (outputBuffer.trim().length > 50) {
                const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
                const fileCount = session.filesModified.size;
                await sendTelegram(
                    `📝 Update (${elapsed}s)\n` +
                    `• Files modified: ${fileCount}\n` +
                    `• ${session.currentPlan || 'Working...'}`
                );
                outputBuffer = '';
                session.lastSummary = Date.now();
            }
        }, 15000);
        
        claudeProcess.on('close', async (code) => {
            clearInterval(summaryInterval);
            console.log(`Claude Code exited with code ${code}`);
            
            if (code === 0 || code === null) {
                resolve();
            } else {
                reject(new Error(`Claude Code exited with code ${code}`));
            }
        });
        
        claudeProcess.on('error', (error) => {
            clearInterval(summaryInterval);
            reject(error);
        });
    });
}

// Check for git changes
function checkForChanges(projectPath) {
    try {
        const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf8' });
        return status.trim().length > 0;
    } catch (error) {
        console.error('Error checking git status:', error);
        return false;
    }
}

// Push branch
function pushBranch(projectPath, branchName) {
    try {
        execSync(`git push -u origin ${branchName}`, { cwd: projectPath, stdio: 'inherit' });
        console.log(`✅ Pushed branch: ${branchName}`);
    } catch (error) {
        console.log('Note: Push failed, remote might not be configured');
        throw new Error(`Failed to push: ${error.message}`);
    }
}

// Parse for file modifications
function parseForFiles(text, session) {
    const patterns = [
        /(?:Modified|Created|Updated|Edited):\s+([^\n]+)/gi,
        /Writing to:\s+([^\n]+)/gi,
        /Saved:\s+([^\n]+)/gi,
        /✓\s+([^\s]+\.(ts|tsx|js|jsx|json|css|html))/gi
    ];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const filename = match[1].trim();
            if (filename && !filename.includes('...') && filename.length < 200) {
                session.filesModified.add(filename);
            }
        }
    });
}

// Parse for plans
function parseForPlans(text, session) {
    const planIndicators = ['Plan:', 'Next:', 'Working on:', 'Now:', 'Step'];
    
    const lines = text.split('\n');
    for (const line of lines) {
        if (planIndicators.some(indicator => line.includes(indicator))) {
            session.currentPlan = line.trim();
        }
    }
}

// Send message to Telegram
async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN) {
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
app.listen(PORT, () => {
    console.log(`🚀 Claude Code service running on port ${PORT}`);
    console.log(`📁 Available projects:`, Object.keys(PROJECTS));
    console.log(`🔧 Telegram configured:`, !!TELEGRAM_BOT_TOKEN);
    console.log(`🤖 Claude API configured:`, !!ANTHROPIC_API_KEY);
    console.log(`🐙 GitHub configured:`, !!GITHUB_TOKEN);
});