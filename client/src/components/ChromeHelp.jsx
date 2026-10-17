export const LAUNCH_COMMANDS = {
  Windows: '& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\\ChromeTicketAssist"',
  macOS: '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-ticket-assist"',
  Linux: 'google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-ticket-assist"',
};

/** How to start Chrome with remote debugging (Chrome 136+ needs its own profile). */
export default function ChromeHelp({ title = "Chrome isn't reachable on port 9222.", children }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{children ?? 'Start a dedicated Chrome profile with remote debugging (Chrome 136+ requires a separate --user-data-dir):'}</p>
      {Object.entries(LAUNCH_COMMANDS).map(([os, cmd]) => (
        <div key={os} className="mt-2">
          <p className="text-xs font-medium">{os}</p>
          <code className="block overflow-x-auto whitespace-pre rounded bg-white p-2 text-xs">{cmd}</code>
        </div>
      ))}
    </div>
  );
}
