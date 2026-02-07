const PROGRESS_INTERVAL = 20_000; // 20s between updates

export function createHooks(session, sendMessage) {
  let lastProgressUpdate = Date.now();

  const trackFileEdits = async (input) => {
    const toolName = input.tool_name;
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = input.tool_input?.file_path;
      if (filePath) session.editedFiles.add(filePath);
    }

    // Throttled progress update
    if (Date.now() - lastProgressUpdate > PROGRESS_INTERVAL) {
      lastProgressUpdate = Date.now();
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      try {
        await sendMessage(`[${elapsed}s] ${session.lastTool || 'Working...'} | ${session.editedFiles.size} files`);
      } catch { /* don't let Telegram errors kill the agent */ }
    }
    return {};
  };

  const onNotification = async (input) => {
    if (input.message) {
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      try {
        await sendMessage(`[${elapsed}s] ${input.message}`);
      } catch { /* don't let Telegram errors kill the agent */ }
    }
    return {};
  };

  return {
    PostToolUse: [
      { matcher: 'Write|Edit', hooks: [trackFileEdits] },
    ],
    Notification: [
      { hooks: [onNotification] },
    ],
  };
}
