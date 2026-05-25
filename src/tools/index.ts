import { exec as execCb } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { StudioHttpClient } from './studio-client.js';
import { BridgeService } from '../bridge-service.js';

const exec = promisify(execCb);

export class RobloxStudioTools {
  private client: StudioHttpClient;

  constructor(bridge: BridgeService) {
    this.client = new StudioHttpClient(bridge);
  }

  // ============================================================
  // v2 additions — direct (no Studio bridge needed)
  // ============================================================

  /**
   * Search the Roblox Creator Store / Catalog for assets matching a keyword.
   * Returns id + name + creator so the agent can call insert_asset(id) next.
   * Public Roblox catalog API, no auth required.
   *
   * Category codes (Roblox catalog v1):
   *   13 = Models, 11 = Accessories, 3 = Gear/Audio, 12 = Bundles, 1 = Featured
   *   "default" → 13 (Models) since that's the most common Studio search target.
   */
  async searchCreatorStore(query: string, category: number = 13, limit: number = 12) {
    const safeQuery = encodeURIComponent(query);
    const url = `https://catalog.roblox.com/v1/search/items?Category=${category}&Keyword=${safeQuery}&Limit=${Math.min(Math.max(limit, 1), 30)}`;
    let payload: { data?: Array<{ id: number; itemType?: string; name?: string; creatorName?: string; creatorType?: string }> } = {};
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Baseplate/1.0 (mcp asset search)' } });
      if (!res.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Creator Store search failed: HTTP ${res.status} ${res.statusText}. URL: ${url}`,
            },
          ],
        };
      }
      payload = (await res.json()) as typeof payload;
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Creator Store search threw: ${err instanceof Error ? err.message : String(err)}. URL: ${url}`,
          },
        ],
      };
    }

    const hits = (payload.data ?? []).map((d) => ({
      id: d.id,
      name: d.name ?? '(unnamed)',
      creator: d.creatorName ?? '(unknown)',
      type: d.itemType ?? 'Asset',
    }));
    return {
      content: [
        {
          type: 'text' as const,
          text:
            hits.length === 0
              ? `No results for "${query}" (category ${category}). Try a different keyword or category code.`
              : JSON.stringify({ query, category, count: hits.length, hits }, null, 2),
        },
      ],
    };
  }

  /**
   * Capture the whole Roblox Studio app window via macOS `screencapture`.
   * Returns the PNG as base64 MCP image content so the agent can reason about it.
   * macOS-only; on other platforms returns a clear error.
   */
  async screenshotStudio() {
    return this.captureStudioWindow({ viewportOnly: false });
  }

  /**
   * Capture an approximate viewport-only region of the Studio window
   * (rough heuristic crop — strips left ~17% Explorer, right ~17% Properties,
   * top ~10% toolbars, bottom ~18% Output). Studio layouts vary; the agent
   * should ask for screenshotStudio() if it needs the full chrome.
   */
  async screenshotViewport() {
    return this.captureStudioWindow({ viewportOnly: true });
  }

  private async captureStudioWindow(opts: { viewportOnly: boolean }) {
    if (process.platform !== 'darwin') {
      return {
        content: [{ type: 'text' as const, text: 'screenshot tools are macOS-only. Detected platform: ' + process.platform }],
      };
    }

    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'baseplate-shot-'));
      const fullPath = join(dir, 'full.png');

      // Find the Studio window's CGWindowID via AppleScript, then capture it.
      // Roblox Studio's process name is "RobloxStudio" on macOS.
      const findWindowScript = `
        tell application "System Events"
          set procExists to exists (process "RobloxStudio")
          if not procExists then return "NOT_RUNNING"
          tell process "RobloxStudio"
            if (count windows) is 0 then return "NO_WINDOW"
            set w to window 1
            set p to position of w
            set s to size of w
            return (item 1 of p as string) & "," & (item 2 of p as string) & "," & (item 1 of s as string) & "," & (item 2 of s as string)
          end tell
        end tell
      `.trim();

      const { stdout } = await exec(`osascript -e ${JSON.stringify(findWindowScript)}`, { timeout: 5000 }).catch((e) => ({ stdout: `ERR:${e instanceof Error ? e.message : String(e)}` }));
      const trimmed = stdout.trim();

      if (trimmed === 'NOT_RUNNING' || trimmed.startsWith('ERR:')) {
        return { content: [{ type: 'text' as const, text: 'Roblox Studio is not running. Open it and retry.' }] };
      }
      if (trimmed === 'NO_WINDOW') {
        return { content: [{ type: 'text' as const, text: 'Roblox Studio is running but has no open window.' }] };
      }
      const parts = trimmed.split(',').map((s) => Number(s.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return { content: [{ type: 'text' as const, text: `Couldn't parse Studio window geometry: ${trimmed}` }] };
      }
      let [x, y, w, h] = parts as [number, number, number, number];

      if (opts.viewportOnly) {
        // Heuristic crop. Strip approximate UI chrome.
        const leftStrip = Math.round(w * 0.17);
        const rightStrip = Math.round(w * 0.17);
        const topStrip = Math.round(h * 0.10);
        const bottomStrip = Math.round(h * 0.18);
        x += leftStrip;
        y += topStrip;
        w = Math.max(50, w - leftStrip - rightStrip);
        h = Math.max(50, h - topStrip - bottomStrip);
      }

      // screencapture -R<x,y,w,h> region.png
      const region = `${x},${y},${w},${h}`;
      const { stderr } = await exec(`screencapture -x -R ${region} ${JSON.stringify(fullPath)}`, { timeout: 5000 }).catch((e) => ({ stderr: e instanceof Error ? e.message : String(e) }));
      if (stderr && stderr.trim()) {
        return { content: [{ type: 'text' as const, text: `screencapture stderr: ${stderr}` }] };
      }

      const bytes = await readFile(fullPath);
      return {
        content: [
          {
            type: 'image' as const,
            data: bytes.toString('base64'),
            mimeType: 'image/png',
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `screenshot failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    } finally {
      if (dir) {
        try { await rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }


  async getFileTree(path: string = '') {
    const response = await this.client.request('/api/file-tree', { path });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async searchFiles(query: string, searchType: string = 'name') {
    const response = await this.client.request('/api/search-files', { query, searchType });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getPlaceInfo() {
    const response = await this.client.request('/api/place-info', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getServices(serviceName?: string) {
    const response = await this.client.request('/api/services', { serviceName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async searchObjects(query: string, searchType: string = 'name', propertyName?: string) {
    const response = await this.client.request('/api/search-objects', {
      query,
      searchType,
      propertyName
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getInstanceProperties(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_properties');
    }
    const response = await this.client.request('/api/instance-properties', { instancePath });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getInstanceChildren(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_children');
    }
    const response = await this.client.request('/api/instance-children', { instancePath });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async searchByProperty(propertyName: string, propertyValue: string) {
    if (!propertyName || !propertyValue) {
      throw new Error('Property name and value are required for search_by_property');
    }
    const response = await this.client.request('/api/search-by-property', {
      propertyName,
      propertyValue
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getClassInfo(className: string) {
    if (!className) {
      throw new Error('Class name is required for get_class_info');
    }
    const response = await this.client.request('/api/class-info', { className });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getProjectStructure(path?: string, maxDepth?: number, scriptsOnly?: boolean) {
    const response = await this.client.request('/api/project-structure', {
      path,
      maxDepth,
      scriptsOnly
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }



  async setProperty(instancePath: string, propertyName: string, propertyValue: any) {
    if (!instancePath || !propertyName) {
      throw new Error('Instance path and property name are required for set_property');
    }
    const response = await this.client.request('/api/set-property', {
      instancePath,
      propertyName,
      propertyValue
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async massSetProperty(paths: string[], propertyName: string, propertyValue: any) {
    if (!paths || paths.length === 0 || !propertyName) {
      throw new Error('Paths array and property name are required for mass_set_property');
    }
    const response = await this.client.request('/api/mass-set-property', {
      paths,
      propertyName,
      propertyValue
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async massGetProperty(paths: string[], propertyName: string) {
    if (!paths || paths.length === 0 || !propertyName) {
      throw new Error('Paths array and property name are required for mass_get_property');
    }
    const response = await this.client.request('/api/mass-get-property', {
      paths,
      propertyName
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async createObject(className: string, parent: string, name?: string) {
    if (!className || !parent) {
      throw new Error('Class name and parent are required for create_object');
    }
    const response = await this.client.request('/api/create-object', {
      className,
      parent,
      name
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async createObjectWithProperties(className: string, parent: string, name?: string, properties?: Record<string, any>) {
    if (!className || !parent) {
      throw new Error('Class name and parent are required for create_object_with_properties');
    }
    const response = await this.client.request('/api/create-object', {
      className,
      parent,
      name,
      properties
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async massCreateObjects(objects: Array<{className: string, parent: string, name?: string}>) {
    if (!objects || objects.length === 0) {
      throw new Error('Objects array is required for mass_create_objects');
    }
    const response = await this.client.request('/api/mass-create-objects', { objects });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async massCreateObjectsWithProperties(objects: Array<{className: string, parent: string, name?: string, properties?: Record<string, any>}>) {
    if (!objects || objects.length === 0) {
      throw new Error('Objects array is required for mass_create_objects_with_properties');
    }
    const response = await this.client.request('/api/mass-create-objects-with-properties', { objects });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async deleteObject(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for delete_object');
    }
    const response = await this.client.request('/api/delete-object', { instancePath });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async smartDuplicate(
    instancePath: string,
    count: number,
    options?: {
      namePattern?: string;
      positionOffset?: [number, number, number];
      rotationOffset?: [number, number, number];
      scaleOffset?: [number, number, number];
      propertyVariations?: Record<string, any[]>;
      targetParents?: string[];
    }
  ) {
    if (!instancePath || count < 1) {
      throw new Error('Instance path and count > 0 are required for smart_duplicate');
    }
    const response = await this.client.request('/api/smart-duplicate', {
      instancePath,
      count,
      options
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async massDuplicate(
    duplications: Array<{
      instancePath: string;
      count: number;
      options?: {
        namePattern?: string;
        positionOffset?: [number, number, number];
        rotationOffset?: [number, number, number];
        scaleOffset?: [number, number, number];
        propertyVariations?: Record<string, any[]>;
        targetParents?: string[];
      }
    }>
  ) {
    if (!duplications || duplications.length === 0) {
      throw new Error('Duplications array is required for mass_duplicate');
    }
    const response = await this.client.request('/api/mass-duplicate', { duplications });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async reparentInstance(instancePath: string, newParent: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for reparent_instance');
    }
    if (!newParent) {
      throw new Error('New parent path is required for reparent_instance');
    }
    const response = await this.client.request('/api/reparent-instance', { instancePath, newParent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async undo() {
    const response = await this.client.request('/api/undo', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async redo() {
    const response = await this.client.request('/api/redo', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async insertAsset(assetId: number, parent: string) {
    if (!assetId) {
      throw new Error('Asset ID is required for insert_asset');
    }
    if (!parent) {
      throw new Error('Parent path is required for insert_asset');
    }
    const response = await this.client.request('/api/insert-asset', { assetId, parent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async cloneInstance(instancePath: string, parent: string, name?: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for clone_instance');
    }
    if (!parent) {
      throw new Error('Parent path is required for clone_instance');
    }
    const response = await this.client.request('/api/clone-instance', { instancePath, parent, name });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async createUI(
    elements: Array<{
      className: string;
      name?: string;
      position?: { xScale: number; xOffset: number; yScale: number; yOffset: number };
      size?: { xScale: number; xOffset: number; yScale: number; yOffset: number };
      properties?: Record<string, any>;
      parent?: string;
    }>,
    parent?: string
  ) {
    if (!elements || elements.length === 0) {
      throw new Error('Elements array is required for create_ui');
    }
    const response = await this.client.request('/api/create-ui', { elements, parent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async fillTerrain(material: string, min: [number, number, number], max: [number, number, number]) {
    if (!material) {
      throw new Error('Material is required for fill_terrain');
    }
    if (!min || !max) {
      throw new Error('Min and max coordinates are required for fill_terrain');
    }
    const response = await this.client.request('/api/fill-terrain', { material, min, max });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async fillTerrainSphere(material: string, center: [number, number, number], radius: number) {
    if (!material) {
      throw new Error('Material is required for fill_terrain_sphere');
    }
    if (!center) {
      throw new Error('Center coordinates are required for fill_terrain_sphere');
    }
    if (!radius || radius <= 0) {
      throw new Error('Radius must be a positive number for fill_terrain_sphere');
    }
    const response = await this.client.request('/api/fill-terrain-sphere', { material, center, radius });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async clearTerrain(min?: [number, number, number], max?: [number, number, number]) {
    const response = await this.client.request('/api/clear-terrain', { min, max });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getTerrainMaterials() {
    const response = await this.client.request('/api/get-terrain-materials', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async searchReplaceScripts(search: string, replace?: string, root?: string, dryRun?: boolean) {
    if (!search) {
      throw new Error('Search string is required for search_replace_scripts');
    }
    const response = await this.client.request('/api/search-replace-scripts', { search, replace, root, dryRun });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async setCalculatedProperty(
    paths: string[],
    propertyName: string,
    formula: string,
    variables?: Record<string, any>
  ) {
    if (!paths || paths.length === 0 || !propertyName || !formula) {
      throw new Error('Paths, property name, and formula are required for set_calculated_property');
    }
    const response = await this.client.request('/api/set-calculated-property', {
      paths,
      propertyName,
      formula,
      variables
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async setRelativeProperty(
    paths: string[],
    propertyName: string,
    operation: 'add' | 'multiply' | 'divide' | 'subtract' | 'power',
    value: any,
    component?: 'X' | 'Y' | 'Z' | 'XScale' | 'XOffset' | 'YScale' | 'YOffset'
  ) {
    if (!paths || paths.length === 0 || !propertyName || !operation || value === undefined) {
      throw new Error('Paths, property name, operation, and value are required for set_relative_property');
    }
    const response = await this.client.request('/api/set-relative-property', {
      paths,
      propertyName,
      operation,
      value,
      component
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getScriptSource(instancePath: string, startLine?: number, endLine?: number) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_script_source');
    }
    const response = await this.client.request('/api/get-script-source', { instancePath, startLine, endLine });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async setScriptSource(instancePath: string, source: string) {
    if (!instancePath || typeof source !== 'string') {
      throw new Error('Instance path and source code string are required for set_script_source');
    }
    const response = await this.client.request('/api/set-script-source', { instancePath, source });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async editScriptLines(instancePath: string, startLine: number, endLine: number, newContent: string) {
    if (!instancePath || !startLine || !endLine || typeof newContent !== 'string') {
      throw new Error('Instance path, startLine, endLine, and newContent are required for edit_script_lines');
    }
    const response = await this.client.request('/api/edit-script-lines', { instancePath, startLine, endLine, newContent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async insertScriptLines(instancePath: string, afterLine: number, newContent: string) {
    if (!instancePath || typeof newContent !== 'string') {
      throw new Error('Instance path and newContent are required for insert_script_lines');
    }
    const response = await this.client.request('/api/insert-script-lines', { instancePath, afterLine: afterLine || 0, newContent });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async deleteScriptLines(instancePath: string, startLine: number, endLine: number) {
    if (!instancePath || !startLine || !endLine) {
      throw new Error('Instance path, startLine, and endLine are required for delete_script_lines');
    }
    const response = await this.client.request('/api/delete-script-lines', { instancePath, startLine, endLine });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getAttribute(instancePath: string, attributeName: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for get_attribute');
    }
    const response = await this.client.request('/api/get-attribute', { instancePath, attributeName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async setAttribute(instancePath: string, attributeName: string, attributeValue: any, valueType?: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for set_attribute');
    }
    const response = await this.client.request('/api/set-attribute', { instancePath, attributeName, attributeValue, valueType });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getAttributes(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_attributes');
    }
    const response = await this.client.request('/api/get-attributes', { instancePath });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async deleteAttribute(instancePath: string, attributeName: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for delete_attribute');
    }
    const response = await this.client.request('/api/delete-attribute', { instancePath, attributeName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }


  async getTags(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_tags');
    }
    const response = await this.client.request('/api/get-tags', { instancePath });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async addTag(instancePath: string, tagName: string) {
    if (!instancePath || !tagName) {
      throw new Error('Instance path and tag name are required for add_tag');
    }
    const response = await this.client.request('/api/add-tag', { instancePath, tagName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async removeTag(instancePath: string, tagName: string) {
    if (!instancePath || !tagName) {
      throw new Error('Instance path and tag name are required for remove_tag');
    }
    const response = await this.client.request('/api/remove-tag', { instancePath, tagName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getTagged(tagName: string) {
    if (!tagName) {
      throw new Error('Tag name is required for get_tagged');
    }
    const response = await this.client.request('/api/get-tagged', { tagName });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getSelection() {
    const response = await this.client.request('/api/get-selection', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async executeLuau(code: string) {
    if (!code) {
      throw new Error('Code is required for execute_luau');
    }
    const response = await this.client.request('/api/execute-luau', { code });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async startPlaytest(mode: string) {
    if (mode !== 'play' && mode !== 'run') {
      throw new Error('mode must be "play" or "run"');
    }
    const response = await this.client.request('/api/start-playtest', { mode });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async stopPlaytest() {
    const response = await this.client.request('/api/stop-playtest', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  async getPlaytestOutput() {
    const response = await this.client.request('/api/get-playtest-output', {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }
}