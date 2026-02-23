# MCP Power Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 7 new tool categories to the MCP server — reparent, undo/redo, asset insertion, terrain, UI building, script search-replace, and clone-to-parent — taking the server from 40 to ~50 tools.

**Architecture:** Each new tool follows the existing 3-layer pattern: MCP tool definition in `index.ts` → method in `tools/index.ts` → handler in `studio-plugin/src/modules/handlers/`. All handlers use `Utils.getInstanceByPath()` for path resolution, `pcall()` for error handling, and `ChangeHistoryService.SetWaypoint()` for undo support. New endpoints are registered in `Communication.ts` route map.

**Tech Stack:** TypeScript (MCP server + roblox-ts plugin), Luau (compiled output), Express HTTP bridge

---

## Files Overview

Every task touches the same 3 MCP-side files plus a handler file:

| Layer | File | What changes |
|-------|------|-------------|
| MCP tool definitions | `src/index.ts` | Add tool to `ListToolsRequestSchema` + `CallToolRequestSchema` |
| MCP tool methods | `src/tools/index.ts` | Add async method that calls `client.request()` |
| Plugin route map | `studio-plugin/src/modules/Communication.ts` | Add endpoint → handler mapping |
| Plugin handler | `studio-plugin/src/modules/handlers/<Handler>.ts` | Implement the Luau-side logic |

---

### Task 1: Reparent/Move Instance

**Files:**
- Modify: `src/index.ts` (add tool def + case)
- Modify: `src/tools/index.ts` (add method)
- Modify: `studio-plugin/src/modules/Communication.ts` (add route)
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts` (add handler)

**Step 1: Add handler in InstanceHandlers.ts**

Add `reparentInstance` function before the `export =` block:

```typescript
function reparentInstance(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newParentPath = requestData.newParent as string;

	if (!instancePath || !newParentPath) {
		return { error: "instancePath and newParent are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const newParent = getInstanceByPath(newParentPath);
	if (!newParent) return { error: `New parent not found: ${newParentPath}` };

	if (instance === game) return { error: "Cannot reparent the game instance" };

	const oldParentPath = instance.Parent ? getInstancePath(instance.Parent) : "nil";

	const [success, result] = pcall(() => {
		instance.Parent = newParent;
		ChangeHistoryService.SetWaypoint(`Reparent ${instance.Name} to ${newParent.Name}`);
		return true;
	});

	if (success) {
		return {
			success: true,
			instancePath: getInstancePath(instance),
			oldParent: oldParentPath,
			newParent: newParentPath,
			message: `Moved ${instance.Name} to ${newParent.Name}`,
		};
	} else {
		return { error: `Failed to reparent: ${result}`, instancePath, newParent: newParentPath };
	}
}
```

Add `reparentInstance` to the export block.

**Step 2: Add route in Communication.ts**

Add to routeMap after the existing instance routes:
```typescript
"/api/reparent-instance": InstanceHandlers.reparentInstance,
```

**Step 3: Add method in tools/index.ts**

```typescript
async reparentInstance(instancePath: string, newParent: string) {
    if (!instancePath || !newParent) {
        throw new Error('Instance path and new parent are required for reparent_instance');
    }
    const response = await this.client.request('/api/reparent-instance', { instancePath, newParent });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definition and case in index.ts**

Tool definition (add to `tools` array):
```typescript
{
    name: 'reparent_instance',
    description: 'Move a Roblox instance to a new parent without deleting/recreating it. Preserves all properties, children, and references.',
    inputSchema: {
        type: 'object',
        properties: {
            instancePath: {
                type: 'string',
                description: 'Path to the instance to move (e.g., "game.Workspace.Part")'
            },
            newParent: {
                type: 'string',
                description: 'Path to the new parent instance (e.g., "game.ServerStorage")'
            }
        },
        required: ['instancePath', 'newParent']
    }
}
```

Case in switch:
```typescript
case 'reparent_instance':
    return await this.tools.reparentInstance((args as any)?.instancePath as string, (args as any)?.newParent as string);
```

**Step 5: Build and verify**

Run: `npm run build:all`
Expected: Clean build with no errors

---

### Task 2: Undo/Redo

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts`

**Step 1: Add handlers in InstanceHandlers.ts**

```typescript
function undo(requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Undo();
		return true;
	});

	if (success) {
		return { success: true, message: "Undo performed" };
	} else {
		return { error: `Undo failed: ${result}` };
	}
}

function redo(requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Redo();
		return true;
	});

	if (success) {
		return { success: true, message: "Redo performed" };
	} else {
		return { error: `Redo failed: ${result}` };
	}
}
```

Add `undo` and `redo` to export block.

**Step 2: Add routes in Communication.ts**

```typescript
"/api/undo": InstanceHandlers.undo,
"/api/redo": InstanceHandlers.redo,
```

**Step 3: Add methods in tools/index.ts**

```typescript
async undo() {
    const response = await this.client.request('/api/undo', {});
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}

async redo() {
    const response = await this.client.request('/api/redo', {});
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definitions and cases in index.ts**

```typescript
{
    name: 'undo',
    description: 'Undo the last action in Roblox Studio using ChangeHistoryService. Equivalent to Ctrl+Z.',
    inputSchema: { type: 'object', properties: {} }
},
{
    name: 'redo',
    description: 'Redo the last undone action in Roblox Studio using ChangeHistoryService. Equivalent to Ctrl+Y.',
    inputSchema: { type: 'object', properties: {} }
}
```

Cases:
```typescript
case 'undo':
    return await this.tools.undo();
case 'redo':
    return await this.tools.redo();
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 3: Insert Asset by ID

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts`

**Step 1: Add handler in InstanceHandlers.ts**

```typescript
const InsertService = game.GetService("InsertService");

function insertAsset(requestData: Record<string, unknown>) {
	const assetId = requestData.assetId as number;
	const parentPath = requestData.parent as string;

	if (!assetId) return { error: "assetId is required" };
	if (!parentPath) return { error: "parent path is required" };

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent not found: ${parentPath}` };

	const [success, result] = pcall(() => {
		const model = InsertService.LoadAsset(assetId);
		const children = model.GetChildren();
		const inserted: Record<string, unknown>[] = [];

		for (const child of children) {
			child.Parent = parentInstance;
			inserted.push({
				name: child.Name,
				className: child.ClassName,
				instancePath: getInstancePath(child),
			});
		}

		model.Destroy();
		ChangeHistoryService.SetWaypoint(`Insert asset ${assetId}`);
		return inserted;
	});

	if (success) {
		return {
			success: true,
			assetId,
			parent: parentPath,
			inserted: result,
			message: `Asset ${assetId} inserted successfully`,
		};
	} else {
		return { error: `Failed to insert asset: ${result}`, assetId, parent: parentPath };
	}
}
```

Add `insertAsset` to export block.

**Step 2: Add route in Communication.ts**

```typescript
"/api/insert-asset": InstanceHandlers.insertAsset,
```

**Step 3: Add method in tools/index.ts**

```typescript
async insertAsset(assetId: number, parent: string) {
    if (!assetId || !parent) {
        throw new Error('Asset ID and parent are required for insert_asset');
    }
    const response = await this.client.request('/api/insert-asset', { assetId, parent });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definition and case in index.ts**

```typescript
{
    name: 'insert_asset',
    description: 'Insert a Roblox asset (model, mesh, image, etc.) by its AssetId into the game. Uses InsertService:LoadAsset().',
    inputSchema: {
        type: 'object',
        properties: {
            assetId: {
                type: 'number',
                description: 'The Roblox asset ID to insert'
            },
            parent: {
                type: 'string',
                description: 'Path to the parent instance (e.g., "game.Workspace")'
            }
        },
        required: ['assetId', 'parent']
    }
}
```

Case:
```typescript
case 'insert_asset':
    return await this.tools.insertAsset((args as any)?.assetId as number, (args as any)?.parent as string);
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 4: Terrain Tools

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Create: `studio-plugin/src/modules/handlers/TerrainHandlers.ts`

**Step 1: Create TerrainHandlers.ts**

```typescript
import Utils from "../Utils";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const terrain = game.Workspace.Terrain;

const { getInstanceByPath } = Utils;

function fillTerrain(requestData: Record<string, unknown>) {
	const material = requestData.material as string;
	const minPos = requestData.min as number[];
	const maxPos = requestData.max as number[];

	if (!material || !minPos || !maxPos) {
		return { error: "material, min [x,y,z], and max [x,y,z] are required" };
	}

	const materialEnum = (Enum.Material as unknown as Record<string, EnumItem>)[material];
	if (!materialEnum) return { error: `Unknown material: ${material}` };

	const [success, result] = pcall(() => {
		const region = new Region3(
			new Vector3(minPos[0] as number, minPos[1] as number, minPos[2] as number),
			new Vector3(maxPos[0] as number, maxPos[1] as number, maxPos[2] as number),
		);
		const resolution = 4;
		const alignedRegion = region.ExpandToGrid(resolution);
		terrain.FillRegion(alignedRegion, resolution, materialEnum as unknown as Enum.Material);
		ChangeHistoryService.SetWaypoint(`Fill terrain with ${material}`);
		return true;
	});

	if (success) {
		return { success: true, material, min: minPos, max: maxPos, message: `Terrain filled with ${material}` };
	} else {
		return { error: `Failed to fill terrain: ${result}` };
	}
}

function fillTerrainSphere(requestData: Record<string, unknown>) {
	const material = requestData.material as string;
	const center = requestData.center as number[];
	const radius = requestData.radius as number;

	if (!material || !center || !radius) {
		return { error: "material, center [x,y,z], and radius are required" };
	}

	const materialEnum = (Enum.Material as unknown as Record<string, EnumItem>)[material];
	if (!materialEnum) return { error: `Unknown material: ${material}` };

	const [success, result] = pcall(() => {
		const centerVec = new Vector3(center[0] as number, center[1] as number, center[2] as number);
		terrain.FillBall(centerVec, radius, materialEnum as unknown as Enum.Material);
		ChangeHistoryService.SetWaypoint(`Fill terrain sphere ${material} r=${radius}`);
		return true;
	});

	if (success) {
		return { success: true, material, center, radius, message: `Terrain sphere filled with ${material}` };
	} else {
		return { error: `Failed to fill terrain sphere: ${result}` };
	}
}

function clearTerrain(requestData: Record<string, unknown>) {
	const minPos = requestData.min as number[] | undefined;
	const maxPos = requestData.max as number[] | undefined;

	const [success, result] = pcall(() => {
		if (minPos && maxPos) {
			const region = new Region3(
				new Vector3(minPos[0] as number, minPos[1] as number, minPos[2] as number),
				new Vector3(maxPos[0] as number, maxPos[1] as number, maxPos[2] as number),
			);
			const resolution = 4;
			const alignedRegion = region.ExpandToGrid(resolution);
			terrain.FillRegion(alignedRegion, resolution, Enum.Material.Air);
		} else {
			terrain.Clear();
		}
		ChangeHistoryService.SetWaypoint("Clear terrain");
		return true;
	});

	if (success) {
		return { success: true, message: minPos ? "Terrain region cleared" : "All terrain cleared" };
	} else {
		return { error: `Failed to clear terrain: ${result}` };
	}
}

function getTerrainMaterials(_requestData: Record<string, unknown>) {
	const materials: string[] = [];
	for (const [name] of pairs(Enum.Material.GetEnumItems())) {
		materials.push(tostring(name));
	}
	return { materials };
}

export = {
	fillTerrain,
	fillTerrainSphere,
	clearTerrain,
	getTerrainMaterials,
};
```

**Step 2: Add routes in Communication.ts**

Import TerrainHandlers:
```typescript
import TerrainHandlers from "./handlers/TerrainHandlers";
```

Add to routeMap:
```typescript
"/api/fill-terrain": TerrainHandlers.fillTerrain,
"/api/fill-terrain-sphere": TerrainHandlers.fillTerrainSphere,
"/api/clear-terrain": TerrainHandlers.clearTerrain,
"/api/get-terrain-materials": TerrainHandlers.getTerrainMaterials,
```

**Step 3: Add methods in tools/index.ts**

```typescript
async fillTerrain(material: string, min: number[], max: number[]) {
    if (!material || !min || !max) {
        throw new Error('Material, min, and max are required for fill_terrain');
    }
    const response = await this.client.request('/api/fill-terrain', { material, min, max });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}

async fillTerrainSphere(material: string, center: number[], radius: number) {
    if (!material || !center || !radius) {
        throw new Error('Material, center, and radius are required for fill_terrain_sphere');
    }
    const response = await this.client.request('/api/fill-terrain-sphere', { material, center, radius });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}

async clearTerrain(min?: number[], max?: number[]) {
    const response = await this.client.request('/api/clear-terrain', { min, max });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}

async getTerrainMaterials() {
    const response = await this.client.request('/api/get-terrain-materials', {});
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definitions and cases in index.ts**

```typescript
{
    name: 'fill_terrain',
    description: 'Fill a rectangular region with terrain material. Coordinates are in world space.',
    inputSchema: {
        type: 'object',
        properties: {
            material: { type: 'string', description: 'Terrain material name (e.g., "Grass", "Sand", "Water", "Rock")' },
            min: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Min corner [x, y, z]' },
            max: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Max corner [x, y, z]' }
        },
        required: ['material', 'min', 'max']
    }
},
{
    name: 'fill_terrain_sphere',
    description: 'Fill a spherical region with terrain material.',
    inputSchema: {
        type: 'object',
        properties: {
            material: { type: 'string', description: 'Terrain material name (e.g., "Grass", "Sand", "Water")' },
            center: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Center position [x, y, z]' },
            radius: { type: 'number', description: 'Sphere radius in studs' }
        },
        required: ['material', 'center', 'radius']
    }
},
{
    name: 'clear_terrain',
    description: 'Clear terrain. If min/max provided, clears only that region. Otherwise clears ALL terrain.',
    inputSchema: {
        type: 'object',
        properties: {
            min: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Optional min corner [x, y, z] for region clear' },
            max: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Optional max corner [x, y, z] for region clear' }
        }
    }
},
{
    name: 'get_terrain_materials',
    description: 'Get a list of all available terrain material names.',
    inputSchema: { type: 'object', properties: {} }
}
```

Cases:
```typescript
case 'fill_terrain':
    return await this.tools.fillTerrain((args as any)?.material as string, (args as any)?.min as number[], (args as any)?.max as number[]);
case 'fill_terrain_sphere':
    return await this.tools.fillTerrainSphere((args as any)?.material as string, (args as any)?.center as number[], (args as any)?.radius as number);
case 'clear_terrain':
    return await this.tools.clearTerrain((args as any)?.min, (args as any)?.max);
case 'get_terrain_materials':
    return await this.tools.getTerrainMaterials();
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 5: Create UI (ScreenGui Builder)

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts`

**Step 1: Add handler in InstanceHandlers.ts**

This handler creates GUI elements with proper UDim2 values via execute_luau-style direct construction, avoiding the broken property-tools UDim2 path.

```typescript
function createUI(requestData: Record<string, unknown>) {
	const elements = requestData.elements as Record<string, unknown>[];
	const parentPath = (requestData.parent as string) ?? "game.StarterGui";

	if (!elements || !typeIs(elements, "table") || (elements as defined[]).size() === 0) {
		return { error: "elements array is required" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent not found: ${parentPath}` };

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const elem of elements) {
		const className = elem.className as string ?? "Frame";
		const name = elem.name as string | undefined;
		const position = elem.position as Record<string, unknown> | undefined;
		const size = elem.size as Record<string, unknown> | undefined;
		const properties = (elem.properties as Record<string, unknown>) ?? {};
		const elemParent = elem.parent as string | undefined;

		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (name) instance.Name = name;

			if (size && (instance as unknown as { Size: UDim2 }).Size !== undefined) {
				const xScale = (size.xScale as number) ?? 0;
				const xOffset = (size.xOffset as number) ?? 0;
				const yScale = (size.yScale as number) ?? 0;
				const yOffset = (size.yOffset as number) ?? 0;
				(instance as unknown as { Size: UDim2 }).Size = new UDim2(xScale, xOffset, yScale, yOffset);
			}

			if (position && (instance as unknown as { Position: UDim2 }).Position !== undefined) {
				const xScale = (position.xScale as number) ?? 0;
				const xOffset = (position.xOffset as number) ?? 0;
				const yScale = (position.yScale as number) ?? 0;
				const yOffset = (position.yOffset as number) ?? 0;
				(instance as unknown as { Position: UDim2 }).Position = new UDim2(xScale, xOffset, yScale, yOffset);
			}

			for (const [propName, propValue] of pairs(properties)) {
				pcall(() => {
					const converted = convertPropertyValue(instance, propName as string, propValue);
					if (converted !== undefined) {
						(instance as unknown as { [key: string]: unknown })[propName as string] = converted;
					}
				});
			}

			const target = elemParent ? getInstanceByPath(elemParent) ?? parentInstance : parentInstance;
			instance.Parent = target;
			return instance;
		});

		if (success && newInstance) {
			successCount++;
			results.push({
				success: true, className, name: (newInstance as Instance).Name,
				instancePath: getInstancePath(newInstance as Instance),
			});
		} else {
			failureCount++;
			results.push({ success: false, className, error: tostring(newInstance) });
		}
	}

	if (successCount > 0) ChangeHistoryService.SetWaypoint("Create UI elements");
	return { results, summary: { total: (elements as defined[]).size(), succeeded: successCount, failed: failureCount } };
}
```

Add `createUI` to export block.

**Step 2: Add route in Communication.ts**

```typescript
"/api/create-ui": InstanceHandlers.createUI,
```

**Step 3: Add method in tools/index.ts**

```typescript
async createUI(elements: Array<Record<string, any>>, parent?: string) {
    if (!elements || elements.length === 0) {
        throw new Error('Elements array is required for create_ui');
    }
    const response = await this.client.request('/api/create-ui', { elements, parent });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definition and case in index.ts**

```typescript
{
    name: 'create_ui',
    description: 'Create UI elements (ScreenGui, Frame, TextLabel, TextButton, ImageLabel, etc.) with proper UDim2 positioning and sizing. Bypasses the UDim2 property tool limitations.',
    inputSchema: {
        type: 'object',
        properties: {
            elements: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        className: { type: 'string', description: 'UI class (ScreenGui, Frame, TextLabel, TextButton, ImageLabel, ScrollingFrame, etc.)' },
                        name: { type: 'string', description: 'Instance name' },
                        position: {
                            type: 'object',
                            properties: {
                                xScale: { type: 'number' }, xOffset: { type: 'number' },
                                yScale: { type: 'number' }, yOffset: { type: 'number' }
                            },
                            description: 'UDim2 position {xScale, xOffset, yScale, yOffset}'
                        },
                        size: {
                            type: 'object',
                            properties: {
                                xScale: { type: 'number' }, xOffset: { type: 'number' },
                                yScale: { type: 'number' }, yOffset: { type: 'number' }
                            },
                            description: 'UDim2 size {xScale, xOffset, yScale, yOffset}'
                        },
                        properties: { type: 'object', description: 'Additional properties to set (BackgroundColor3, Text, TextSize, etc.)' },
                        parent: { type: 'string', description: 'Override parent path for this element (defaults to top-level parent)' }
                    }
                },
                description: 'Array of UI elements to create'
            },
            parent: {
                type: 'string',
                description: 'Default parent path for all elements (default: "game.StarterGui")'
            }
        },
        required: ['elements']
    }
}
```

Case:
```typescript
case 'create_ui':
    return await this.tools.createUI((args as any)?.elements, (args as any)?.parent);
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 6: Search & Replace Across Scripts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Modify: `studio-plugin/src/modules/handlers/ScriptHandlers.ts`

**Step 1: Add handler in ScriptHandlers.ts**

Need to read current ScriptHandlers.ts first to understand the existing pattern (uses ScriptEditorService, readScriptSource, etc). The handler will recursively find all scripts, search their source, and optionally replace.

```typescript
function searchReplaceScripts(requestData: Record<string, unknown>) {
	const searchPattern = requestData.search as string;
	const replacement = requestData.replace as string | undefined;
	const rootPath = (requestData.root as string) ?? "game";
	const dryRun = (requestData.dryRun as boolean) ?? (replacement === undefined);

	if (!searchPattern) return { error: "search pattern is required" };

	const rootInstance = getInstanceByPath(rootPath);
	if (!rootInstance) return { error: `Root not found: ${rootPath}` };

	const ScriptEditorService = game.GetService("ScriptEditorService");
	const matches: Record<string, unknown>[] = [];
	let totalReplacements = 0;

	function processDescendants(parent: Instance) {
		for (const child of parent.GetDescendants()) {
			if (child.IsA("LuaSourceContainer")) {
				const [ok, source] = pcall(() => {
					return ScriptEditorService.UpdateSourceAsync(child, (oldSource: string) => {
						return oldSource;
					});
				});

				if (!ok) continue;

				const [readOk, currentSource] = pcall(() => readScriptSource(child));
				if (!readOk || !currentSource) continue;

				const [foundStart] = (currentSource as string).find(searchPattern, 1, true);
				if (!foundStart) continue;

				let count = 0;
				let pos = 1;
				while (true) {
					const [start] = (currentSource as string).find(searchPattern, pos, true);
					if (!start) break;
					count++;
					pos = start + 1;
				}

				const matchInfo: Record<string, unknown> = {
					scriptPath: getInstancePath(child),
					scriptName: child.Name,
					matchCount: count,
				};

				if (replacement !== undefined && !dryRun) {
					const [replaceOk, replaceResult] = pcall(() => {
						const newSource = (currentSource as string).gsub(
							searchPattern.gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")[0],
							replacement
						)[0];
						ScriptEditorService.UpdateSourceAsync(child, () => newSource);
						return true;
					});

					matchInfo.replaced = replaceOk;
					if (replaceOk) totalReplacements += count;
				}

				matches.push(matchInfo);
			}
		}
	}

	const [success, result] = pcall(() => {
		processDescendants(rootInstance);
		if (totalReplacements > 0) {
			ChangeHistoryService.SetWaypoint(`Search & replace: "${searchPattern}"`);
		}
		return true;
	});

	if (success) {
		return {
			success: true,
			search: searchPattern,
			replace: replacement,
			dryRun,
			matches,
			totalMatches: matches.size(),
			totalReplacements,
		};
	} else {
		return { error: `Search & replace failed: ${result}` };
	}
}
```

Add `searchReplaceScripts` to export block. Also need to ensure `readScriptSource` and `getInstanceByPath`/`getInstancePath` are available (they should be imported from Utils already).

**Step 2: Add route in Communication.ts**

```typescript
"/api/search-replace-scripts": ScriptHandlers.searchReplaceScripts,
```

**Step 3: Add method in tools/index.ts**

```typescript
async searchReplaceScripts(search: string, replace?: string, root?: string, dryRun?: boolean) {
    if (!search) {
        throw new Error('Search pattern is required for search_replace_scripts');
    }
    const response = await this.client.request('/api/search-replace-scripts', { search, replace, root, dryRun });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definition and case in index.ts**

```typescript
{
    name: 'search_replace_scripts',
    description: 'Search for text across all scripts in the game (or subtree). Optionally replace matches. Use dryRun=true to preview matches without modifying. Searches LocalScripts, Scripts, and ModuleScripts.',
    inputSchema: {
        type: 'object',
        properties: {
            search: { type: 'string', description: 'Text to search for (plain text, not regex)' },
            replace: { type: 'string', description: 'Replacement text. If omitted, performs search-only.' },
            root: { type: 'string', description: 'Root instance path to search under (default: "game" = search everything)' },
            dryRun: { type: 'boolean', description: 'If true, find matches but do not replace (default: true if replace is omitted)' }
        },
        required: ['search']
    }
}
```

Case:
```typescript
case 'search_replace_scripts':
    return await this.tools.searchReplaceScripts((args as any)?.search as string, (args as any)?.replace, (args as any)?.root, (args as any)?.dryRun);
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 7: Clone to Different Parent

**Files:**
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts`

**Step 1: Add handler in InstanceHandlers.ts**

```typescript
function cloneInstance(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.parent as string;
	const newName = requestData.name as string | undefined;

	if (!instancePath || !targetParentPath) {
		return { error: "instancePath and parent are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}` };

	const [success, result] = pcall(() => {
		const clone = instance.Clone();
		if (newName) clone.Name = newName;
		clone.Parent = targetParent;
		ChangeHistoryService.SetWaypoint(`Clone ${instance.Name} to ${targetParent.Name}`);
		return clone;
	});

	if (success && result) {
		return {
			success: true,
			sourcePath: instancePath,
			newPath: getInstancePath(result as Instance),
			name: (result as Instance).Name,
			parent: targetParentPath,
			message: `Cloned ${instance.Name} to ${targetParent.Name}`,
		};
	} else {
		return { error: `Failed to clone: ${result}`, instancePath, parent: targetParentPath };
	}
}
```

Add `cloneInstance` to export block.

**Step 2: Add route in Communication.ts**

```typescript
"/api/clone-instance": InstanceHandlers.cloneInstance,
```

**Step 3: Add method in tools/index.ts**

```typescript
async cloneInstance(instancePath: string, parent: string, name?: string) {
    if (!instancePath || !parent) {
        throw new Error('Instance path and parent are required for clone_instance');
    }
    const response = await this.client.request('/api/clone-instance', { instancePath, parent, name });
    return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
}
```

**Step 4: Add tool definition and case in index.ts**

```typescript
{
    name: 'clone_instance',
    description: 'Clone (deep copy) a Roblox instance and place the copy under a specified parent. Preserves all children, properties, and scripts.',
    inputSchema: {
        type: 'object',
        properties: {
            instancePath: { type: 'string', description: 'Path to the instance to clone' },
            parent: { type: 'string', description: 'Path to the target parent for the clone' },
            name: { type: 'string', description: 'Optional new name for the clone' }
        },
        required: ['instancePath', 'parent']
    }
}
```

Case:
```typescript
case 'clone_instance':
    return await this.tools.cloneInstance((args as any)?.instancePath as string, (args as any)?.parent as string, (args as any)?.name);
```

**Step 5: Build and verify**

Run: `npm run build:all`

---

### Task 8: Final Build, Test & Verify

**Step 1: Build everything**

Run: `npm run build:all`
Expected: Clean compile with no errors

**Step 2: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (new tools are integration-tested via Studio)

**Step 3: Verify tool count**

Count tool definitions in `src/index.ts` — should be 51 tools total (40 original + 11 new: reparent_instance, undo, redo, insert_asset, fill_terrain, fill_terrain_sphere, clear_terrain, get_terrain_materials, create_ui, search_replace_scripts, clone_instance).

**Step 4: Build the plugin**

Run: `npm run build:plugin`
Expected: Clean compile, `MCPPlugin.rbxmx` updated

**Step 5: Commit**

```bash
git add src/index.ts src/tools/index.ts studio-plugin/src/modules/Communication.ts studio-plugin/src/modules/handlers/InstanceHandlers.ts studio-plugin/src/modules/handlers/ScriptHandlers.ts studio-plugin/src/modules/handlers/TerrainHandlers.ts
git commit -m "feat: add 11 new MCP tools - reparent, undo/redo, asset insert, terrain, UI builder, search-replace, clone"
```
