# Roblox Studio MCP Server

**Bridge AI assistants to Roblox Studio — 51 tools for exploring, editing, and automating your game.**

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Gemini**, **Codex**, and any MCP-compatible client.

---

## What It Does

An MCP (Model Context Protocol) server that gives AI full access to your Roblox Studio session. Explore game hierarchies, read and edit scripts, manipulate properties, create instances, build terrain, run playtests — all locally via HTTP polling. No external servers, no data collection.

## Quick Start

### 1. Install the Studio Plugin

**Option A — Creator Store (easiest):**
[Install from Roblox Creator Store](https://create.roblox.com/store/asset/132985143757536)

**Option B — Manual:**
Download `MCPPlugin.rbxmx` from [Releases](https://github.com/drgost1/robloxstudio-mcp/releases) and drop it into your Plugins folder:
- **Windows:** `%LOCALAPPDATA%/Roblox/Plugins/`
- **macOS:** `~/Documents/Roblox/Plugins/`

### 2. Enable HTTP Requests

**Game Settings** > **Security** > **Allow HTTP Requests** = ON

### 3. Connect Your AI

**Claude Code:**
```bash
claude mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Codex:**
```bash
codex mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Gemini:**
```bash
gemini mcp add robloxstudio npx --trust -- -y robloxstudio-mcp@latest
```

<details>
<summary>Claude Desktop, Cursor, Windsurf, or other MCP clients</summary>

Add to your MCP config file:
```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "npx",
      "args": ["-y", "robloxstudio-mcp@latest"]
    }
  }
}
```

**Windows users** — if you encounter issues, wrap with `cmd`:
```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "robloxstudio-mcp@latest"]
    }
  }
}
```
</details>

Plugin shows **"Connected"** when ready.

---

## 51 Tools

### Exploration & Queries (10)
| Tool | Description |
|------|-------------|
| `get_file_tree` | Browse instance hierarchy as a tree |
| `search_files` | Search instances by name, class, or script content |
| `get_place_info` | Get place ID, name, and game settings |
| `get_services` | List available Roblox services |
| `search_objects` | Find instances by name, class, or property |
| `search_by_property` | Find instances with specific property values |
| `get_instance_properties` | Get all properties of an instance |
| `get_instance_children` | List children with class types |
| `get_class_info` | Get available properties/methods for a class |
| `get_project_structure` | Full hierarchy with configurable depth |

### Instance Management (8)
| Tool | Description |
|------|-------------|
| `create_object` | Create a new instance |
| `create_object_with_properties` | Create instance with initial properties |
| `mass_create_objects` | Bulk create instances |
| `mass_create_objects_with_properties` | Bulk create with properties |
| `delete_object` | Delete an instance |
| `smart_duplicate` | Duplicate with naming, positioning, property variations |
| `mass_duplicate` | Multiple duplication operations at once |
| `reparent_instance` | Move instance to a new parent (no delete/recreate) |

### Cloning & Assets (2)
| Tool | Description |
|------|-------------|
| `clone_instance` | Deep copy an instance to a different parent |
| `insert_asset` | Insert a Roblox asset by ID (models, meshes, images) |

### Properties (5)
| Tool | Description |
|------|-------------|
| `set_property` | Set any property on an instance |
| `mass_set_property` | Set same property on multiple instances |
| `mass_get_property` | Read same property from multiple instances |
| `set_calculated_property` | Set properties via math formulas |
| `set_relative_property` | Modify properties relative to current values |

### Scripts (6)
| Tool | Description |
|------|-------------|
| `get_script_source` | Read script source (supports line ranges) |
| `set_script_source` | Replace entire script source |
| `edit_script_lines` | Replace specific lines |
| `insert_script_lines` | Insert lines at a position |
| `delete_script_lines` | Delete specific lines |
| `search_replace_scripts` | Find/replace text across all scripts |

### UI Building (1)
| Tool | Description |
|------|-------------|
| `create_ui` | Batch-create UI elements with proper UDim2 sizing |

### Terrain (4)
| Tool | Description |
|------|-------------|
| `fill_terrain` | Fill rectangular region with terrain material |
| `fill_terrain_sphere` | Fill spherical region with material |
| `clear_terrain` | Clear terrain (region or all) |
| `get_terrain_materials` | List available terrain materials |

### Attributes & Tags (8)
| Tool | Description |
|------|-------------|
| `get_attribute` / `set_attribute` | Read/write instance attributes |
| `get_attributes` | Get all attributes on an instance |
| `delete_attribute` | Remove an attribute |
| `get_tags` / `add_tag` / `remove_tag` | Manage CollectionService tags |
| `get_tagged` | Find all instances with a specific tag |

### Undo/Redo (2)
| Tool | Description |
|------|-------------|
| `undo` | Undo last action (Ctrl+Z) |
| `redo` | Redo last undone action (Ctrl+Y) |

### Code Execution & Playtest (5)
| Tool | Description |
|------|-------------|
| `execute_luau` | Run arbitrary Luau code in Studio |
| `get_selection` | Get currently selected objects |
| `start_playtest` | Start play/run session with log capture |
| `stop_playtest` | Stop session and return output |
| `get_playtest_output` | Poll logs without stopping |

---

## Architecture

```
AI Assistant <--stdio--> MCP Server (Node.js)
                            <--HTTP--> Bridge (Express on port 58741)
                                          <--polling--> Studio Plugin (roblox-ts)
                                                           <--API--> Roblox Studio
```

- **Stateless HTTP bridge** with UUID-tracked requests
- **500ms polling** — reliable, no WebSocket complexity
- **30-second timeouts** per request
- **ChangeHistoryService** integration — every mutation creates an undo waypoint
- **All local** — nothing leaves your machine

## Development

```bash
npm install                  # Install dependencies
npm run build:all            # Build server + plugin
npm run dev                  # Dev mode with tsx
npm test                     # Run tests
npm run build:plugin         # Rebuild Studio plugin only
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Plugin missing from toolbar | Verify `.rbxmx` is in Plugins folder, restart Studio |
| HTTP 403 errors | Enable "Allow HTTP Requests" in Game Settings > Security |
| Plugin shows "Disconnected" | Normal until MCP server is running — start your AI client |
| Connection timeout | Check firewall isn't blocking localhost:58741 |

---

## License

MIT

[Report Issues](https://github.com/drgost1/robloxstudio-mcp/issues)
