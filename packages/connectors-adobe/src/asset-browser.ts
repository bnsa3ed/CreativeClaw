/**
 * Adobe Asset Browser
 * Generates ExtendScript to list currently open items in each Adobe app.
 * Results flow back through the worker → gateway → API.
 */

import type { AdobeApp } from './index.js';
import { executeViaOsascript } from './macos-bridge.js';

export interface AssetItem {
  id: string;
  name: string;
  type: string;
  path?: string;
  duration?: string;
  width?: number;
  height?: number;
}

export interface AssetBrowserResult {
  app: AdobeApp;
  projectName?: string;
  items: AssetItem[];
  activeItem?: string;
  error?: string;
}

// ─── ExtendScript generators ──────────────────────────────────────────────────

const SCRIPTS: Record<AdobeApp, string> = {
  premiere: `
(function() {
  var proj = app.project;
  if (!proj) return JSON.stringify({ error: 'no_project_open' });
  var items = [];
  function traverse(folder) {
    for (var i = 0; i < folder.children.numItems; i++) {
      var item = folder.children[i];
      if (item.type === ProjectItemType.CLIP) {
        items.push({
          id: String(item.nodeId || i),
          name: item.name,
          type: 'clip',
          path: item.getMediaPath ? item.getMediaPath() : '',
          duration: item.getOutPoint ? item.getOutPoint().toString() : ''
        });
      } else if (item.type === ProjectItemType.BIN) {
        traverse(item);
      }
    }
  }
  traverse(proj.rootItem);
  var active = proj.activeSequence ? proj.activeSequence.name : null;
  return JSON.stringify({ projectName: proj.name, items: items, activeItem: active });
})();`,

  aftereffects: `
(function() {
  var proj = app.project;
  if (!proj) return JSON.stringify({ error: 'no_project_open' });
  var items = [];
  for (var i = 1; i <= proj.numItems; i++) {
    var item = proj.item(i);
    items.push({
      id: String(i),
      name: item.name,
      type: item instanceof CompItem ? 'composition' : item instanceof FootageItem ? 'footage' : 'folder',
      duration: item.duration ? item.duration.toFixed(3) + 's' : null,
      width: item.width || null,
      height: item.height || null
    });
  }
  var active = app.project.activeItem ? app.project.activeItem.name : null;
  return JSON.stringify({ projectName: proj.file ? proj.file.name : 'untitled', items: items, activeItem: active });
})();`,

  photoshop: `
(function() {
  if (!app.documents.length) return JSON.stringify({ error: 'no_documents_open' });
  var items = [];
  for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    items.push({
      id: String(i),
      name: doc.name,
      type: 'document',
      path: doc.path ? doc.path.toString() : '',
      width: doc.width.as('px'),
      height: doc.height.as('px')
    });
  }
  var active = app.activeDocument ? app.activeDocument.name : null;
  return JSON.stringify({ items: items, activeItem: active });
})();`,

  illustrator: `
(function() {
  if (!app.documents.length) return JSON.stringify({ error: 'no_documents_open' });
  var items = [];
  for (var i = 0; i < app.documents.length; i++) {
    var doc = app.documents[i];
    items.push({
      id: String(i),
      name: doc.name,
      type: 'document',
      path: doc.path ? doc.path.toString() : '',
      width: doc.width,
      height: doc.height
    });
  }
  var active = app.activeDocument ? app.activeDocument.name : null;
  return JSON.stringify({ items: items, activeItem: active });
})();`,
};

// ─── Browser ──────────────────────────────────────────────────────────────────

export async function browseAssets(app: AdobeApp): Promise<AssetBrowserResult> {
  const jsx = SCRIPTS[app];
  if (!jsx) return { app, items: [], error: 'unsupported_app' };

  const mock = process.env.CREATIVECLAW_ADOBE_MOCK === 'true';
  if (mock) {
    return {
      app,
      projectName: 'mock-project',
      activeItem: 'mock-sequence',
      items: [
        { id: '1', name: 'clip_intro.mp4', type: 'clip', path: '/mock/clips/intro.mp4', duration: '30s' },
        { id: '2', name: 'clip_main.mp4', type: 'clip', path: '/mock/clips/main.mp4', duration: '120s' },
        { id: '3', name: 'logo.png', type: 'clip', path: '/mock/assets/logo.png' },
      ],
    };
  }

  const result = await executeViaOsascript(app, jsx.trim(), 15_000);

  if (!result.ok) {
    return { app, items: [], error: result.error };
  }

  const data: any = result.output && typeof result.output === 'object' && 'raw' in result.output
    ? (() => { try { return JSON.parse((result.output as any).raw); } catch { return {}; } })()
    : result.output;

  if (data?.error) return { app, items: [], error: data.error };

  return {
    app,
    projectName: data?.projectName,
    activeItem: data?.activeItem,
    items: (data?.items || []) as AssetItem[],
  };
}
