import { defineTool } from '@deepseek-ai/dsh-tools';
import { OpenQueue, createRoute, resolveQueuedPath } from './host-core.mjs';
export const name = 'dsh-molecular-viewer';
export const inject = ['webServer', 'connection', 'tools'];
export function apply(ctx) {
  const queue = new OpenQueue();
  const publicRoot = new URL('../public/', import.meta.url);
  ctx.effect(() => ctx.webServer.register(createRoute(ctx.connection, queue, publicRoot)), 'molecular-viewer:route');
  ctx.effect(() => () => queue.dispose(), 'molecular-viewer:queue');
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'molecule_open',
    description: 'Open existing XYZ/SDF/MOL/PDB, Gaussian GJF/COM/LOG/OUT/FCHK/FCH or ORCA INP/OUT coordinates in the current conversation molecular viewer. Optional frame selects all/first/last/last-converged or a 1-based index; last-converged requires an explicit optimization marker, not minimum/TS proof. Returns queued, not rendered; active GUI reads scoped files. Agent can first run the bundled lib/extract-coordinates.mjs CLI via authorized host execution to inspect a compact no-coordinate summary or explicitly export a NEW XYZ, then call this tool on that path. No implicit external references, binary CHK/GIF conversion, optimization, QM, edits to source or uploads. No coordinates returned to chat.',
    parameters: {
      path: { type: 'string', required: true, description: 'Existing local file path, absolute or relative to this session workspace; no URL.' },
      title: { type: 'string', description: 'Optional short tab title.' },
      frame: { type: 'string', description: 'all (default), first, last, last-converged, or a 1-based positive frame index. Explicit convergence evidence only; absent marker causes an error.' }
    },
    output: {
      schema: { type: 'object', properties: { status: { type: 'string', required: true }, path: { type: 'string', required: true }, title: { type: 'string', required: true }, requestId: { type: 'string', required: true }, rendered: { type: 'boolean', required: true }, frame: { type: 'string', required: true } }, additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    execute: async (args, exec) => {
      exec.signal.throwIfAborted();
      const sessionId = exec.agent?.session?.id;
      if (!sessionId) throw new Error('molecule_open requires an initiating agent');
      const session = exec.agent.session;
      const cwd = ctx.get('workingDirectory')?.get(session) ?? session.header?.cwd;
      const request = queue.enqueue(sessionId, resolveQueuedPath(args.path, cwd), args.title, args.frame);
      return { status: 'queued', path: request.path, title: request.title, requestId: request.id, rendered: false, frame: request.frame };
    }
  })), 'molecular-viewer:tool');
}
